import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type { CronToolService } from '../../provider/index';

/**
 * Creates an in-process MCP server exposing cron job management tools.
 * The returned server is passed to the SDK's `query()` via `mcpServers`.
 *
 * Tool handlers delegate to the injected CronToolService port.
 */
type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(err: unknown): ToolResult {
  return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
}

function handleCronList(service: CronToolService): ToolResult {
  const jobs = service.listJobs();
  if (jobs.length === 0) return textResult('No cron jobs configured.');
  const lines = jobs.map(j => {
    const status = j.enabled ? 'enabled' : 'disabled';
    const next = j.next_run_at_ms ? new Date(j.next_run_at_ms).toISOString() : 'none';
    const last = j.last_run_status ?? 'never run';
    return `- ${j.name} (${j.id}): ${status}, schedule=${j.schedule_kind}:${j.schedule_value}, next=${next}, last=${last}`;
  });
  return textResult(lines.join('\n'));
}

function handleCronStatus(service: CronToolService, jobId: string): ToolResult {
  const j = service.getJobStatus(jobId);
  const info = [
    `Name: ${j.name}`, `ID: ${j.id}`, `Enabled: ${j.enabled ? 'yes' : 'no'}`,
    `Schedule: ${j.schedule_kind} ${j.schedule_value}`,
    `Next run: ${j.next_run_at_ms ? new Date(j.next_run_at_ms).toISOString() : 'none'}`,
    `Last run: ${j.last_run_at_ms ? new Date(j.last_run_at_ms).toISOString() : 'never'}`,
    `Last status: ${j.last_run_status ?? 'N/A'}`, `Last session: ${j.last_session_id ?? 'N/A'}`,
    `Consecutive errors: ${j.consecutive_errors}`, `Prompt: ${j.prompt}`,
  ];
  return textResult(info.join('\n'));
}

export function createCronMcpTools(service: CronToolService) {
  return createSdkMcpServer({
    name: 'cron',
    version: '1.0.0',
    tools: [
      tool('cron_add', 'Create a new scheduled cron job. Use kind "at" for one-shot, "every" for interval, "cron" for cron expressions.', {
        name: z.string().describe('Human-readable job name'),
        schedule_kind: z.enum(['at', 'every', 'cron']).describe('"at" for one-shot, "every" for interval, "cron" for cron expression'),
        schedule_value: z.string().describe('ISO timestamp, interval in ms, or cron expression'),
        timezone: z.string().optional().describe('IANA timezone for cron expressions'),
        prompt: z.string().describe('The prompt to send to the Claude CLI session'),
        workingDir: z.string().describe('Working directory for the CLI session'),
      }, async (args) => {
        try {
          const job = service.addJob({
            name: args.name, prompt: args.prompt, workingDir: args.workingDir,
            schedule: { kind: args.schedule_kind, value: args.schedule_value, timezone: args.timezone },
          });
          return textResult(`Created cron job "${job.name}" (${job.id}). Next run: ${job.next_run_at_ms ? new Date(job.next_run_at_ms).toISOString() : 'N/A'}`);
        } catch (err: unknown) { return errorResult(err); }
      }),
      tool('cron_list', 'List all cron jobs with their current status.', {}, async () => handleCronList(service)),
      tool('cron_status', 'Get detailed status of a specific cron job.', { jobId: z.string().describe('The job ID') }, async (args) => {
        try { return handleCronStatus(service, args.jobId); } catch (err: unknown) { return errorResult(err); }
      }),
      tool('cron_run', 'Immediately trigger a cron job, bypassing its schedule.', { jobId: z.string().describe('The job ID to run now') }, async (args) => {
        try {
          const result = await service.runJobNow(args.jobId);
          return textResult(`Job triggered. Session ID: ${result.sessionId ?? 'unknown'}`);
        } catch (err: unknown) { return errorResult(err); }
      }),
      tool('cron_update', 'Update an existing cron job. Pass only the fields you want to change.', {
        jobId: z.string().describe('The job ID to update'),
        name: z.string().optional(), enabled: z.boolean().optional(),
        schedule_kind: z.enum(['at', 'every', 'cron']).optional(), schedule_value: z.string().optional(),
        timezone: z.string().optional(), prompt: z.string().optional(), workingDir: z.string().optional(),
      }, async (args) => {
        try {
          const { jobId, enabled, workingDir, timezone, ...rest } = args;
          const fields: Record<string, unknown> = { ...rest };
          if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
          if (workingDir !== undefined) fields.working_dir = workingDir;
          if (timezone !== undefined) fields.schedule_timezone = timezone;
          return textResult(`Updated job "${service.updateJob(jobId, fields).name}" (${jobId}).`);
        } catch (err: unknown) { return errorResult(err); }
      }),
      tool('cron_remove', 'Delete a cron job permanently.', { jobId: z.string().describe('The job ID to remove') }, async (args) => {
        try { service.removeJob(args.jobId); return textResult(`Job ${args.jobId} removed.`); }
        catch (err: unknown) { return errorResult(err); }
      }),
    ],
  });
}

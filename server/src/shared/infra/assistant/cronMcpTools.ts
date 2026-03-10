import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type { CronToolService } from '../../provider/index';

/**
 * Creates an in-process MCP server exposing cron job management tools.
 * The returned server is passed to the SDK's `query()` via `mcpServers`.
 *
 * Tool handlers delegate to the injected CronToolService port.
 */
export function createCronMcpTools(service: CronToolService) {
  return createSdkMcpServer({
    name: 'cron',
    version: '1.0.0',
    tools: [
      tool(
        'cron_add',
        'Create a new scheduled cron job. Use kind "at" for one-shot (ISO timestamp) or "every" for recurring (interval in ms, e.g. "3600000" for 1 hour).',
        {
          name: z.string().describe('Human-readable job name'),
          schedule_kind: z.enum(['at', 'every']).describe('"at" for one-shot, "every" for recurring'),
          schedule_value: z.string().describe('ISO timestamp for "at", or interval in milliseconds for "every"'),
          prompt: z.string().describe('The prompt to send to the Claude CLI session'),
          workingDir: z.string().describe('Working directory for the CLI session'),
        },
        async (args) => {
          try {
            const job = service.addJob({
              name: args.name,
              schedule: { kind: args.schedule_kind, value: args.schedule_value },
              prompt: args.prompt,
              workingDir: args.workingDir,
            });
            return { content: [{ type: 'text' as const, text: `Created cron job "${job.name}" (${job.id}). Next run: ${job.next_run_at_ms ? new Date(job.next_run_at_ms).toISOString() : 'N/A'}` }] };
          } catch (err: unknown) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      ),

      tool(
        'cron_list',
        'List all cron jobs with their current status.',
        {},
        async () => {
          const jobs = service.listJobs();
          if (jobs.length === 0) {
            return { content: [{ type: 'text' as const, text: 'No cron jobs configured.' }] };
          }
          const lines = jobs.map(j => {
            const status = j.enabled ? 'enabled' : 'disabled';
            const next = j.next_run_at_ms ? new Date(j.next_run_at_ms).toISOString() : 'none';
            const last = j.last_run_status ?? 'never run';
            return `- ${j.name} (${j.id}): ${status}, schedule=${j.schedule_kind}:${j.schedule_value}, next=${next}, last=${last}`;
          });
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        },
      ),

      tool(
        'cron_status',
        'Get detailed status of a specific cron job.',
        { jobId: z.string().describe('The job ID') },
        async (args) => {
          try {
            const j = service.getJobStatus(args.jobId);
            const info = [
              `Name: ${j.name}`,
              `ID: ${j.id}`,
              `Enabled: ${j.enabled ? 'yes' : 'no'}`,
              `Schedule: ${j.schedule_kind} ${j.schedule_value}`,
              `Next run: ${j.next_run_at_ms ? new Date(j.next_run_at_ms).toISOString() : 'none'}`,
              `Last run: ${j.last_run_at_ms ? new Date(j.last_run_at_ms).toISOString() : 'never'}`,
              `Last status: ${j.last_run_status ?? 'N/A'}`,
              `Last session: ${j.last_session_id ?? 'N/A'}`,
              `Consecutive errors: ${j.consecutive_errors}`,
              `Prompt: ${j.prompt}`,
            ];
            return { content: [{ type: 'text' as const, text: info.join('\n') }] };
          } catch (err: unknown) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      ),

      tool(
        'cron_run',
        'Immediately trigger a cron job, bypassing its schedule.',
        { jobId: z.string().describe('The job ID to run now') },
        async (args) => {
          try {
            const result = await service.runJobNow(args.jobId);
            return { content: [{ type: 'text' as const, text: `Job triggered. Session ID: ${result.sessionId ?? 'unknown'}` }] };
          } catch (err: unknown) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      ),

      tool(
        'cron_update',
        'Update an existing cron job. Pass only the fields you want to change.',
        {
          jobId: z.string().describe('The job ID to update'),
          name: z.string().optional().describe('New name'),
          enabled: z.boolean().optional().describe('Enable or disable the job'),
          schedule_kind: z.enum(['at', 'every']).optional().describe('New schedule kind'),
          schedule_value: z.string().optional().describe('New schedule value'),
          prompt: z.string().optional().describe('New prompt'),
          workingDir: z.string().optional().describe('New working directory'),
        },
        async (args) => {
          try {
            const { jobId, enabled, workingDir, ...rest } = args;
            const fields: Record<string, unknown> = { ...rest };
            if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
            if (workingDir !== undefined) fields.working_dir = workingDir;
            const job = service.updateJob(jobId, fields);
            return { content: [{ type: 'text' as const, text: `Updated job "${job.name}" (${job.id}).` }] };
          } catch (err: unknown) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      ),

      tool(
        'cron_remove',
        'Delete a cron job permanently.',
        { jobId: z.string().describe('The job ID to remove') },
        async (args) => {
          try {
            service.removeJob(args.jobId);
            return { content: [{ type: 'text' as const, text: `Job ${args.jobId} removed.` }] };
          } catch (err: unknown) {
            return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      ),
    ],
  });
}

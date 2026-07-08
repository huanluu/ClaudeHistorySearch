import { defineTool, type Tool } from '@github/copilot-sdk';
import type { CronJobRecord, CronToolService } from '../../provider/index';

type ToolResult = string;

interface CronAddArgs {
  name: string;
  schedule_kind: 'at' | 'every' | 'cron';
  schedule_value: string;
  timezone?: string;
  prompt: string;
  workingDir: string;
}

interface CronStatusArgs {
  jobId: string;
}

interface CronUpdateArgs {
  jobId: string;
  name?: string;
  enabled?: boolean;
  schedule_kind?: 'at' | 'every' | 'cron';
  schedule_value?: string;
  timezone?: string;
  prompt?: string;
  workingDir?: string;
}

function formatJobList(jobs: CronJobRecord[]): string {
  if (jobs.length === 0) return 'No cron jobs configured.';
  const lines = jobs.map(j => {
    const status = j.enabled ? 'enabled' : 'disabled';
    const next = j.next_run_at_ms ? new Date(j.next_run_at_ms).toISOString() : 'none';
    const last = j.last_run_status ?? 'never run';
    return `- ${j.name} (${j.id}): ${status}, schedule=${j.schedule_kind}:${j.schedule_value}, next=${next}, last=${last}`;
  });
  return lines.join('\n');
}

function formatJobStatus(j: CronJobRecord): string {
  const info = [
    `Name: ${j.name}`, `ID: ${j.id}`, `Enabled: ${j.enabled ? 'yes' : 'no'}`,
    `Schedule: ${j.schedule_kind} ${j.schedule_value}`,
    `Next run: ${j.next_run_at_ms ? new Date(j.next_run_at_ms).toISOString() : 'none'}`,
    `Last run: ${j.last_run_at_ms ? new Date(j.last_run_at_ms).toISOString() : 'never'}`,
    `Last status: ${j.last_run_status ?? 'N/A'}`, `Last session: ${j.last_session_id ?? 'N/A'}`,
    `Consecutive errors: ${j.consecutive_errors}`, `Prompt: ${j.prompt}`,
  ];
  return info.join('\n');
}

function errorText(error: unknown): ToolResult {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export function createCronTools(service: CronToolService): Tool<unknown>[] {
  return [
    createCronAddTool(service),
    createCronListTool(service),
    createCronStatusTool(service),
    createCronRunTool(service),
    createCronUpdateTool(service),
    createCronRemoveTool(service),
  ];
}

function createCronAddTool(service: CronToolService): Tool<unknown> {
  return defineTool<CronAddArgs>('cron_add', {
    description: 'Create a new scheduled cron job. Use kind "at" for one-shot, "every" for interval, "cron" for cron expressions.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable job name' },
        schedule_kind: { type: 'string', enum: ['at', 'every', 'cron'], description: '"at" for one-shot, "every" for interval, "cron" for cron expression' },
        schedule_value: { type: 'string', description: 'ISO timestamp, interval in ms, or cron expression' },
        timezone: { type: 'string', description: 'IANA timezone for cron expressions' },
        prompt: { type: 'string', description: 'The prompt to send to the scheduled CLI session' },
        workingDir: { type: 'string', description: 'Working directory for the CLI session' },
      },
      required: ['name', 'schedule_kind', 'schedule_value', 'prompt', 'workingDir'],
    },
    skipPermission: true,
    handler: async (args) => {
      try {
        const job = service.addJob({
          name: args.name,
          prompt: args.prompt,
          workingDir: args.workingDir,
          schedule: { kind: args.schedule_kind, value: args.schedule_value, timezone: args.timezone },
        });
        return `Created cron job "${job.name}" (${job.id}). Next run: ${job.next_run_at_ms ? new Date(job.next_run_at_ms).toISOString() : 'N/A'}`;
      } catch (error: unknown) { return errorText(error); }
    },
  }) as Tool<unknown>;
}

function createCronListTool(service: CronToolService): Tool<unknown> {
  return defineTool('cron_list', {
    description: 'List all cron jobs with their current status.',
    parameters: { type: 'object', properties: {} },
    skipPermission: true,
    handler: () => formatJobList(service.listJobs()),
  });
}

function createCronStatusTool(service: CronToolService): Tool<unknown> {
  return defineTool<CronStatusArgs>('cron_status', {
    description: 'Get detailed status of a specific cron job.',
    parameters: cronJobIdParameters('The job ID'),
    skipPermission: true,
    handler: (args) => {
      try { return formatJobStatus(service.getJobStatus(args.jobId)); }
      catch (error: unknown) { return errorText(error); }
    },
  }) as Tool<unknown>;
}

function createCronRunTool(service: CronToolService): Tool<unknown> {
  return defineTool<CronStatusArgs>('cron_run', {
    description: 'Immediately trigger a cron job, bypassing its schedule.',
    parameters: cronJobIdParameters('The job ID to run now'),
    skipPermission: true,
    handler: async (args) => {
      try {
        const result = await service.runJobNow(args.jobId);
        return `Job triggered. Session ID: ${result.sessionId ?? 'unknown'}`;
      } catch (error: unknown) { return errorText(error); }
    },
  }) as Tool<unknown>;
}

function createCronUpdateTool(service: CronToolService): Tool<unknown> {
  return defineTool<CronUpdateArgs>('cron_update', {
    description: 'Update an existing cron job. Pass only the fields you want to change.',
    parameters: cronUpdateParameters(),
    skipPermission: true,
    handler: (args) => {
      try { return `Updated job "${service.updateJob(args.jobId, toUpdateFields(args)).name}" (${args.jobId}).`; }
      catch (error: unknown) { return errorText(error); }
    },
  }) as Tool<unknown>;
}

function createCronRemoveTool(service: CronToolService): Tool<unknown> {
  return defineTool<CronStatusArgs>('cron_remove', {
    description: 'Delete a cron job permanently.',
    parameters: cronJobIdParameters('The job ID to remove'),
    skipPermission: true,
    handler: (args) => {
      try {
        service.removeJob(args.jobId);
        return `Job ${args.jobId} removed.`;
      } catch (error: unknown) { return errorText(error); }
    },
  }) as Tool<unknown>;
}

function cronJobIdParameters(description: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: { jobId: { type: 'string', description } },
    required: ['jobId'],
  };
}

function cronUpdateParameters(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'The job ID to update' },
      name: { type: 'string' },
      enabled: { type: 'boolean' },
      schedule_kind: { type: 'string', enum: ['at', 'every', 'cron'] },
      schedule_value: { type: 'string' },
      timezone: { type: 'string' },
      prompt: { type: 'string' },
      workingDir: { type: 'string' },
    },
    required: ['jobId'],
  };
}

function toUpdateFields(args: CronUpdateArgs): Partial<CronJobRecord> {
  const { enabled, workingDir, timezone, ...rest } = args;
  const fields: Partial<CronJobRecord> = {};
  if (rest.name !== undefined) fields.name = rest.name;
  if (rest.schedule_kind !== undefined) fields.schedule_kind = rest.schedule_kind;
  if (rest.schedule_value !== undefined) fields.schedule_value = rest.schedule_value;
  if (rest.prompt !== undefined) fields.prompt = rest.prompt;
  if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
  if (workingDir !== undefined) fields.working_dir = workingDir;
  if (timezone !== undefined) fields.schedule_timezone = timezone;
  return fields;
}

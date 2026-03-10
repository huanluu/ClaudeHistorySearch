import type { HeartbeatConfig, HeartbeatTask } from './types';

const HEARTBEAT_DEFAULTS: Omit<HeartbeatConfig, 'workingDirectory'> = {
  enabled: true,
  intervalMs: 3600000, // 1 hour
  maxItems: 0,
  maxRuns: 0,
};

const CONFIG_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  enabled: (v) => typeof v === 'boolean',
  intervalMs: (v) => typeof v === 'number',
  workingDirectory: (v) => typeof v === 'string',
  maxItems: (v) => typeof v === 'number',
  maxRuns: (v) => typeof v === 'number',
};

/**
 * Parse config.json's heartbeat section into a HeartbeatConfig.
 * Pure function — no filesystem access.
 */
export function parseHeartbeatConfig(
  fileConfig: Record<string, unknown> | null,
  envOverrides: Partial<HeartbeatConfig>,
  defaultWorkingDirectory = process.cwd(),
): HeartbeatConfig {
  const config: HeartbeatConfig = { ...HEARTBEAT_DEFAULTS, workingDirectory: defaultWorkingDirectory };

  if (fileConfig?.heartbeat && typeof fileConfig.heartbeat === 'object') {
    const hb = fileConfig.heartbeat as Record<string, unknown>;
    for (const [key, validator] of Object.entries(CONFIG_VALIDATORS)) {
      if (key in hb && validator(hb[key])) {
        (config as unknown as Record<string, unknown>)[key] = hb[key];
      }
    }
  }

  return { ...config, ...envOverrides };
}

/**
 * Parse HEARTBEAT.md content into enabled tasks.
 * Pure function — no filesystem access.
 */
export function parseHeartbeatContent(content: string): HeartbeatTask[] {
  if (!content.trim()) return [];

  const tasks: HeartbeatTask[] = [];
  let currentSection = 'Default';

  for (const line of content.split('\n')) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const checklistMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (checklistMatch && checklistMatch[1].toLowerCase() === 'x') {
      tasks.push({
        section: currentSection,
        description: checklistMatch[2].trim(),
        enabled: true,
      });
    }
  }

  return tasks;
}

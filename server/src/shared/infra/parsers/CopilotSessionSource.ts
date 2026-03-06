import { join, basename } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';
import type { SessionSource, ParsedSession, ParsedMessage } from '../../provider/index';

// ── Copilot session file types (external format — untrusted) ────────

interface CopilotChatMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
}

interface CopilotTimelineEntry {
  id: string;
  timestamp: string;
  type: string;
  text?: string;
}

interface CopilotSessionFile {
  sessionId?: string;
  startTime?: string;
  chatMessages?: CopilotChatMessage[];
  timeline?: CopilotTimelineEntry[];
  selectedModel?: string;
}

interface CopilotWorkspace {
  id?: string;
  cwd?: string;
  git_root?: string;
  branch?: string;
}

// ── Content sanitization ────────────────────────────────────────────

const REMINDER_TAG_REGEX = /<reminder>[\s\S]*?<\/reminder>/gi;

/**
 * Strip injected `<reminder>` system tags from Copilot message content.
 * These are injected by the Copilot CLI into user messages and are not
 * part of the actual user input.
 */
function stripReminderTags(content: string): string {
  return content.replace(REMINDER_TAG_REGEX, '').trim();
}

// ── Workspace resolution ────────────────────────────────────────────

const COPILOT_DIR = join(homedir(), '.copilot');
const SESSION_STATE_DIR = join(COPILOT_DIR, 'session-state');

/**
 * Look up the working directory from workspace.yaml in session-state.
 * Returns null if not found — the adapter will use 'Unknown'.
 */
function resolveWorkingDir(sessionId: string, sessionStateDir: string): string | null {
  const workspacePath = join(sessionStateDir, sessionId, 'workspace.yaml');
  if (!existsSync(workspacePath)) {
    return null;
  }

  try {
    const content = readFileSync(workspacePath, 'utf-8');
    // Simple YAML parsing — workspace.yaml is flat key-value
    for (const line of content.split('\n')) {
      const match = line.match(/^cwd:\s*(.+)$/);
      if (match) {
        let value = match[1].trim();
        // Strip surrounding quotes (YAML allows both single and double)
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
  } catch {
    // Malformed workspace.yaml — skip
  }

  return null;
}

// ── Timestamp extraction ────────────────────────────────────────────

/**
 * Build a timestamp map from timeline entries.
 * Maps user/copilot timeline entries to timestamps by position.
 */
function extractTimestamps(timeline: CopilotTimelineEntry[]): {
  userTimestamps: number[];
  assistantTimestamps: number[];
  earliest: number | null;
  latest: number | null;
} {
  const userTimestamps: number[] = [];
  const assistantTimestamps: number[] = [];
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const entry of timeline) {
    if (entry.type !== 'user' && entry.type !== 'copilot') continue;

    const ts = new Date(entry.timestamp).getTime();
    if (isNaN(ts)) continue;

    if (entry.type === 'user') {
      userTimestamps.push(ts);
    } else {
      assistantTimestamps.push(ts);
    }

    if (earliest === null || ts < earliest) earliest = ts;
    if (latest === null || ts > latest) latest = ts;
  }

  return { userTimestamps, assistantTimestamps, earliest, latest };
}

// ── Main parser ─────────────────────────────────────────────────────

function parseCopilotSessionFile(filePath: string, sessionStateDir: string): ParsedSession {
  let raw: CopilotSessionFile;
  try {
    const content = readFileSync(filePath, 'utf-8');
    raw = JSON.parse(content) as CopilotSessionFile;
  } catch {
    // Malformed file — return empty session
    return {
      sessionId: null, project: null, startedAt: null,
      lastActivityAt: null, preview: null, source: 'copilot', messages: [],
    };
  }

  const sessionId = raw.sessionId ?? null;
  const chatMessages = raw.chatMessages ?? [];
  const timeline = raw.timeline ?? [];

  // Resolve working directory from workspace.yaml
  const project = sessionId ? resolveWorkingDir(sessionId, sessionStateDir) : null;

  // Extract timestamps from timeline
  const { userTimestamps, assistantTimestamps, earliest, latest } = extractTimestamps(timeline);

  // Parse chat messages — skip tool role entries
  const messages: ParsedMessage[] = [];
  let userIdx = 0;
  let assistantIdx = 0;
  let firstUserMessage: string | null = null;

  for (const msg of chatMessages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (!msg.content) continue;

    const cleanContent = msg.role === 'user' ? stripReminderTags(msg.content) : msg.content;
    if (!cleanContent) continue;

    // Assign timestamps by matching message order to timeline order.
    // Assumption: timeline user/copilot entries appear in the same order as chatMessages.
    // If Copilot ever emits mismatched counts, timestamps may shift silently.
    let timestamp: number | null = null;
    if (msg.role === 'user' && userIdx < userTimestamps.length) {
      timestamp = userTimestamps[userIdx];
      userIdx++;
    } else if (msg.role === 'assistant' && assistantIdx < assistantTimestamps.length) {
      timestamp = assistantTimestamps[assistantIdx];
      assistantIdx++;
    }

    if (msg.role === 'user' && !firstUserMessage && cleanContent.length > 0) {
      firstUserMessage = cleanContent.slice(0, 200);
    }

    messages.push({
      uuid: '',  // Copilot doesn't put UUIDs on chat messages
      role: msg.role,
      content: cleanContent,
      timestamp,
    });
  }

  return {
    sessionId,
    project,
    startedAt: earliest,
    lastActivityAt: latest,
    preview: firstUserMessage,
    source: 'copilot',
    messages,
  };
}

// ── Session source ──────────────────────────────────────────────────

const HISTORY_DIR = join(COPILOT_DIR, 'history-session-state');

export class CopilotSessionSource implements SessionSource {
  readonly name = 'copilot';
  readonly sessionDir: string;
  readonly filePattern = '*.json';
  private readonly sessionStateDir: string;

  constructor(sessionDir?: string, sessionStateDir?: string) {
    this.sessionDir = sessionDir ?? HISTORY_DIR;
    this.sessionStateDir = sessionStateDir ?? SESSION_STATE_DIR;
  }

  async parse(filePath: string): Promise<ParsedSession> {
    return parseCopilotSessionFile(filePath, this.sessionStateDir);
  }

  /**
   * Extract the session ID from a Copilot history filename.
   * Format: session_<uuid>_<timestamp>.json
   */
  static extractSessionId(filename: string): string | null {
    const base = basename(filename, '.json');
    const match = base.match(/^session_([0-9a-f-]{36})_\d+$/);
    return match ? match[1] : null;
  }
}

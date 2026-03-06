import { join } from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import type { SessionSource, ParsedSession, ParsedMessage } from '../../provider/index';

// ── Copilot events.jsonl types (external format — untrusted) ────────

interface CopilotEvent {
  type: string;
  id: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface CopilotSessionStartData {
  sessionId: string;
  context?: {
    cwd?: string;
    gitRoot?: string;
    branch?: string;
    repository?: string;
  };
}

interface CopilotUserMessageData {
  content: string;
  transformedContent?: string;
}

interface CopilotAssistantMessageData {
  content?: string;
  messageId?: string;
  toolRequests?: unknown[];
}

// ── Content sanitization ────────────────────────────────────────────

const REMINDER_TAG_REGEX = /<reminder>[\s\S]*?<\/reminder>/gi;
const DATETIME_TAG_REGEX = /<current_datetime>[\s\S]*?<\/current_datetime>/gi;
const SQL_TABLES_TAG_REGEX = /<sql_tables>[\s\S]*?<\/sql_tables>/gi;

/**
 * Strip injected system tags from Copilot message content.
 * Copilot injects <reminder>, <current_datetime>, and <sql_tables> tags
 * into user messages — these are not part of the actual user input.
 */
function stripSystemTags(content: string): string {
  return content
    .replace(REMINDER_TAG_REGEX, '')
    .replace(DATETIME_TAG_REGEX, '')
    .replace(SQL_TABLES_TAG_REGEX, '')
    .trim();
}

// ── JSONL parser (new format: session-state/<uuid>/events.jsonl) ────

function parseCopilotEventsFile(filePath: string): ParsedSession {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return {
      sessionId: null, project: null, startedAt: null,
      lastActivityAt: null, preview: null, source: 'copilot', messages: [],
    };
  }

  const messages: ParsedMessage[] = [];
  let sessionId: string | null = null;
  let project: string | null = null;
  let earliest: number | null = null;
  let latest: number | null = null;
  let firstUserMessage: string | null = null;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;

    let event: CopilotEvent;
    try {
      event = JSON.parse(line) as CopilotEvent;
    } catch {
      continue;
    }

    const ts = event.timestamp ? new Date(event.timestamp).getTime() : null;
    if (ts && !isNaN(ts)) {
      if (earliest === null || ts < earliest) earliest = ts;
      if (latest === null || ts > latest) latest = ts;
    }

    switch (event.type) {
      case 'session.start': {
        const data = event.data as unknown as CopilotSessionStartData | undefined;
        if (data?.sessionId) sessionId = data.sessionId;
        if (data?.context?.cwd) project = data.context.cwd;
        break;
      }

      case 'user.message': {
        const data = event.data as unknown as CopilotUserMessageData | undefined;
        if (!data?.content) break;

        const cleanContent = stripSystemTags(data.content);
        if (!cleanContent) break;

        if (!firstUserMessage && cleanContent.length > 0) {
          firstUserMessage = cleanContent.slice(0, 200);
        }

        messages.push({
          uuid: event.id || '',
          role: 'user',
          content: cleanContent,
          timestamp: ts,
        });
        break;
      }

      case 'assistant.message': {
        const data = event.data as unknown as CopilotAssistantMessageData | undefined;
        if (!data?.content) break;

        const content = data.content.trim();
        if (!content) break;

        messages.push({
          uuid: event.id || '',
          role: 'assistant',
          content,
          timestamp: ts,
        });
        break;
      }
    }
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

const COPILOT_DIR = join(homedir(), '.copilot');
const SESSION_STATE_DIR = join(COPILOT_DIR, 'session-state');

export class CopilotSessionSource implements SessionSource {
  readonly name = 'copilot';
  readonly sessionDir: string;
  readonly filePattern = '*/events.jsonl';

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir ?? SESSION_STATE_DIR;
  }

  async parse(filePath: string): Promise<ParsedSession> {
    return parseCopilotEventsFile(filePath);
  }
}

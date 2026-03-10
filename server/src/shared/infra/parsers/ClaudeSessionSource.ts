import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { SessionSource, ParsedSession, ParsedMessage } from '../../provider/index';

interface ContentBlock {
  type: string;
  text?: string;
}

interface JsonlEntry {
  type?: string;
  sessionId?: string;
  uuid?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    content?: string | ContentBlock[];
  };
  isMeta?: boolean;
}

interface SessionIndexEntry {
  sessionId?: string;
  summary?: string;
}

interface SessionIndexData {
  entries?: SessionIndexEntry[];
}

function extractTextContent(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item): item is ContentBlock & { text: string } => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n');
  }
  return '';
}

/**
 * Loads sessions-index.json from a project directory.
 * Returns a map of sessionId → title.
 */
export function loadSessionsIndex(projectPath: string): Map<string, string> {
  const indexPath = join(projectPath, 'sessions-index.json');
  const titleMap = new Map<string, string>();

  if (!existsSync(indexPath)) {
    return titleMap;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    const data = JSON.parse(content) as SessionIndexData | SessionIndexEntry[];
    const sessions = (data as SessionIndexData).entries || (Array.isArray(data) ? data : []);

    for (const session of sessions) {
      if (session.sessionId && session.summary) {
        titleMap.set(session.sessionId, session.summary);
      }
    }
  } catch {
    // Malformed sessions-index.json — skip titles
  }

  return titleMap;
}

/**
 * Parses a Claude CLI JSONL session file into our domain model.
 */
interface ParseState {
  sessionId: string | null;
  project: string | null;
  earliestTimestamp: number | null;
  latestTimestamp: number | null;
  firstUserMessage: string | null;
  messages: ParsedMessage[];
}

function processClaudeJsonlLine(line: string, state: ParseState): void {
  const obj = JSON.parse(line) as JsonlEntry;

  if (!obj.type || !['user', 'assistant'].includes(obj.type)) return;

  if (!state.sessionId && obj.sessionId) state.sessionId = obj.sessionId;
  if (!state.project && obj.cwd) state.project = obj.cwd;

  const timestamp = obj.timestamp ? new Date(obj.timestamp).getTime() : null;
  if (timestamp) {
    if (!state.earliestTimestamp || timestamp < state.earliestTimestamp) state.earliestTimestamp = timestamp;
    if (!state.latestTimestamp || timestamp > state.latestTimestamp) state.latestTimestamp = timestamp;
  }

  const role = obj.type;
  const textContent = extractTextContent(obj.message?.content);
  if (!textContent || obj.isMeta) return;

  if (role === 'user' && !state.firstUserMessage && textContent.length > 0) {
    if (!textContent.startsWith('<command-name>') && !textContent.startsWith('<local-command')) {
      state.firstUserMessage = textContent.slice(0, 200);
    }
  }

  state.messages.push({ uuid: obj.uuid || '', role, content: textContent, timestamp });
}

async function parseClaudeSessionFile(filePath: string): Promise<ParsedSession> {
  const state: ParseState = {
    sessionId: null, project: null,
    earliestTimestamp: null, latestTimestamp: null,
    firstUserMessage: null, messages: [],
  };

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try { processClaudeJsonlLine(line, state); } catch { continue; }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return {
    sessionId: state.sessionId,
    project: state.project,
    startedAt: state.earliestTimestamp,
    lastActivityAt: state.latestTimestamp,
    preview: state.firstUserMessage,
    source: 'claude',
    messages: state.messages,
  };
}

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

export class ClaudeSessionSource implements SessionSource {
  readonly name = 'claude';
  readonly sessionDir: string;
  readonly filePattern = '**/*.jsonl';

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir ?? PROJECTS_DIR;
  }

  async parse(filePath: string): Promise<ParsedSession> {
    return parseClaudeSessionFile(filePath);
  }

  loadTitleMap(projectDir: string): Map<string, string> {
    return loadSessionsIndex(projectDir);
  }
}

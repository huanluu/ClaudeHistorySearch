import { createReadStream, readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { SessionRepository } from './database/index.js';
import { logger } from './logger.js';

export const CLAUDE_DIR = join(homedir(), '.claude');
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

// Types for JSONL entries
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

// Types for parsed data
export interface ParsedMessage {
  uuid: string;
  role: string;
  content: string;
  timestamp: number | null;
}

export interface ParsedSession {
  sessionId: string | null;
  project: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  preview: string | null;
  messages: ParsedMessage[];
}

export interface IndexResult {
  sessionId: string;
  messageCount: number;
}

export interface IndexAllResult {
  indexed: number;
  skipped: number;
}

/**
 * Detect if a session was created by the heartbeat service (automatic)
 * Detection criteria:
 * 1. Preview/first message starts with "[Heartbeat]"
 * 2. First message contains "<!-- HEARTBEAT_SESSION -->"
 */
export function detectAutomaticSession(session: ParsedSession): boolean {
  // Check preview for [Heartbeat] prefix
  if (session.preview?.startsWith('[Heartbeat]')) {
    return true;
  }

  // Check first message for HEARTBEAT_SESSION marker
  if (session.messages.length > 0) {
    const firstMessage = session.messages[0];
    if (firstMessage.content.includes('<!-- HEARTBEAT_SESSION -->')) {
      return true;
    }
    // Also check if first message starts with [Heartbeat]
    if (firstMessage.content.startsWith('[Heartbeat]')) {
      return true;
    }
  }

  return false;
}

/**
 * Load sessions-index.json from a project directory and return a map of sessionId → title
 */
function loadSessionsIndex(projectPath: string): Map<string, string> {
  const indexPath = join(projectPath, 'sessions-index.json');
  const titleMap = new Map<string, string>();

  if (!existsSync(indexPath)) {
    return titleMap;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    const data = JSON.parse(content) as SessionIndexData | SessionIndexEntry[];

    // Handle both formats: { entries: [...] } or direct array
    const sessions = (data as SessionIndexData).entries || (Array.isArray(data) ? data : []);

    for (const session of sessions) {
      if (session.sessionId && session.summary) {
        titleMap.set(session.sessionId, session.summary);
      }
    }
  } catch (e) {
    const error = e as Error;
    logger.error(`Error reading sessions-index.json from ${projectPath}:`, error.message);
  }

  return titleMap;
}

/**
 * Extract text content from message content (handles both string and array formats)
 */
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
 * Parse a JSONL file and extract messages (streaming to handle large files)
 */
export async function parseSessionFile(filePath: string): Promise<ParsedSession> {
  const messages: ParsedMessage[] = [];
  let sessionId: string | null = null;
  let project: string | null = null;
  let earliestTimestamp: number | null = null;
  let latestTimestamp: number | null = null;
  let firstUserMessage: string | null = null;

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line) as JsonlEntry;

      // Skip non-message entries
      if (!obj.type || !['user', 'assistant'].includes(obj.type)) {
        continue;
      }

      // Extract session metadata
      if (!sessionId && obj.sessionId) {
        sessionId = obj.sessionId;
      }
      if (!project && obj.cwd) {
        project = obj.cwd;
      }

      const timestamp = obj.timestamp ? new Date(obj.timestamp).getTime() : null;

      if (timestamp) {
        if (!earliestTimestamp || timestamp < earliestTimestamp) {
          earliestTimestamp = timestamp;
        }
        if (!latestTimestamp || timestamp > latestTimestamp) {
          latestTimestamp = timestamp;
        }
      }

      // Extract message content
      const role = obj.type;
      const messageContent = obj.message?.content;
      const textContent = extractTextContent(messageContent);

      // Skip empty or meta messages
      if (!textContent || obj.isMeta) {
        continue;
      }

      // Capture first user message as preview
      if (role === 'user' && !firstUserMessage && textContent.length > 0) {
        // Skip command messages
        if (!textContent.startsWith('<command-name>') && !textContent.startsWith('<local-command')) {
          firstUserMessage = textContent.slice(0, 200);
        }
      }

      messages.push({
        uuid: obj.uuid || '',
        role,
        content: textContent,
        timestamp
      });
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return {
    sessionId,
    project,
    startedAt: earliestTimestamp,
    lastActivityAt: latestTimestamp,
    preview: firstUserMessage,
    messages
  };
}

/**
 * Index a single session file
 */
export async function indexSessionFile(
  filePath: string,
  forceReindex: boolean = false,
  titleMap: Map<string, string> = new Map(),
  repo: SessionRepository
): Promise<IndexResult | null> {
  const fileName = basename(filePath, '.jsonl');

  // Skip agent files and other non-session files
  if (fileName.startsWith('agent-') || fileName === 'sessions-index') {
    return null;
  }

  // Check if we need to reindex
  const fileStat = statSync(filePath);
  const fileModTime = fileStat.mtimeMs;

  if (!forceReindex) {
    const existing = repo.getSessionLastIndexed(fileName);
    if (existing && existing.last_indexed && existing.last_indexed >= fileModTime) {
      return null; // Already up to date
    }
  }

  logger.log(`Indexing: ${filePath}`);

  const parsedSession = await parseSessionFile(filePath);
  const { sessionId, project, startedAt, lastActivityAt, preview, messages } = parsedSession;

  if (!sessionId || messages.length === 0) {
    return null;
  }

  // Look up title from sessions-index.json
  const title = titleMap.get(sessionId) || null;

  // Detect if this is an automatic (heartbeat) session
  const isAutomatic = detectAutomaticSession(parsedSession);

  repo.indexSession({
    sessionId,
    project: project || 'Unknown',
    startedAt: startedAt || Date.now(),
    lastActivityAt: lastActivityAt || startedAt || Date.now(),
    messageCount: messages.length,
    preview: preview || '',
    title,
    lastIndexed: Date.now(),
    isAutomatic,
    messages,
  });

  return {
    sessionId,
    messageCount: messages.length
  };
}

/**
 * Index all session files in the Claude projects directory
 */
export async function indexAllSessions(
  forceReindex: boolean = false,
  repo: SessionRepository
): Promise<IndexAllResult> {
  logger.log('Starting indexing of Claude sessions...');

  if (!existsSync(PROJECTS_DIR)) {
    logger.log('Projects directory not found:', PROJECTS_DIR);
    return { indexed: 0, skipped: 0 };
  }

  let indexed = 0;
  let skipped = 0;

  // Iterate through project directories
  const projectDirs = readdirSync(PROJECTS_DIR);

  for (const projectDir of projectDirs) {
    const projectPath = join(PROJECTS_DIR, projectDir);
    const stat = statSync(projectPath);

    if (!stat.isDirectory()) continue;

    // Load sessions-index.json for this project to get titles
    const titleMap = loadSessionsIndex(projectPath);

    // Find all JSONL files in this project
    const files = readdirSync(projectPath);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = join(projectPath, file);
      try {
        const result = await indexSessionFile(filePath, forceReindex, titleMap, repo);

        if (result) {
          indexed++;
        } else {
          skipped++;
        }
      } catch (e) {
        const error = e as Error;
        logger.error(`Error indexing ${filePath}:`, error.message);
        skipped++;
      }
    }
  }

  logger.log(`Indexing complete: ${indexed} sessions indexed, ${skipped} skipped`);
  return { indexed, skipped };
}

/**
 * Get project directory path from a file path
 */
export function decodeProjectPath(encodedPath: string): string {
  // Convert -Users-huanlu-Developer back to /Users/huanlu/Developer
  return '/' + encodedPath.replace(/-/g, '/').replace(/^\//, '');
}

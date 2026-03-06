import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { SessionRepository, Logger, ParsedMessage, ParsedSession, SessionSource } from '../../shared/provider/index';

export const CLAUDE_DIR = join(homedir(), '.claude');
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

// Re-export domain types for backward compatibility
export type { ParsedMessage, ParsedSession } from '../../shared/provider/index';

// Re-export parseSessionFile for backward compatibility with existing tests
import { ClaudeSessionSource } from '../../shared/infra/parsers/index';
const _claudeSource = new ClaudeSessionSource();
export const parseSessionFile = _claudeSource.parse.bind(_claudeSource);

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
 * Index a single session file using the provided SessionSource parser.
 */
export async function indexSessionFile(
  filePath: string,
  forceReindex: boolean,
  source: SessionSource,
  repo: SessionRepository,
  logger: Logger,
  titleMap: Map<string, string> = new Map(),
): Promise<IndexResult | null> {
  // Extract base name (works for both .jsonl and .json extensions)
  const ext = filePath.endsWith('.jsonl') ? '.jsonl' : '.json';
  const fileName = basename(filePath, ext);

  // Skip agent files and other non-session files (Claude-specific, harmless for others)
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

  logger.log({ msg: `Indexing: ${filePath}`, op: 'indexer.file', context: { filePath, source: source.name } });

  const parsedSession = await source.parse(filePath);
  const { sessionId, project, startedAt, lastActivityAt, preview, messages } = parsedSession;

  if (!sessionId || messages.length === 0) {
    return null;
  }

  // Look up title (Claude has sessions-index.json, others may not)
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
    source: parsedSession.source,
    messages,
  });

  return {
    sessionId,
    messageCount: messages.length
  };
}

/**
 * Index all session files from the given sources.
 * Falls back to Claude-only indexing if no sources are provided (backward compat).
 */
export async function indexAllSessions(
  forceReindex: boolean = false,
  repo: SessionRepository,
  logger: Logger,
  sources?: SessionSource[],
): Promise<IndexAllResult> {
  // If sources are provided, use the multi-source path
  if (sources && sources.length > 0) {
    return indexAllFromSources(forceReindex, sources, repo, logger);
  }

  // Legacy fallback: Claude-only indexing (for backward compatibility with existing callers)
  return indexClaudeSessions(forceReindex, repo, logger);
}

/**
 * Index sessions from multiple sources.
 */
async function indexAllFromSources(
  forceReindex: boolean,
  sources: SessionSource[],
  repo: SessionRepository,
  logger: Logger,
): Promise<IndexAllResult> {
  let indexed = 0;
  let skipped = 0;

  for (const source of sources) {
    logger.log({ msg: `Indexing ${source.name} sessions from ${source.sessionDir}`, op: 'indexer.run', context: { source: source.name } });

    if (!existsSync(source.sessionDir)) {
      logger.log({ msg: `Source directory not found: ${source.sessionDir}`, op: 'indexer.run', context: { source: source.name, dir: source.sessionDir } });
      continue;
    }

    const result = await indexSourceDirectory(forceReindex, source, repo, logger);
    indexed += result.indexed;
    skipped += result.skipped;
  }

  logger.log({ msg: `Indexing complete: ${indexed} sessions indexed, ${skipped} skipped`, op: 'indexer.run', context: { indexed, skipped } });
  return { indexed, skipped };
}

/**
 * Index all files from a single source directory.
 * Handles both flat directories (Copilot) and nested directories (Claude).
 */
async function indexSourceDirectory(
  forceReindex: boolean,
  source: SessionSource,
  repo: SessionRepository,
  logger: Logger,
): Promise<IndexAllResult> {
  let indexed = 0;
  let skipped = 0;

  // Claude uses nested dirs (projects/<path>/*.jsonl), Copilot uses flat dir (*.json)
  const isNested = source.filePattern.startsWith('**');
  const extension = source.filePattern.includes('.jsonl') ? '.jsonl' : '.json';

  if (isNested) {
    // Walk subdirectories (Claude pattern)
    const { loadSessionsIndex } = await import('../../shared/infra/parsers/index');
    const projectDirs = readdirSync(source.sessionDir);

    for (const projectDir of projectDirs) {
      const projectPath = join(source.sessionDir, projectDir);
      const stat = statSync(projectPath);
      if (!stat.isDirectory()) continue;

      const titleMap = loadSessionsIndex(projectPath);
      const files = readdirSync(projectPath);

      for (const file of files) {
        if (!file.endsWith(extension)) continue;
        const filePath = join(projectPath, file);
        try {
          const result = await indexSessionFile(filePath, forceReindex, source, repo, logger, titleMap);
          if (result) indexed++;
          else skipped++;
        } catch (e) {
          const error = e as Error;
          logger.error({ msg: `Error indexing ${filePath}: ${error.message}`, op: 'indexer.error', err: error, context: { filePath } });
          skipped++;
        }
      }
    }
  } else {
    // Flat directory (Copilot pattern)
    const files = readdirSync(source.sessionDir);

    for (const file of files) {
      if (!file.endsWith(extension)) continue;
      const filePath = join(source.sessionDir, file);
      try {
        const result = await indexSessionFile(filePath, forceReindex, source, repo, logger);
        if (result) indexed++;
        else skipped++;
      } catch (e) {
        const error = e as Error;
        logger.error({ msg: `Error indexing ${filePath}: ${error.message}`, op: 'indexer.error', err: error, context: { filePath } });
        skipped++;
      }
    }
  }

  return { indexed, skipped };
}

/**
 * Legacy Claude-only indexing (backward compat for callers without SessionSource[]).
 */
async function indexClaudeSessions(
  forceReindex: boolean,
  repo: SessionRepository,
  logger: Logger,
): Promise<IndexAllResult> {
  const { ClaudeSessionSource, loadSessionsIndex } = await import('../../shared/infra/parsers/index');
  const source = new ClaudeSessionSource();
  logger.log({ msg: 'Starting indexing of Claude sessions...', op: 'indexer.run' });

  if (!existsSync(PROJECTS_DIR)) {
    logger.log({ msg: `Projects directory not found: ${PROJECTS_DIR}`, op: 'indexer.run', context: { dir: PROJECTS_DIR } });
    return { indexed: 0, skipped: 0 };
  }

  let indexed = 0;
  let skipped = 0;

  const projectDirs = readdirSync(PROJECTS_DIR);

  for (const projectDir of projectDirs) {
    const projectPath = join(PROJECTS_DIR, projectDir);
    const stat = statSync(projectPath);
    if (!stat.isDirectory()) continue;

    const titleMap = loadSessionsIndex(projectPath);
    const files = readdirSync(projectPath);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = join(projectPath, file);
      try {
        const result = await indexSessionFile(filePath, forceReindex, source, repo, logger, titleMap);
        if (result) indexed++;
        else skipped++;
      } catch (e) {
        const error = e as Error;
        logger.error({ msg: `Error indexing ${filePath}: ${error.message}`, op: 'indexer.error', err: error, context: { filePath } });
        skipped++;
      }
    }
  }

  logger.log({ msg: `Indexing complete: ${indexed} sessions indexed, ${skipped} skipped`, op: 'indexer.run', context: { indexed, skipped } });
  return { indexed, skipped };
}

/**
 * Get project directory path from a file path
 */
export function decodeProjectPath(encodedPath: string): string {
  // Convert -Users-huanlu-Developer back to /Users/huanlu/Developer
  return '/' + encodedPath.replace(/-/g, '/').replace(/^\//, '');
}

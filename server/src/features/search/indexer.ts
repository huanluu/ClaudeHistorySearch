import { join, basename } from 'path';
import { homedir } from 'os';
import type { SessionRepository, Logger, ParsedSession, SessionSource, FileSystem } from '../../shared/provider/index';

export const CLAUDE_DIR = join(homedir(), '.claude');
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

// Re-export domain types for backward compatibility
export type { ParsedMessage, ParsedSession } from '../../shared/provider/index';

export interface IndexResult {
  sessionId: string;
  messageCount: number;
}

export interface IndexAllResult {
  indexed: number;
  skipped: number;
}

/**
 * Detect if a session was created by an automated service (heartbeat or cron).
 * Detection criteria:
 * 1. Preview/first message starts with "[Heartbeat]" or "[Cron:"
 * 2. First message contains "<!-- HEARTBEAT_SESSION -->"
 */
export function detectAutomaticSession(session: ParsedSession): boolean {
  // Check preview for automated session prefixes
  if (session.preview?.startsWith('[Heartbeat]') || session.preview?.startsWith('[Cron:')) {
    return true;
  }

  // Check first message for markers
  if (session.messages.length > 0) {
    const firstMessage = session.messages[0];
    if (firstMessage.content.includes('<!-- HEARTBEAT_SESSION -->')) {
      return true;
    }
    if (firstMessage.content.startsWith('[Heartbeat]') || firstMessage.content.startsWith('[Cron:')) {
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
  fs: FileSystem,
  titleMap: Map<string, string> = new Map(),
): Promise<IndexResult | null> {
  // Extract base name (works for both .jsonl and .json extensions)
  const ext = filePath.endsWith('.jsonl') ? '.jsonl' : '.json';
  const fileName = basename(filePath, ext);

  // Skip agent files and other non-session files (Claude-specific, harmless for others)
  if (fileName.startsWith('agent-') || fileName === 'sessions-index') {
    return null;
  }

  // Parse first — we need the sessionId for the reindex check since
  // filenames differ across sources (Claude: <uuid>.jsonl, Copilot: <uuid>/events.jsonl)
  const parsedSession = await source.parse(filePath);
  const { sessionId, project, startedAt, lastActivityAt, preview, messages } = parsedSession;

  if (!sessionId || messages.length === 0) {
    return null;
  }

  // Check if we need to reindex (using parsed sessionId, not filename)
  const fileStat = fs.stat(filePath);
  const fileModTime = fileStat.mtimeMs;

  if (!forceReindex) {
    const existing = repo.getSessionLastIndexed(sessionId);
    if (existing && existing.last_indexed && existing.last_indexed >= fileModTime) {
      return null; // Already up to date
    }
  }

  logger.log({ msg: `Indexing: ${filePath}`, op: 'indexer.file', context: { filePath, source: source.name } });

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
 */
export async function indexAllSessions(
  forceReindex: boolean = false,
  repo: SessionRepository,
  logger: Logger,
  sources: SessionSource[],
  fs: FileSystem,
): Promise<IndexAllResult> {
  return indexAllFromSources(forceReindex, sources, repo, logger, fs);
}

/**
 * Index sessions from multiple sources.
 */
async function indexAllFromSources(
  forceReindex: boolean,
  sources: SessionSource[],
  repo: SessionRepository,
  logger: Logger,
  fs: FileSystem,
): Promise<IndexAllResult> {
  let indexed = 0;
  let skipped = 0;

  for (const source of sources) {
    logger.log({ msg: `Indexing ${source.name} sessions from ${source.sessionDir}`, op: 'indexer.run', context: { source: source.name } });

    if (!fs.exists(source.sessionDir)) {
      logger.log({ msg: `Source directory not found: ${source.sessionDir}`, op: 'indexer.run', context: { source: source.name, dir: source.sessionDir } });
      continue;
    }

    const result = await indexSourceDirectory(forceReindex, source, repo, logger, fs);
    indexed += result.indexed;
    skipped += result.skipped;
  }

  logger.log({ msg: `Indexing complete: ${indexed} sessions indexed, ${skipped} skipped`, op: 'indexer.run', context: { indexed, skipped } });
  return { indexed, skipped };
}

/**
 * Index all files from a single source directory.
 *
 * Supported filePattern formats:
 * - `** /*.jsonl` → deeply nested (Claude: projects/<path>/*.jsonl, with title maps)
 * - `*.json` → flat directory
 * - `* /events.jsonl` → one level deep (Copilot: <uuid>/events.jsonl)
 */
async function indexDeeplyNestedFiles(
  source: SessionSource, forceReindex: boolean,
  repo: SessionRepository, logger: Logger, fs: FileSystem,
): Promise<IndexAllResult> {
  let indexed = 0;
  let skipped = 0;
  const extension = source.filePattern.includes('.jsonl') ? '.jsonl' : '.json';
  const projectDirs = fs.listDirectory(source.sessionDir);

  for (const projectDir of projectDirs) {
    const projectPath = join(source.sessionDir, projectDir);
    const stat = fs.stat(projectPath);
    if (!stat.isDirectory) continue;

    const titleMap = source.loadTitleMap?.(projectPath) ?? new Map<string, string>();
    const files = fs.listDirectory(projectPath);

    for (const file of files) {
      if (!file.endsWith(extension)) continue;
      const filePath = join(projectPath, file);
      try {
        const result = await indexSessionFile(filePath, forceReindex, source, repo, logger, fs, titleMap);
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

async function indexOneLevelDeepFiles(
  source: SessionSource, forceReindex: boolean,
  repo: SessionRepository, logger: Logger, fs: FileSystem,
): Promise<IndexAllResult> {
  let indexed = 0;
  let skipped = 0;
  const targetFile = source.filePattern.split('/').pop() || '';
  const subdirs = fs.listDirectory(source.sessionDir);

  for (const subdir of subdirs) {
    const subdirPath = join(source.sessionDir, subdir);
    try {
      const stat = fs.stat(subdirPath);
      if (!stat.isDirectory) continue;
    } catch { continue; }

    const filePath = join(subdirPath, targetFile);
    if (!fs.exists(filePath)) continue;

    try {
      const result = await indexSessionFile(filePath, forceReindex, source, repo, logger, fs);
      if (result) indexed++;
      else skipped++;
    } catch (e) {
      const error = e as Error;
      logger.error({ msg: `Error indexing ${filePath}: ${error.message}`, op: 'indexer.error', err: error, context: { filePath } });
      skipped++;
    }
  }
  return { indexed, skipped };
}

async function indexFlatDirectoryFiles(
  source: SessionSource, forceReindex: boolean,
  repo: SessionRepository, logger: Logger, fs: FileSystem,
): Promise<IndexAllResult> {
  let indexed = 0;
  let skipped = 0;
  const extension = source.filePattern.replace('*', '');
  const files = fs.listDirectory(source.sessionDir);

  for (const file of files) {
    if (!file.endsWith(extension)) continue;
    const filePath = join(source.sessionDir, file);
    try {
      const result = await indexSessionFile(filePath, forceReindex, source, repo, logger, fs);
      if (result) indexed++;
      else skipped++;
    } catch (e) {
      const error = e as Error;
      logger.error({ msg: `Error indexing ${filePath}: ${error.message}`, op: 'indexer.error', err: error, context: { filePath } });
      skipped++;
    }
  }
  return { indexed, skipped };
}

async function indexSourceDirectory(
  forceReindex: boolean,
  source: SessionSource,
  repo: SessionRepository,
  logger: Logger,
  fs: FileSystem,
): Promise<IndexAllResult> {
  const pattern = source.filePattern;

  if (pattern.startsWith('**')) {
    return indexDeeplyNestedFiles(source, forceReindex, repo, logger, fs);
  } else if (pattern.includes('/')) {
    return indexOneLevelDeepFiles(source, forceReindex, repo, logger, fs);
  } else {
    return indexFlatDirectoryFiles(source, forceReindex, repo, logger, fs);
  }
}

/**
 * Get project directory path from a file path
 */
export function decodeProjectPath(encodedPath: string): string {
  // Convert -Users-huanlu-Developer back to /Users/huanlu/Developer
  return '/' + encodedPath.replace(/-/g, '/').replace(/^\//, '');
}

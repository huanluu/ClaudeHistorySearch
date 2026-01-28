import { createReadStream, readdirSync, statSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, basename } from 'path';
import { homedir } from 'os';
import {
  db,
  insertSession,
  insertMessage,
  clearSessionMessages,
  getSessionLastIndexed
} from './database.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

/**
 * Extract text content from message content (handles both string and array formats)
 */
function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
  }
  return '';
}

/**
 * Parse a JSONL file and extract messages (streaming to handle large files)
 */
async function parseSessionFile(filePath) {
  const messages = [];
  let sessionId = null;
  let project = null;
  let earliestTimestamp = null;
  let latestTimestamp = null;
  let firstUserMessage = null;

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);

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
        uuid: obj.uuid,
        role,
        content: textContent,
        timestamp
      });
    } catch (e) {
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
async function indexSessionFile(filePath, forceReindex = false) {
  const fileName = basename(filePath, '.jsonl');

  // Skip agent files and other non-session files
  if (fileName.startsWith('agent-') || fileName === 'sessions-index') {
    return null;
  }

  // Check if we need to reindex
  const fileStat = statSync(filePath);
  const fileModTime = fileStat.mtimeMs;

  if (!forceReindex) {
    const existing = getSessionLastIndexed.get(fileName);
    if (existing && existing.last_indexed >= fileModTime) {
      return null; // Already up to date
    }
  }

  console.log(`Indexing: ${filePath}`);

  const { sessionId, project, startedAt, lastActivityAt, preview, messages } = await parseSessionFile(filePath);

  if (!sessionId || messages.length === 0) {
    return null;
  }

  // Use transaction for atomic update
  const transaction = db.transaction(() => {
    // Clear existing messages for this session
    clearSessionMessages.run(sessionId);

    // Insert session
    insertSession.run(
      sessionId,
      project || 'Unknown',
      startedAt || Date.now(),
      lastActivityAt || startedAt || Date.now(),
      messages.length,
      preview || '',
      Date.now()
    );

    // Insert messages
    for (const msg of messages) {
      insertMessage.run(
        sessionId,
        msg.role,
        msg.content,
        msg.timestamp,
        msg.uuid
      );
    }
  });

  transaction();

  return {
    sessionId,
    messageCount: messages.length
  };
}

/**
 * Index all session files in the Claude projects directory
 */
async function indexAllSessions(forceReindex = false) {
  console.log('Starting indexing of Claude sessions...');

  if (!existsSync(PROJECTS_DIR)) {
    console.log('Projects directory not found:', PROJECTS_DIR);
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

    // Find all JSONL files in this project
    const files = readdirSync(projectPath);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = join(projectPath, file);
      try {
        const result = await indexSessionFile(filePath, forceReindex);

        if (result) {
          indexed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Error indexing ${filePath}:`, err.message);
        skipped++;
      }
    }
  }

  console.log(`Indexing complete: ${indexed} sessions indexed, ${skipped} skipped`);
  return { indexed, skipped };
}

/**
 * Get project directory path from a file path
 */
function decodeProjectPath(encodedPath) {
  // Convert -Users-huanlu-Developer back to /Users/huanlu/Developer
  return '/' + encodedPath.replace(/-/g, '/').replace(/^\//, '');
}

export {
  indexAllSessions,
  indexSessionFile,
  parseSessionFile,
  CLAUDE_DIR,
  PROJECTS_DIR
};

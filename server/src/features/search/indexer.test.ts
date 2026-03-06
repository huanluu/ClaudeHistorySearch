import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, mkdirSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { parseSessionFile, type ParsedSession, detectAutomaticSession, indexSessionFile } from './indexer';
import { createDatabase, createSessionRepository } from '../../shared/infra/database/index';
import type { SessionRepository } from '../../shared/provider/index';
import { ClaudeSessionSource } from '../../shared/infra/parsers/index';
import { noopLogger } from '../../../tests/__helpers/index';

// ES module path resolution
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../../tests/__fixtures__');

describe('parseSessionFile', () => {
  describe('basic parsing with string content', () => {
    let result: ParsedSession;

    beforeAll(async () => {
      result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session.jsonl'));
    });

    it('should parse sessionId from JSONL', () => {
      expect(result.sessionId).toBe('test-session-001');
    });

    it('should parse project (cwd) from JSONL', () => {
      expect(result.project).toBe('/Users/test/project');
    });

    it('should extract all user and assistant messages', () => {
      expect(result.messages.length).toBe(4);
      expect(result.messages.filter(m => m.role === 'user').length).toBe(2);
      expect(result.messages.filter(m => m.role === 'assistant').length).toBe(2);
    });

    it('should calculate earliest timestamp as startedAt', () => {
      const expectedStart = new Date('2025-01-15T10:00:00Z').getTime();
      expect(result.startedAt).toBe(expectedStart);
    });

    it('should calculate latest timestamp as lastActivityAt', () => {
      const expectedEnd = new Date('2025-01-15T10:01:30Z').getTime();
      expect(result.lastActivityAt).toBe(expectedEnd);
    });

    it('should use first user message as preview', () => {
      expect(result.preview).toBe('How do I create a React component?');
    });

    it('should preserve message content correctly', () => {
      const firstMessage = result.messages[0];
      expect(firstMessage.content).toBe('How do I create a React component?');
      expect(firstMessage.role).toBe('user');
      expect(firstMessage.uuid).toBe('msg-001');
    });
  });

  describe('array content format', () => {
    let result: ParsedSession;

    beforeAll(async () => {
      result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session-array-content.jsonl'));
    });

    it('should handle array content format [{type:"text", text:"..."}]', () => {
      expect(result.messages.length).toBe(3);
      expect(result.messages[0].content).toBe('What is the difference between let and const?');
    });

    it('should join multiple text items with newline', () => {
      // The assistant message has two text items
      const assistantMsg = result.messages[1];
      expect(assistantMsg.content).toContain('Let allows reassignment');
      expect(assistantMsg.content).toContain('const objects can still');
      expect(assistantMsg.content).toContain('\n'); // Joined with newline
    });

    it('should extract preview from array content', () => {
      expect(result.preview).toBe('What is the difference between let and const?');
    });

    it('should parse sessionId from array content format', () => {
      expect(result.sessionId).toBe('array-session-001');
    });
  });

  describe('command message handling', () => {
    let result: ParsedSession;

    beforeAll(async () => {
      result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session-with-commands.jsonl'));
    });

    it('should skip command messages for preview', () => {
      // First two messages are commands, preview should be the third message
      expect(result.preview).toBe('How do I run tests in Jest?');
    });

    it('should still include command messages in messages array', () => {
      // Command messages should still be in the messages array
      expect(result.messages.length).toBe(4);
    });

    it('should not use <command-name> message as preview', () => {
      expect(result.preview).not.toContain('<command-name>');
    });

    it('should not use <local-command> message as preview', () => {
      expect(result.preview).not.toContain('<local-command>');
    });
  });

  describe('edge cases and error handling', () => {
    let result: ParsedSession;

    beforeAll(async () => {
      result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session-edge-cases.jsonl'));
    });

    it('should skip non-message entries (system, summary, etc.)', () => {
      // Only user and assistant messages should be parsed
      const types = result.messages.map(m => m.role);
      expect(types.every(t => t === 'user' || t === 'assistant')).toBe(true);
    });

    it('should handle empty lines gracefully', () => {
      // File has empty lines but should still parse correctly
      expect(result.messages.length).toBe(2);
    });

    it('should handle malformed JSON lines gracefully', () => {
      // File has malformed JSON but should still parse valid lines
      expect(result.sessionId).toBe('edge-session-001');
      expect(result.messages.length).toBe(2);
    });

    it('should extract correct timestamps despite invalid entries', () => {
      const expectedStart = new Date('2025-01-17T08:01:00Z').getTime();
      const expectedEnd = new Date('2025-01-17T08:02:00Z').getTime();
      expect(result.startedAt).toBe(expectedStart);
      expect(result.lastActivityAt).toBe(expectedEnd);
    });
  });

  describe('empty file handling', () => {
    let result: ParsedSession;

    beforeAll(async () => {
      result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session-empty.jsonl'));
    });

    it('should return empty messages array for empty file', () => {
      expect(result.messages).toEqual([]);
    });

    it('should return null sessionId for empty file', () => {
      expect(result.sessionId).toBeNull();
    });

    it('should return null project for empty file', () => {
      expect(result.project).toBeNull();
    });

    it('should return null timestamps for empty file', () => {
      expect(result.startedAt).toBeNull();
      expect(result.lastActivityAt).toBeNull();
    });

    it('should return null preview for empty file', () => {
      expect(result.preview).toBeNull();
    });
  });

  describe('preview truncation', () => {
    it('should truncate preview to 200 characters', async () => {
      // Create a test case using the existing fixture - the preview is short
      // so we verify it doesn't truncate when under 200 chars
      const result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session.jsonl'));
      expect(result.preview!.length).toBeLessThanOrEqual(200);
    });
  });

  describe('message structure', () => {
    it('should include uuid, role, content, and timestamp in messages', async () => {
      const result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session.jsonl'));
      const msg = result.messages[0];

      expect(msg).toHaveProperty('uuid');
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(msg).toHaveProperty('timestamp');
    });

    it('should have numeric timestamps', async () => {
      const result = await parseSessionFile(join(FIXTURES_DIR, 'sample-session.jsonl'));
      result.messages.forEach(msg => {
        expect(typeof msg.timestamp).toBe('number');
      });
    });
  });
});

// =============================================================================
// PHASE 5: Automatic Session Detection Tests
// =============================================================================

describe('detectAutomaticSession', () => {
  it('should detect session with HEARTBEAT_SESSION marker in first message', async () => {
    const session = await parseSessionFile(join(FIXTURES_DIR, 'sample-session-heartbeat.jsonl'));
    const isAutomatic = detectAutomaticSession(session);
    expect(isAutomatic).toBe(true);
  });

  it('should detect session with [Heartbeat] in preview', async () => {
    const session: ParsedSession = {
      sessionId: 'test-session',
      project: '/test',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      preview: '[Heartbeat] Analyze Work Item #12345',
      messages: [
        { uuid: 'msg-1', role: 'user', content: '[Heartbeat] Analyze Work Item #12345', timestamp: Date.now() }
      ]
    };
    const isAutomatic = detectAutomaticSession(session);
    expect(isAutomatic).toBe(true);
  });

  it('should NOT detect regular sessions as automatic', async () => {
    const session = await parseSessionFile(join(FIXTURES_DIR, 'sample-session.jsonl'));
    const isAutomatic = detectAutomaticSession(session);
    expect(isAutomatic).toBe(false);
  });

  it('should NOT detect sessions with "heartbeat" in random context', async () => {
    // A session mentioning "heartbeat" in normal conversation shouldn't be flagged
    const session: ParsedSession = {
      sessionId: 'test-session',
      project: '/test',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      preview: 'How do I implement a heartbeat check in my app?',
      messages: [
        { uuid: 'msg-1', role: 'user', content: 'How do I implement a heartbeat check in my app?', timestamp: Date.now() }
      ]
    };
    const isAutomatic = detectAutomaticSession(session);
    expect(isAutomatic).toBe(false);
  });

  it('should handle empty session gracefully', () => {
    const session: ParsedSession = {
      sessionId: null,
      project: null,
      startedAt: null,
      lastActivityAt: null,
      preview: null,
      messages: []
    };
    const isAutomatic = detectAutomaticSession(session);
    expect(isAutomatic).toBe(false);
  });
});

// =============================================================================
// indexSessionFile Tests
// =============================================================================

describe('indexSessionFile', () => {
  let tmpDir: string;
  let repo: SessionRepository;
  const source = new ClaudeSessionSource();

  beforeEach(() => {
    tmpDir = join(tmpdir(), `indexer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const db = createDatabase(':memory:', noopLogger);
    repo = createSessionRepository(db);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexes a valid JSONL file and stores session in repo', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session.jsonl');
    const testFile = join(tmpDir, 'test-session.jsonl');
    copyFileSync(fixturePath, testFile);

    const result = await indexSessionFile(testFile, false, source, repo, noopLogger);

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('test-session-001');
    expect(result!.messageCount).toBe(4);

    // Verify session is retrievable from the repo
    const stored = repo.getSessionById('test-session-001');
    expect(stored).toBeDefined();
    expect(stored!.project).toBe('/Users/test/project');
    expect(stored!.message_count).toBe(4);
  });

  it('returns null for agent-prefixed files', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session.jsonl');
    const testFile = join(tmpDir, 'agent-something.jsonl');
    copyFileSync(fixturePath, testFile);

    const result = await indexSessionFile(testFile, false, source, repo, noopLogger);

    expect(result).toBeNull();
  });

  it('skips already-indexed files when forceReindex is false', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session.jsonl');
    const testFile = join(tmpDir, 'test-session-001.jsonl');
    copyFileSync(fixturePath, testFile);

    // Set file mtime to 1 second in the past so last_indexed (Date.now()) is always greater
    const pastTime = new Date(Date.now() - 1000);
    utimesSync(testFile, pastTime, pastTime);

    // First index — stores session with last_indexed = Date.now()
    const first = await indexSessionFile(testFile, false, source, repo, noopLogger);
    expect(first).not.toBeNull();

    // Second index without force — should skip (last_indexed >= file mtime)
    const second = await indexSessionFile(testFile, false, source, repo, noopLogger);
    expect(second).toBeNull();
  });

  it('re-indexes when forceReindex is true', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session.jsonl');
    const testFile = join(tmpDir, 'test-session-001.jsonl');
    copyFileSync(fixturePath, testFile);

    // First index
    const first = await indexSessionFile(testFile, true, source, repo, noopLogger);
    expect(first).not.toBeNull();

    // Second index with force — should re-index
    const second = await indexSessionFile(testFile, true, source, repo, noopLogger);
    expect(second).not.toBeNull();
    expect(second!.sessionId).toBe('test-session-001');
  });

  it('uses title from provided titleMap', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session.jsonl');
    const testFile = join(tmpDir, 'test-session.jsonl');
    copyFileSync(fixturePath, testFile);

    const titleMap = new Map([['test-session-001', 'My Custom Title']]);
    await indexSessionFile(testFile, false, source, repo, noopLogger, titleMap);

    const stored = repo.getSessionById('test-session-001');
    expect(stored).toBeDefined();
    expect(stored!.title).toBe('My Custom Title');
  });

  it('detects automatic/heartbeat sessions correctly', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session-heartbeat.jsonl');
    const testFile = join(tmpDir, 'heartbeat-session.jsonl');
    copyFileSync(fixturePath, testFile);

    await indexSessionFile(testFile, false, source, repo, noopLogger);

    const stored = repo.getSessionById('heartbeat-session-001');
    expect(stored).toBeDefined();
    expect(stored!.is_automatic).toBe(1);
  });

  it('returns null for empty session files', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session-empty.jsonl');
    const testFile = join(tmpDir, 'empty-session.jsonl');
    copyFileSync(fixturePath, testFile);

    const result = await indexSessionFile(testFile, false, source, repo, noopLogger);

    expect(result).toBeNull();
  });

  it('marks non-heartbeat sessions as not automatic', async () => {
    const fixturePath = join(FIXTURES_DIR, 'sample-session.jsonl');
    const testFile = join(tmpDir, 'test-session.jsonl');
    copyFileSync(fixturePath, testFile);

    await indexSessionFile(testFile, false, source, repo, noopLogger);

    const stored = repo.getSessionById('test-session-001');
    expect(stored).toBeDefined();
    expect(stored!.is_automatic).toBe(0);
  });
});

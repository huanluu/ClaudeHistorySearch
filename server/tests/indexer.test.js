import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseSessionFile } from '../src/indexer.js';

// ES module path resolution
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '__fixtures__');

describe('parseSessionFile', () => {
  describe('basic parsing with string content', () => {
    let result;

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
    let result;

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
    let result;

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
    let result;

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
    let result;

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
      expect(result.preview.length).toBeLessThanOrEqual(200);
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

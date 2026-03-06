import { join } from 'path';
import { ClaudeSessionSource, loadSessionsIndex } from './ClaudeSessionSource';

const FIXTURES_DIR = join(__dirname, '../../../../tests/__fixtures__');

describe('ClaudeSessionSource', () => {
  const source = new ClaudeSessionSource('/tmp/test-projects');

  it('has correct name and file pattern', () => {
    expect(source.name).toBe('claude');
    expect(source.filePattern).toBe('**/*.jsonl');
  });

  it('parses a standard JSONL session file', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-session.jsonl'));

    expect(result.source).toBe('claude');
    expect(result.sessionId).toBeTruthy();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.lastActivityAt).toBeGreaterThanOrEqual(result.startedAt!);
  });

  it('extracts user and assistant messages', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-session.jsonl'));

    const roles = result.messages.map(m => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('extracts preview from first user message', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-session.jsonl'));

    expect(result.preview).toBeTruthy();
    expect(result.preview!.length).toBeLessThanOrEqual(200);
  });

  it('handles array content blocks', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-session-array-content.jsonl'));

    expect(result.source).toBe('claude');
    expect(result.messages.length).toBeGreaterThan(0);
    // Array content should be joined into text
    const assistantMessages = result.messages.filter(m => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
    expect(assistantMessages[0].content.length).toBeGreaterThan(0);
  });

  it('returns empty session for empty file', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-session-empty.jsonl'));

    expect(result.source).toBe('claude');
    expect(result.sessionId).toBeNull();
    expect(result.messages).toHaveLength(0);
  });

  it('skips command messages in preview extraction', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-session-with-commands.jsonl'));

    // Preview should not start with <command-name> or <local-command
    if (result.preview) {
      expect(result.preview).not.toMatch(/^<command-name>/);
      expect(result.preview).not.toMatch(/^<local-command/);
    }
  });
});

describe('loadSessionsIndex', () => {
  it('returns empty map for non-existent directory', () => {
    const map = loadSessionsIndex('/nonexistent/path');
    expect(map.size).toBe(0);
  });
});

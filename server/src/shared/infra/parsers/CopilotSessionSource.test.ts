import { join } from 'path';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { CopilotSessionSource } from './CopilotSessionSource';

const FIXTURES_DIR = join(__dirname, '../../../../tests/__fixtures__');

describe('CopilotSessionSource', () => {
  const source = new CopilotSessionSource('/tmp/test-copilot-state');

  it('has correct name and file pattern', () => {
    expect(source.name).toBe('copilot');
    expect(source.filePattern).toBe('*/events.jsonl');
  });

  it('parses a Copilot events.jsonl file with correct source', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.source).toBe('copilot');
    expect(result.sessionId).toBe('28c8787e-e026-4249-a8b6-b9ceb4144ee5');
  });

  it('extracts cwd from session.start context', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.project).toBe('/Volumes/Office/Office2/src');
  });

  it('extracts user and assistant messages, skips tool/turn events', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    const roles = result.messages.map(m => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    // Should have: 1 user + 2 assistant = 3 messages
    expect(result.messages).toHaveLength(3);
  });

  it('strips <reminder> and other system tags from user message content', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    const userMessages = result.messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content).not.toContain('<reminder>');
    expect(userMessages[0].content).not.toContain('</reminder>');
    expect(userMessages[0].content).toContain('how to compare 2 WCHAR values');
  });

  it('extracts preview from first user message (without system tags)', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.preview).toBe('how to compare 2 WCHAR values');
  });

  it('assigns timestamps from event timestamps', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.lastActivityAt).toBeGreaterThanOrEqual(result.startedAt!);

    // Each message should have its own timestamp from the event
    for (const msg of result.messages) {
      expect(msg.timestamp).toBeGreaterThan(0);
    }
  });

  it('assigns UUIDs from event IDs', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    const userMsg = result.messages.find(m => m.role === 'user');
    expect(userMsg?.uuid).toBe('user-1');
  });

  it('returns empty session for malformed file', async () => {
    const tmpFile = join(tmpdir(), `malformed-copilot-${Date.now()}.jsonl`);
    writeFileSync(tmpFile, 'not valid json{{{');

    try {
      const result = await source.parse(tmpFile);
      expect(result.source).toBe('copilot');
      expect(result.messages).toHaveLength(0);
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it('returns empty session for nonexistent file', async () => {
    const result = await source.parse('/nonexistent/events.jsonl');
    expect(result.source).toBe('copilot');
    expect(result.sessionId).toBeNull();
    expect(result.messages).toHaveLength(0);
  });

  it('skips assistant messages with no content (tool-only)', async () => {
    const tmpFile = join(tmpdir(), `toolonly-copilot-${Date.now()}.jsonl`);
    writeFileSync(tmpFile, [
      '{"type":"session.start","data":{"sessionId":"test-1","context":{"cwd":"/test"}},"id":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '{"type":"user.message","data":{"content":"hello"},"id":"u1","timestamp":"2025-01-01T00:00:01Z"}',
      '{"type":"assistant.message","data":{"content":"","toolRequests":[{"name":"bash"}]},"id":"a1","timestamp":"2025-01-01T00:00:02Z"}',
      '{"type":"assistant.message","data":{"content":"Here is the answer."},"id":"a2","timestamp":"2025-01-01T00:00:03Z"}',
    ].join('\n'));

    try {
      const result = await source.parse(tmpFile);
      expect(result.messages).toHaveLength(2); // 1 user + 1 assistant with content
      expect(result.messages[1].content).toBe('Here is the answer.');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it('strips <current_datetime> and <sql_tables> tags', async () => {
    const tmpFile = join(tmpdir(), `datetime-copilot-${Date.now()}.jsonl`);
    writeFileSync(tmpFile, [
      '{"type":"session.start","data":{"sessionId":"test-2"},"id":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '{"type":"user.message","data":{"content":"<current_datetime>2025-01-01T00:00:00Z</current_datetime>\\n\\nhello world\\n\\n<reminder>\\n<sql_tables>No tables</sql_tables>\\n</reminder>"},"id":"u1","timestamp":"2025-01-01T00:00:01Z"}',
    ].join('\n'));

    try {
      const result = await source.parse(tmpFile);
      const userMsg = result.messages.find(m => m.role === 'user');
      expect(userMsg?.content).toBe('hello world');
      expect(userMsg?.content).not.toContain('<current_datetime>');
      expect(userMsg?.content).not.toContain('<sql_tables>');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });
});

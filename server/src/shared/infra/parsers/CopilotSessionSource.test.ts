import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { CopilotSessionSource } from './CopilotSessionSource';

const FIXTURES_DIR = join(__dirname, '../../../../tests/__fixtures__');

describe('CopilotSessionSource', () => {
  const source = new CopilotSessionSource('/tmp/test-copilot', '/tmp/test-copilot-state');

  it('has correct name and file pattern', () => {
    expect(source.name).toBe('copilot');
    expect(source.filePattern).toBe('*.json');
  });

  it('parses a Copilot session file with correct source', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.source).toBe('copilot');
    expect(result.sessionId).toBe('28c8787e-e026-4249-a8b6-b9ceb4144ee5');
  });

  it('extracts user and assistant messages, skips tool messages', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    const roles = result.messages.map(m => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).not.toContain('tool');
  });

  it('strips <reminder> tags from user message content', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    const userMessages = result.messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content).not.toContain('<reminder>');
    expect(userMessages[0].content).not.toContain('</reminder>');
    expect(userMessages[0].content).toContain('how to compare 2 WCHAR values');
  });

  it('extracts preview from first user message (without reminder tags)', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.preview).toBe('how to compare 2 WCHAR values');
  });

  it('assigns timestamps from timeline entries', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.lastActivityAt).toBeGreaterThanOrEqual(result.startedAt!);

    // User message should have timeline timestamp
    const userMsg = result.messages.find(m => m.role === 'user');
    expect(userMsg?.timestamp).toBeGreaterThan(0);
  });

  it('skips assistant messages that are tool_calls only (no content)', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

    // The fixture has 5 chatMessages: 1 user, 2 assistant with content, 1 assistant with tool_calls only, 1 tool
    // We should get 1 user + 2 assistant = 3 messages
    expect(result.messages).toHaveLength(3);
  });

  it('returns empty session for malformed JSON', async () => {
    const tmpFile = join(tmpdir(), `malformed-copilot-${Date.now()}.json`);
    writeFileSync(tmpFile, 'not valid json{{{');

    try {
      const result = await source.parse(tmpFile);
      expect(result.source).toBe('copilot');
      expect(result.sessionId).toBeNull();
      expect(result.messages).toHaveLength(0);
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it('returns project from workspace.yaml when available', async () => {
    const testDir = join(tmpdir(), `copilot-workspace-test-${Date.now()}`);
    const historyDir = join(testDir, 'history');
    const stateDir = join(testDir, 'state');
    const sessionId = '28c8787e-e026-4249-a8b6-b9ceb4144ee5';

    try {
      mkdirSync(join(stateDir, sessionId), { recursive: true });
      writeFileSync(
        join(stateDir, sessionId, 'workspace.yaml'),
        'id: 28c8787e-e026-4249-a8b6-b9ceb4144ee5\ncwd: /Volumes/Office/Office2/src\ngit_root: /Volumes/Office/Office2/src\nbranch: main\n'
      );

      const localSource = new CopilotSessionSource(historyDir, stateDir);
      const result = await localSource.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));

      expect(result.project).toBe('/Volumes/Office/Office2/src');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns null project when workspace.yaml is missing', async () => {
    const result = await source.parse(join(FIXTURES_DIR, 'sample-copilot-session.json'));
    // Using /tmp/test-copilot-state which doesn't exist
    expect(result.project).toBeNull();
  });
});

describe('CopilotSessionSource.extractSessionId', () => {
  it('extracts UUID from standard filename', () => {
    const id = CopilotSessionSource.extractSessionId('session_28c8787e-e026-4249-a8b6-b9ceb4144ee5_1762525528867.json');
    expect(id).toBe('28c8787e-e026-4249-a8b6-b9ceb4144ee5');
  });

  it('returns null for non-matching filename', () => {
    expect(CopilotSessionSource.extractSessionId('random-file.json')).toBeNull();
    expect(CopilotSessionSource.extractSessionId('session_.json')).toBeNull();
  });
});

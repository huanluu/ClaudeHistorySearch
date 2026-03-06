import { createDatabase, createSessionRepository } from './index';
import type { SessionRepository, IndexSessionParams } from './index';
import { noopLogger } from '../../../../tests/__helpers/index';

function makeSession(overrides: Partial<IndexSessionParams> = {}): IndexSessionParams {
  const now = Date.now();
  return {
    sessionId: 'test-session-1',
    project: '/test/project',
    startedAt: now - 10000,
    lastActivityAt: now,
    messageCount: 2,
    preview: 'Hello world',
    title: 'Test session summary',
    lastIndexed: now,
    isAutomatic: false,
    source: 'claude',
    messages: [
      { role: 'human', content: 'Hello world', timestamp: now - 10000, uuid: 'msg-1' },
      { role: 'assistant', content: 'Hi there, how can I help?', timestamp: now - 5000, uuid: 'msg-2' },
    ],
    ...overrides,
  };
}

describe('SqliteSessionRepository', () => {
  let repo: SessionRepository;

  beforeEach(() => {
    const db = createDatabase(':memory:', noopLogger);
    repo = createSessionRepository(db);
  });

  it('indexSession inserts a session and its messages', () => {
    const params = makeSession();
    repo.indexSession(params);

    const session = repo.getSessionById('test-session-1');
    expect(session).toBeDefined();
    expect(session!.id).toBe('test-session-1');
    expect(session!.project).toBe('/test/project');
    expect(session!.title).toBe('Test session summary');
    expect(session!.message_count).toBe(2);

    const messages = repo.getMessagesBySessionId('test-session-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('human');
    expect(messages[0].content).toBe('Hello world');
    expect(messages[1].role).toBe('assistant');
  });

  it('indexSession with clearExisting replaces old messages', () => {
    const params = makeSession();
    repo.indexSession(params);

    // Re-index with different messages
    const updated = makeSession({
      messages: [
        { role: 'human', content: 'New question', timestamp: Date.now(), uuid: 'msg-3' },
      ],
      messageCount: 1,
    });
    repo.indexSession(updated);

    const messages = repo.getMessagesBySessionId('test-session-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('New question');
  });

  it('getRecentSessions returns sessions ordered by timestamp DESC', () => {
    const now = Date.now();
    repo.indexSession(makeSession({ sessionId: 'old', lastActivityAt: now - 20000, startedAt: now - 30000 }));
    repo.indexSession(makeSession({ sessionId: 'mid', lastActivityAt: now - 10000, startedAt: now - 20000 }));
    repo.indexSession(makeSession({ sessionId: 'new', lastActivityAt: now, startedAt: now - 10000 }));

    const sessions = repo.getRecentSessions(10, 0);
    expect(sessions).toHaveLength(3);
    expect(sessions[0].id).toBe('new');
    expect(sessions[1].id).toBe('mid');
    expect(sessions[2].id).toBe('old');
  });

  it('getRecentSessions respects limit parameter', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      repo.indexSession(makeSession({ sessionId: `s-${i}`, lastActivityAt: now - i * 1000 }));
    }

    const sessions = repo.getRecentSessions(3, 0);
    expect(sessions).toHaveLength(3);
  });

  it('getRecentSessions respects offset parameter for pagination', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      repo.indexSession(makeSession({ sessionId: `s-${i}`, lastActivityAt: now - i * 1000 }));
    }

    const page1 = repo.getRecentSessions(2, 0);
    const page2 = repo.getRecentSessions(2, 2);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].id).not.toBe(page2[0].id);
    // Verify page2 starts where page1 left off
    const all = repo.getRecentSessions(10, 0);
    expect(page2[0].id).toBe(all[2].id);
  });

  it('getRecentSessions excludes hidden sessions', () => {
    repo.indexSession(makeSession({ sessionId: 'visible' }));
    repo.indexSession(makeSession({ sessionId: 'hidden' }));

    repo.hideSession('hidden');

    const sessions = repo.getRecentSessions(10, 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('visible');
  });

  it('getRecentSessions with automaticOnly filters by is_automatic', () => {
    repo.indexSession(makeSession({ sessionId: 'manual', isAutomatic: false }));
    repo.indexSession(makeSession({ sessionId: 'auto', isAutomatic: true }));

    const automaticSessions = repo.getAutomaticSessions(10, 0);
    expect(automaticSessions).toHaveLength(1);
    expect(automaticSessions[0].id).toBe('auto');

    const manualSessions = repo.getManualSessions(10, 0);
    expect(manualSessions).toHaveLength(1);
    expect(manualSessions[0].id).toBe('manual');
  });

  it('searchMessages finds messages by keyword using FTS5', () => {
    repo.indexSession(makeSession({
      sessionId: 'fts-test',
      messages: [
        { role: 'human', content: 'How do I configure webpack?', timestamp: Date.now(), uuid: 'fts-1' },
        { role: 'assistant', content: 'You can configure webpack using a config file.', timestamp: Date.now(), uuid: 'fts-2' },
      ],
    }));

    const results = repo.searchMessages('webpack', 10, 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.session_id === 'fts-test')).toBe(true);
  });

  it('searchMessages returns BM25-ranked results for sort=relevance', () => {
    // Session with many mentions of "typescript" should rank higher
    repo.indexSession(makeSession({
      sessionId: 'high-relevance',
      isAutomatic: false,
      messages: [
        { role: 'human', content: 'typescript typescript typescript guide', timestamp: Date.now(), uuid: 'hr-1' },
      ],
    }));
    repo.indexSession(makeSession({
      sessionId: 'low-relevance',
      isAutomatic: false,
      messages: [
        { role: 'human', content: 'I heard about typescript once', timestamp: Date.now(), uuid: 'lr-1' },
      ],
    }));

    const results = repo.searchMessages('typescript', 10, 0, 'relevance');
    expect(results.length).toBe(2);
    // BM25 scores are negative; lower (more negative) = more relevant in SQLite FTS5
    expect(results[0].rank).toBeLessThanOrEqual(results[1].rank);
  });

  it('searchMessages returns date-sorted results for sort=date', () => {
    const now = Date.now();
    repo.indexSession(makeSession({
      sessionId: 'older',
      startedAt: now - 100000,
      lastActivityAt: now - 90000,
      isAutomatic: false,
      messages: [
        { role: 'human', content: 'database migration steps', timestamp: now - 100000, uuid: 'old-1' },
      ],
    }));
    repo.indexSession(makeSession({
      sessionId: 'newer',
      startedAt: now - 1000,
      lastActivityAt: now,
      isAutomatic: false,
      messages: [
        { role: 'human', content: 'database connection pooling', timestamp: now - 1000, uuid: 'new-1' },
      ],
    }));

    const results = repo.searchMessages('database', 10, 0, 'date');
    expect(results.length).toBe(2);
    // Date sort: newest session first
    expect(results[0].started_at).toBeGreaterThan(results[1].started_at);
  });

  it('hideSession makes session excluded from getRecentSessions', () => {
    repo.indexSession(makeSession({ sessionId: 'to-hide' }));

    let sessions = repo.getRecentSessions(10, 0);
    expect(sessions.some(s => s.id === 'to-hide')).toBe(true);

    repo.hideSession('to-hide');

    sessions = repo.getRecentSessions(10, 0);
    expect(sessions.some(s => s.id === 'to-hide')).toBe(false);
  });

  it('markSessionAsRead sets is_unread to 0', () => {
    // Automatic sessions start with is_unread = 1
    repo.indexSession(makeSession({ sessionId: 'unread-test', isAutomatic: true }));

    let session = repo.getSessionById('unread-test');
    expect(session!.is_unread).toBe(1);

    repo.markSessionAsRead('unread-test');

    session = repo.getSessionById('unread-test');
    expect(session!.is_unread).toBe(0);
  });

  it('getStats returns correct session and message counts', () => {
    repo.indexSession(makeSession({ sessionId: 'stats-1', messages: [
      { role: 'human', content: 'msg one', timestamp: Date.now(), uuid: 'st-1' },
    ] }));
    repo.indexSession(makeSession({ sessionId: 'stats-2', messages: [
      { role: 'human', content: 'msg two', timestamp: Date.now(), uuid: 'st-2' },
      { role: 'assistant', content: 'msg three', timestamp: Date.now(), uuid: 'st-3' },
    ] }));

    const stats = repo.getStats(':memory:');
    expect(stats.sessionCount).toBe(2);
    expect(stats.messageCount).toBe(3);
    // In-memory DB has no file, so dbSizeBytes should be 0
    expect(stats.dbSizeBytes).toBe(0);
  });

  it('getLastIndexed returns null for unknown session ID', () => {
    const record = repo.getSessionLastIndexed('nonexistent');
    expect(record).toBeUndefined();
  });

  it('getLastIndexed returns record with mtime for indexed session', () => {
    const now = Date.now();
    repo.indexSession(makeSession({ sessionId: 'indexed', lastIndexed: now }));

    const record = repo.getSessionLastIndexed('indexed');
    expect(record).toBeDefined();
    expect(record!.last_indexed).toBe(now);
  });
});

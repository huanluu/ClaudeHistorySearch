import Database, { Statement } from 'better-sqlite3';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create a test database with the same schema as the production one
const TEST_DB_DIR = join(tmpdir(), `claude-history-db-test-${Date.now()}`);
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');

interface SessionRecord {
  id: string;
  project: string;
  started_at: number;
  last_activity_at: number | null;
  message_count: number;
  preview: string | null;
  title: string | null;
  last_indexed: number | null;
}

interface MessageRecord {
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  uuid: string;
}

interface SearchResult extends MessageRecord {
  project: string;
  started_at: number;
  title: string | null;
  highlighted_content: string;
  rank: number;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface TableInfo {
  name: string;
}

let db: Database.Database;
let insertSession: Statement<unknown[]>;
let insertMessage: Statement<unknown[]>;
let getSessionById: Statement<unknown[], SessionRecord>;
let getRecentSessions: Statement<unknown[], SessionRecord>;
let getMessagesBySessionId: Statement<unknown[], MessageRecord>;
let searchMessagesByRelevance: Statement<unknown[], SearchResult>;
let searchMessagesByDate: Statement<unknown[], SearchResult>;
let clearSessionMessages: Statement<unknown[]>;

function setupDatabase(): void {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create tables matching production schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_activity_at INTEGER,
      message_count INTEGER DEFAULT 0,
      preview TEXT,
      title TEXT,
      last_indexed INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC);
  `);

  // Create FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      session_id,
      role,
      content,
      timestamp UNINDEXED,
      uuid UNINDEXED,
      tokenize='porter unicode61'
    );
  `);

  // Prepare statements
  insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (id, project, started_at, last_activity_at, message_count, preview, title, last_indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertMessage = db.prepare(`
    INSERT INTO messages_fts (session_id, role, content, timestamp, uuid)
    VALUES (?, ?, ?, ?, ?)
  `);

  getSessionById = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

  getRecentSessions = db.prepare(`
    SELECT * FROM sessions
    ORDER BY COALESCE(last_activity_at, started_at) DESC
    LIMIT ? OFFSET ?
  `);

  getMessagesBySessionId = db.prepare(`
    SELECT session_id, role, content, timestamp, uuid
    FROM messages_fts
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `);

  searchMessagesByRelevance = db.prepare(`
    SELECT
      messages_fts.session_id,
      messages_fts.role,
      messages_fts.content,
      messages_fts.timestamp,
      messages_fts.uuid,
      sessions.project,
      sessions.started_at,
      sessions.title,
      highlight(messages_fts, 2, '<mark>', '</mark>') as highlighted_content,
      bm25(messages_fts) as rank
    FROM messages_fts
    JOIN sessions ON sessions.id = messages_fts.session_id
    WHERE messages_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `);

  searchMessagesByDate = db.prepare(`
    SELECT
      messages_fts.session_id,
      messages_fts.role,
      messages_fts.content,
      messages_fts.timestamp,
      messages_fts.uuid,
      sessions.project,
      sessions.started_at,
      sessions.title,
      highlight(messages_fts, 2, '<mark>', '</mark>') as highlighted_content,
      bm25(messages_fts) as rank
    FROM messages_fts
    JOIN sessions ON sessions.id = messages_fts.session_id
    WHERE messages_fts MATCH ?
    ORDER BY sessions.started_at DESC, rank
    LIMIT ? OFFSET ?
  `);

  clearSessionMessages = db.prepare(`DELETE FROM messages_fts WHERE session_id = ?`);
}

function teardownDatabase(): void {
  if (db) {
    db.close();
  }
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
}

function seedTestData(): void {
  const now = Date.now();

  // Session 1: React tutorial
  insertSession.run(
    'session-react-001',
    '/Users/test/react-project',
    now - 86400000, // 1 day ago
    now - 86000000,
    4,
    'How do I create a React component?',
    'React Component Tutorial',
    now
  );

  insertMessage.run('session-react-001', 'user', 'How do I create a React component?', now - 86400000, 'msg-001');
  insertMessage.run('session-react-001', 'assistant', 'To create a React component, you can use either a function or a class. Functional components are now preferred.', now - 86300000, 'msg-002');
  insertMessage.run('session-react-001', 'user', 'Can you show me with props?', now - 86200000, 'msg-003');
  insertMessage.run('session-react-001', 'assistant', 'Here is a component with props: function Greeting({ name }) { return <h1>Hello, {name}!</h1>; }', now - 86100000, 'msg-004');

  // Session 2: Python debugging
  insertSession.run(
    'session-python-002',
    '/Users/test/python-project',
    now - 172800000, // 2 days ago
    now - 172000000,
    2,
    'Why is my Python code throwing an error?',
    'Python Debugging Session',
    now
  );

  insertMessage.run('session-python-002', 'user', 'Why is my Python code throwing an error? I get TypeError: cannot unpack non-iterable NoneType object', now - 172800000, 'msg-005');
  insertMessage.run('session-python-002', 'assistant', 'This error occurs when you try to unpack a None value. Make sure your function returns a tuple, not None.', now - 172700000, 'msg-006');

  // Session 3: JavaScript async
  insertSession.run(
    'session-js-003',
    '/Users/test/js-project',
    now - 3600000, // 1 hour ago
    now - 3500000,
    3,
    'How do async/await work?',
    'JavaScript Async Tutorial',
    now
  );

  insertMessage.run('session-js-003', 'user', 'How do async/await work in JavaScript?', now - 3600000, 'msg-007');
  insertMessage.run('session-js-003', 'assistant', 'Async/await is syntactic sugar for Promises. The async keyword marks a function as asynchronous, and await pauses execution until a Promise resolves.', now - 3550000, 'msg-008');
  insertMessage.run('session-js-003', 'user', 'What about error handling?', now - 3500000, 'msg-009');
}

describe('Database Schema', () => {
  beforeAll(() => {
    setupDatabase();
  });

  afterAll(() => {
    teardownDatabase();
  });

  it('should create sessions table with correct columns', () => {
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as ColumnInfo[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('project');
    expect(columnNames).toContain('started_at');
    expect(columnNames).toContain('last_activity_at');
    expect(columnNames).toContain('message_count');
    expect(columnNames).toContain('preview');
    expect(columnNames).toContain('title');
    expect(columnNames).toContain('last_indexed');
  });

  it('should create FTS5 virtual table for messages', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'").all() as TableInfo[];
    expect(tables.length).toBe(1);
  });
});

describe('Session Operations', () => {
  beforeAll(() => {
    setupDatabase();
    seedTestData();
  });

  afterAll(() => {
    teardownDatabase();
  });

  it('should insert and retrieve a session', () => {
    const session = getSessionById.get('session-react-001');
    expect(session).toBeDefined();
    expect(session!.id).toBe('session-react-001');
    expect(session!.project).toBe('/Users/test/react-project');
    expect(session!.title).toBe('React Component Tutorial');
    expect(session!.message_count).toBe(4);
  });

  it('should retrieve recent sessions ordered by last activity', () => {
    const sessions = getRecentSessions.all(10, 0);
    expect(sessions.length).toBe(3);
    // Most recent should be first (js-003 was 1 hour ago)
    expect(sessions[0].id).toBe('session-js-003');
  });

  it('should retrieve messages for a session', () => {
    const messages = getMessagesBySessionId.all('session-react-001');
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('React component');
  });
});

describe('FTS5 Full-Text Search', () => {
  beforeAll(() => {
    setupDatabase();
    seedTestData();
  });

  afterAll(() => {
    teardownDatabase();
  });

  it('should find messages by exact term', () => {
    const results = searchMessagesByRelevance.all('React', 50, 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.session_id === 'session-react-001')).toBe(true);
  });

  it('should find messages using prefix matching', () => {
    // FTS5 prefix matching with *
    const results = searchMessagesByRelevance.all('Promis*', 50, 0);
    expect(results.length).toBeGreaterThan(0);
    // Should find the async/await explanation that mentions Promise
    expect(results.some(r => r.content.toLowerCase().includes('promise'))).toBe(true);
  });

  it('should highlight matching terms', () => {
    const results = searchMessagesByRelevance.all('Python', 50, 0);
    expect(results.length).toBeGreaterThan(0);
    const pythonResult = results.find(r => r.session_id === 'session-python-002');
    expect(pythonResult).toBeDefined();
    expect(pythonResult!.highlighted_content).toContain('<mark>');
  });

  it('should use porter stemmer for stemming', () => {
    // "creating" should match "create" due to stemming
    const results = searchMessagesByRelevance.all('creating', 50, 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.toLowerCase().includes('create'))).toBe(true);
  });

  it('should return results with session metadata', () => {
    const results = searchMessagesByRelevance.all('component', 50, 0);
    expect(results.length).toBeGreaterThan(0);
    const result = results[0];
    expect(result.project).toBeDefined();
    expect(result.started_at).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.rank).toBeDefined();
  });

  it('should support date sorting', () => {
    const results = searchMessagesByDate.all('JavaScript OR Python OR React', 50, 0);
    expect(results.length).toBeGreaterThan(0);
    // Results should be ordered by started_at DESC
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].started_at).toBeGreaterThanOrEqual(results[i].started_at);
    }
  });

  it('should respect pagination', () => {
    const all = searchMessagesByRelevance.all('error OR component OR async', 50, 0);
    const page1 = searchMessagesByRelevance.all('error OR component OR async', 2, 0);
    const page2 = searchMessagesByRelevance.all('error OR component OR async', 2, 2);

    expect(page1.length).toBeLessThanOrEqual(2);
    expect(page2.length).toBeLessThanOrEqual(2);

    if (all.length > 2) {
      expect(page1[0].uuid).toBe(all[0].uuid);
      expect(page2[0].uuid).toBe(all[2].uuid);
    }
  });

  it('should handle empty results gracefully', () => {
    const results = searchMessagesByRelevance.all('xyznonexistent123', 50, 0);
    expect(results).toEqual([]);
  });
});

describe('Session Message Management', () => {
  beforeAll(() => {
    setupDatabase();
    seedTestData();
  });

  afterAll(() => {
    teardownDatabase();
  });

  it('should clear session messages', () => {
    // First verify messages exist
    let messages = getMessagesBySessionId.all('session-react-001');
    expect(messages.length).toBe(4);

    // Clear messages
    clearSessionMessages.run('session-react-001');

    // Verify messages are gone
    messages = getMessagesBySessionId.all('session-react-001');
    expect(messages.length).toBe(0);
  });

  it('should handle upsert with INSERT OR REPLACE', () => {
    const now = Date.now();

    // Insert a session
    insertSession.run('session-upsert', '/test', now, now, 1, 'preview', 'Original Title', now);

    let session = getSessionById.get('session-upsert');
    expect(session!.title).toBe('Original Title');

    // Update the same session
    insertSession.run('session-upsert', '/test', now, now, 2, 'updated preview', 'Updated Title', now);

    session = getSessionById.get('session-upsert');
    expect(session!.title).toBe('Updated Title');
    expect(session!.message_count).toBe(2);
  });
});

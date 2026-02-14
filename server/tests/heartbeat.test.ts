import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { EventEmitter } from 'events';
import { jest } from '@jest/globals';
import {
  HeartbeatService,
  type HeartbeatConfig,
  type HeartbeatTask,
  type WorkItem,
  type CommandExecutor
} from '../src/services/HeartbeatService.js';
import type { HeartbeatRepository } from '../src/database/interfaces.js';
import type { HeartbeatStateRecord } from '../src/database/connection.js';

/**
 * Create a mock ChildProcess that emits a stream-json init message on stdout,
 * then fires 'close' with the given exit code. This simulates the fire-and-forget
 * pattern where runClaudeAnalysis reads the session_id from the first JSON line.
 */
function createMockChildProcess(exitCode = 0, sessionId = 'mock-session-id') {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    unref: () => void;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.unref = () => {};

  // Emit init message on next tick so the listener is attached first
  setTimeout(() => {
    const initMsg = JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/test',
      session_id: sessionId
    });
    stdout.emit('data', Buffer.from(initMsg + '\n'));
    // Then close after a bit
    setTimeout(() => child.emit('close', exitCode), 10);
  }, 5);

  return child as unknown as ReturnType<CommandExecutor['spawn']>;
}

// Test database setup
const TEST_DB_DIR = join(tmpdir(), `claude-history-heartbeat-test-${Date.now()}`);
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');

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

/**
 * Creates a test database with the FULL production schema including heartbeat columns.
 * This simulates what the production database.ts should create.
 */
function setupDatabaseWithHeartbeatSchema(): void {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create sessions table WITH heartbeat columns (what we expect after implementation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_activity_at INTEGER,
      message_count INTEGER DEFAULT 0,
      preview TEXT,
      title TEXT,
      last_indexed INTEGER,
      is_automatic INTEGER DEFAULT 0,
      is_unread INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC);
  `);

  // Create heartbeat_state table
  db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_state (
      key TEXT PRIMARY KEY,
      last_changed TEXT,
      last_processed INTEGER
    );
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
}

function teardownDatabase(): void {
  if (db) {
    db.close();
  }
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
}

// =============================================================================
// PHASE 1: Database Schema Tests
// =============================================================================

describe('Heartbeat Database Schema', () => {
  beforeAll(() => {
    setupDatabaseWithHeartbeatSchema();
  });

  afterAll(() => {
    teardownDatabase();
  });

  describe('sessions table heartbeat columns', () => {
    it('should have is_automatic column', () => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as ColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('is_automatic');
    });

    it('should have is_automatic column with default value 0', () => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as ColumnInfo[];
      const isAutomaticCol = columns.find(c => c.name === 'is_automatic');

      expect(isAutomaticCol).toBeDefined();
      // SQLite returns default value as string
      expect(String(isAutomaticCol!.dflt_value)).toBe('0');
    });

    it('should have is_unread column', () => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as ColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('is_unread');
    });

    it('should have is_unread column with default value 0', () => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as ColumnInfo[];
      const isUnreadCol = columns.find(c => c.name === 'is_unread');

      expect(isUnreadCol).toBeDefined();
      // SQLite returns default value as string
      expect(String(isUnreadCol!.dflt_value)).toBe('0');
    });
  });

  describe('heartbeat_state table', () => {
    it('should exist', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='heartbeat_state'")
        .all() as TableInfo[];

      expect(tables.length).toBe(1);
    });

    it('should have key column as primary key', () => {
      const columns = db.prepare("PRAGMA table_info(heartbeat_state)").all() as ColumnInfo[];
      const keyCol = columns.find(c => c.name === 'key');

      expect(keyCol).toBeDefined();
      expect(keyCol!.pk).toBe(1);
    });

    it('should have last_changed column', () => {
      const columns = db.prepare("PRAGMA table_info(heartbeat_state)").all() as ColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('last_changed');
    });

    it('should have last_processed column', () => {
      const columns = db.prepare("PRAGMA table_info(heartbeat_state)").all() as ColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('last_processed');
    });
  });

  describe('session operations with heartbeat columns', () => {
    it('should insert session with is_automatic flag', () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project, started_at, message_count, is_automatic, is_unread)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('test-automatic-session', '/test/project', now, 5, 1, 1);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-automatic-session') as {
        id: string;
        is_automatic: number;
        is_unread: number;
      };

      expect(session.is_automatic).toBe(1);
      expect(session.is_unread).toBe(1);
    });

    it('should default is_automatic to 0 for regular sessions', () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project, started_at, message_count)
        VALUES (?, ?, ?, ?)
      `).run('test-regular-session', '/test/project', now, 3);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-regular-session') as {
        id: string;
        is_automatic: number;
        is_unread: number;
      };

      expect(session.is_automatic).toBe(0);
      expect(session.is_unread).toBe(0);
    });

    it('should update is_unread when marking as read', () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, project, started_at, message_count, is_automatic, is_unread)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('test-mark-read-session', '/test/project', now, 2, 1, 1);

      // Mark as read
      db.prepare('UPDATE sessions SET is_unread = 0 WHERE id = ?').run('test-mark-read-session');

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-mark-read-session') as {
        id: string;
        is_automatic: number;
        is_unread: number;
      };

      expect(session.is_automatic).toBe(1); // Still automatic
      expect(session.is_unread).toBe(0); // Now read
    });
  });

  describe('heartbeat_state operations', () => {
    it('should insert and retrieve heartbeat state', () => {
      const now = Date.now();
      db.prepare(`
        INSERT INTO heartbeat_state (key, last_changed, last_processed)
        VALUES (?, ?, ?)
      `).run('workitem:12345', '2024-01-15T10:00:00Z', now);

      const state = db.prepare('SELECT * FROM heartbeat_state WHERE key = ?').get('workitem:12345') as {
        key: string;
        last_changed: string;
        last_processed: number;
      };

      expect(state.key).toBe('workitem:12345');
      expect(state.last_changed).toBe('2024-01-15T10:00:00Z');
      expect(state.last_processed).toBe(now);
    });

    it('should update heartbeat state on conflict', () => {
      const now = Date.now();
      const later = now + 1000;

      db.prepare(`
        INSERT OR REPLACE INTO heartbeat_state (key, last_changed, last_processed)
        VALUES (?, ?, ?)
      `).run('workitem:99999', '2024-01-15T10:00:00Z', now);

      db.prepare(`
        INSERT OR REPLACE INTO heartbeat_state (key, last_changed, last_processed)
        VALUES (?, ?, ?)
      `).run('workitem:99999', '2024-01-16T10:00:00Z', later);

      const state = db.prepare('SELECT * FROM heartbeat_state WHERE key = ?').get('workitem:99999') as {
        key: string;
        last_changed: string;
        last_processed: number;
      };

      expect(state.last_changed).toBe('2024-01-16T10:00:00Z');
      expect(state.last_processed).toBe(later);
    });
  });
});

// =============================================================================
// PHASE 1: Production Database Module Tests
// These tests verify the actual database.ts module creates the schema correctly
// =============================================================================

describe('Production Database Module (Heartbeat Schema)', () => {
  // These tests import from the actual database module to verify migrations work

  it('should construct SqliteHeartbeatRepository from production db', async () => {
    const dbModule = await import('../src/database/connection.js');
    const { SqliteHeartbeatRepository } = await import('../src/database/SqliteHeartbeatRepository.js');

    expect(typeof dbModule.db).toBe('object');

    // Should not throw — heartbeat_state table exists
    const repo = new SqliteHeartbeatRepository(dbModule.db);
    expect(repo).toBeDefined();

    // Verify sessions table has heartbeat columns in production DB
    const columns = dbModule.db.prepare("PRAGMA table_info(sessions)").all() as ColumnInfo[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('is_automatic');
    expect(columnNames).toContain('is_unread');
  });

  it('should have heartbeat_state table in production database', async () => {
    const dbModule = await import('../src/database/connection.js');

    const tables = dbModule.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='heartbeat_state'")
      .all() as TableInfo[];

    expect(tables.length).toBe(1);
  });
});

// =============================================================================
// PHASE 2: HeartbeatService Config & Parsing Tests
// =============================================================================

describe('HeartbeatService', () => {
  const TEST_CONFIG_DIR = join(tmpdir(), `claude-heartbeat-config-test-${Date.now()}`);
  const originalEnv = { ...process.env };

  beforeAll(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('config loading', () => {
    it('should use default values when config file is missing', () => {
      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBe(3600000); // 1 hour default
      expect(config.workingDirectory).toBe(process.cwd());
    });

    it('should load config from config.json', () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: {
          enabled: false,
          intervalMs: 60000,
          workingDirectory: '/custom/path'
        }
      }));

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const config = service.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(60000);
      expect(config.workingDirectory).toBe('/custom/path');

      // Cleanup
      rmSync(configPath);
    });

    it('should override config with environment variables', () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: {
          enabled: true,
          intervalMs: 3600000,
          workingDirectory: '/from/config'
        }
      }));

      // Environment variables should override config file
      process.env.HEARTBEAT_ENABLED = 'false';
      process.env.HEARTBEAT_INTERVAL_MS = '30000';
      process.env.HEARTBEAT_WORKING_DIR = '/from/env';

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const config = service.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(30000);
      expect(config.workingDirectory).toBe('/from/env');

      // Cleanup
      rmSync(configPath);
    });

    it('should handle partial config in config.json', () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: {
          intervalMs: 120000
          // enabled and workingDirectory not specified
        }
      }));

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const config = service.getConfig();

      expect(config.enabled).toBe(true); // default
      expect(config.intervalMs).toBe(120000); // from config
      expect(config.workingDirectory).toBe(process.cwd()); // default

      // Cleanup
      rmSync(configPath);
    });

    it('should handle malformed config.json gracefully', () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, 'not valid json {{{');

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const config = service.getConfig();

      // Should fall back to defaults
      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBe(3600000);

      // Cleanup
      rmSync(configPath);
    });
  });

  describe('HEARTBEAT.md parsing', () => {
    it('should parse enabled tasks (checked items)', () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md

## Work Items
- [x] Fetch Azure DevOps work items assigned to me
- [x] Analyze with codebase context

## Pull Requests
- [ ] Check for PRs needing review
`);

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const tasks = service.parseHeartbeatFile();

      expect(tasks.length).toBe(2);
      expect(tasks[0].description).toBe('Fetch Azure DevOps work items assigned to me');
      expect(tasks[0].section).toBe('Work Items');
      expect(tasks[1].description).toBe('Analyze with codebase context');

      // Cleanup
      rmSync(heartbeatPath);
    });

    it('should skip disabled tasks (unchecked items)', () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md

## Work Items
- [ ] Disabled task
- [x] Enabled task
- [ ] Another disabled task
`);

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const tasks = service.parseHeartbeatFile();

      expect(tasks.length).toBe(1);
      expect(tasks[0].description).toBe('Enabled task');

      // Cleanup
      rmSync(heartbeatPath);
    });

    it('should handle missing HEARTBEAT.md gracefully', () => {
      // Ensure no HEARTBEAT.md exists
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      if (existsSync(heartbeatPath)) {
        rmSync(heartbeatPath);
      }

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const tasks = service.parseHeartbeatFile();

      expect(tasks).toEqual([]);
    });

    it('should handle empty HEARTBEAT.md', () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, '');

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const tasks = service.parseHeartbeatFile();

      expect(tasks).toEqual([]);

      // Cleanup
      rmSync(heartbeatPath);
    });

    it('should parse multiple sections', () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md

## Work Items
- [x] Task in work items

## Pull Requests
- [x] Task in pull requests

## Custom Section
- [x] Task in custom section
`);

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const tasks = service.parseHeartbeatFile();

      expect(tasks.length).toBe(3);
      expect(tasks[0].section).toBe('Work Items');
      expect(tasks[1].section).toBe('Pull Requests');
      expect(tasks[2].section).toBe('Custom Section');

      // Cleanup
      rmSync(heartbeatPath);
    });

    it('should ignore non-checklist content', () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md

Some descriptive text here.

## Work Items
- [x] Valid task

Regular bullet point:
- Not a checklist item

More text.
`);

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const tasks = service.parseHeartbeatFile();

      expect(tasks.length).toBe(1);
      expect(tasks[0].description).toBe('Valid task');

      // Cleanup
      rmSync(heartbeatPath);
    });
  });

  // =============================================================================
  // PHASE 3: Change Detection & Claude Spawning Tests
  // Uses dependency injection for testability (no mocking native modules)
  // =============================================================================

  describe('change detection', () => {
    it('should detect new work items not in heartbeat_state', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      // Create mock command executor
      const mockWorkItems: WorkItem[] = [
        {
          id: 12345,
          fields: {
            'System.Title': 'Test Work Item',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const changes = await service.checkForChanges();

      expect(changes.newItems.length).toBe(1);
      expect(changes.newItems[0].id).toBe(12345);
      expect(changes.updatedItems.length).toBe(0);

      rmSync(heartbeatPath);
    });

    it('should detect updated work items by changed_date', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 12345,
          fields: {
            'System.Title': 'Updated Work Item',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);

      // Record work item as processed with OLD date
      service.recordProcessedItem('workitem:12345', '2024-01-14T10:00:00Z');

      const changes = await service.checkForChanges();

      expect(changes.newItems.length).toBe(0);
      expect(changes.updatedItems.length).toBe(1);
      expect(changes.updatedItems[0].id).toBe(12345);

      rmSync(heartbeatPath);
    });

    it('should skip unchanged work items', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 12345,
          fields: {
            'System.Title': 'Unchanged Work Item',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);

      // Record work item as processed with SAME date
      service.recordProcessedItem('workitem:12345', '2024-01-15T10:00:00Z');

      const changes = await service.checkForChanges();

      expect(changes.newItems.length).toBe(0);
      expect(changes.updatedItems.length).toBe(0);

      rmSync(heartbeatPath);
    });

    it('should handle az CLI errors gracefully', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockExecutor: CommandExecutor = {
        execSync: () => { throw new Error('az: command not found'); },
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const changes = await service.checkForChanges();

      expect(changes.newItems.length).toBe(0);
      expect(changes.updatedItems.length).toBe(0);
      expect(changes.errors.length).toBeGreaterThan(0);

      rmSync(heartbeatPath);
    });
  });

  describe('Claude spawning', () => {
    it('should spawn claude with correct arguments', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      let capturedArgs: string[] = [];
      let capturedOptions: { cwd?: string; env?: Record<string, string>; stdio?: string[] } = {};

      const mockExecutor: CommandExecutor = {
        execSync: () => '[]',
        spawn: (cmd: string, args: string[], options: unknown) => {
          capturedArgs = args;
          capturedOptions = options as typeof capturedOptions;
          return createMockChildProcess(0);
        }
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const workItem: WorkItem = {
        id: 99999,
        fields: {
          'System.Title': 'Test Item',
          'System.State': 'Active',
          'System.ChangedDate': '2024-01-15T10:00:00Z',
          'System.AssignedTo': { uniqueName: 'test@example.com' }
        }
      };

      await service.runClaudeAnalysis(workItem);

      expect(capturedArgs).toContain('-p');
      expect(capturedArgs).toContain('--output-format');
      expect(capturedArgs).toContain('stream-json');
      expect(capturedArgs).toContain('--verbose');
      expect(capturedArgs).toContain('--dangerously-skip-permissions');
      expect(capturedOptions.env?.CI).toBe('1');
      expect(capturedOptions.env?.TERM).toBe('dumb');
      expect(capturedOptions.env?.NO_COLOR).toBe('1');
      expect(capturedOptions.stdio).toEqual(['ignore', 'pipe', 'pipe']);

      rmSync(heartbeatPath);
    });

    it('should include HEARTBEAT_SESSION marker in prompt', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      let capturedPrompt = '';

      const mockExecutor: CommandExecutor = {
        execSync: () => '[]',
        spawn: (_cmd: string, args: string[]) => {
          const promptIndex = args.indexOf('-p');
          if (promptIndex !== -1) {
            capturedPrompt = args[promptIndex + 1];
          }
          return createMockChildProcess(0);
        }
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const workItem: WorkItem = {
        id: 88888,
        fields: {
          'System.Title': 'Another Test Item',
          'System.State': 'Active',
          'System.ChangedDate': '2024-01-15T10:00:00Z',
          'System.AssignedTo': { uniqueName: 'test@example.com' }
        }
      };

      await service.runClaudeAnalysis(workItem);

      expect(capturedPrompt).toContain('HEARTBEAT_SESSION');
      expect(capturedPrompt).toContain('[Heartbeat]');
      expect(capturedPrompt).toContain('88888');

      rmSync(heartbeatPath);
    });

    it('should use configured working directory', async () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: { workingDirectory: '/custom/work/dir' }
      }));

      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      let capturedCwd = '';

      const mockExecutor: CommandExecutor = {
        execSync: () => '[]',
        spawn: (_cmd: string, _args: string[], options: unknown) => {
          capturedCwd = (options as { cwd: string }).cwd;
          return createMockChildProcess(0);
        }
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const workItem: WorkItem = {
        id: 77777,
        fields: {
          'System.Title': 'Test',
          'System.State': 'Active',
          'System.ChangedDate': '2024-01-15T10:00:00Z',
          'System.AssignedTo': { uniqueName: 'test@example.com' }
        }
      };

      await service.runClaudeAnalysis(workItem);

      expect(capturedCwd).toBe('/custom/work/dir');

      rmSync(heartbeatPath);
      rmSync(configPath);
    });
  });

  // =============================================================================
  // PHASE 4: runHeartbeat() Integration Tests
  // =============================================================================

  describe('runHeartbeat integration', () => {
    it('should return early if heartbeat is disabled', async () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: { enabled: false }
      }));

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const result = await service.runHeartbeat();

      expect(result.tasksProcessed).toBe(0);
      expect(result.sessionsCreated).toBe(0);
      expect(result.errors.length).toBe(0);

      rmSync(configPath);
    });

    it('should process work items and create sessions', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 11111,
          fields: {
            'System.Title': 'Test Item 1',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        },
        {
          id: 22222,
          fields: {
            'System.Title': 'Test Item 2',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T11:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const result = await service.runHeartbeat();

      expect(result.tasksProcessed).toBe(1);
      expect(result.sessionsCreated).toBe(2);
      expect(result.errors.length).toBe(0);

      rmSync(heartbeatPath);
    });

    it('should not process items already in state with same date', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 33333,
          fields: {
            'System.Title': 'Already Processed',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);

      // Pre-record the item as already processed
      service.recordProcessedItem('workitem:33333', '2024-01-15T10:00:00Z');

      const result = await service.runHeartbeat();

      expect(result.sessionsCreated).toBe(0); // No new sessions
      expect(result.errors.length).toBe(0);

      rmSync(heartbeatPath);
    });

    it('should run when disabled if force=true', async () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: { enabled: false }
      }));

      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 55555,
          fields: {
            'System.Title': 'Force Run Item',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0)
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const result = await service.runHeartbeat(true);

      expect(result.tasksProcessed).toBe(1);
      expect(result.sessionsCreated).toBe(1);
      expect(result.errors.length).toBe(0);

      rmSync(heartbeatPath);
      rmSync(configPath);
    });

    it('should return early when disabled without force', async () => {
      const configPath = join(TEST_CONFIG_DIR, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        heartbeat: { enabled: false }
      }));

      const service = new HeartbeatService(TEST_CONFIG_DIR);
      const result = await service.runHeartbeat();

      expect(result.tasksProcessed).toBe(0);
      expect(result.sessionsCreated).toBe(0);
      expect(result.errors.length).toBe(0);

      rmSync(configPath);
    });

    it('should record errors when Claude spawn fails', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 44444,
          fields: {
            'System.Title': 'Will Fail',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      // Simulate spawn error (e.g., claude binary not found)
      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => {
          const stdout = new EventEmitter();
          const stderr = new EventEmitter();
          const child = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            unref: () => void;
          };
          child.stdout = stdout;
          child.stderr = stderr;
          child.unref = () => {};
          setTimeout(() => child.emit('error', new Error('spawn claude ENOENT')), 5);
          return child as unknown as ReturnType<CommandExecutor['spawn']>;
        }
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const result = await service.runHeartbeat();

      expect(result.sessionsCreated).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('44444');

      rmSync(heartbeatPath);
    });

    it('should return session IDs from spawned Claude sessions', async () => {
      const heartbeatPath = join(TEST_CONFIG_DIR, 'HEARTBEAT.md');
      writeFileSync(heartbeatPath, `# HEARTBEAT.md
## Work Items
- [x] Fetch Azure DevOps work items assigned to me
`);

      const mockWorkItems: WorkItem[] = [
        {
          id: 66666,
          fields: {
            'System.Title': 'Session ID Test',
            'System.State': 'Active',
            'System.ChangedDate': '2024-01-15T10:00:00Z',
            'System.AssignedTo': { uniqueName: 'test@example.com' }
          }
        }
      ];

      const mockExecutor: CommandExecutor = {
        execSync: () => JSON.stringify(mockWorkItems),
        spawn: () => createMockChildProcess(0, 'test-session-abc123')
      };

      const service = new HeartbeatService(TEST_CONFIG_DIR, mockExecutor);
      const result = await service.runHeartbeat();

      expect(result.sessionsCreated).toBe(1);
      expect(result.sessionIds).toEqual(['test-session-abc123']);

      rmSync(heartbeatPath);
    });
  });

  // ===========================================================================
  // HeartbeatService with HeartbeatRepository
  // ===========================================================================

  describe('HeartbeatService with HeartbeatRepository', () => {
    function createMockHeartbeatRepo(overrides?: Partial<HeartbeatRepository>): HeartbeatRepository {
      return {
        getState: () => undefined,
        upsertState: () => {},
        getAllState: () => [],
        ...overrides,
      };
    }

    it('recordProcessedItem delegates to repo.upsertState', () => {
      const calls: Array<{ key: string; lastChanged: string; lastProcessed: number }> = [];
      const repo = createMockHeartbeatRepo({
        upsertState: (key, lastChanged, lastProcessed) => {
          calls.push({ key, lastChanged, lastProcessed });
        },
      });

      const service = new HeartbeatService(TEST_CONFIG_DIR, undefined, repo);
      service.recordProcessedItem('workitem:100', '2024-06-01T00:00:00Z');

      expect(calls).toHaveLength(1);
      expect(calls[0].key).toBe('workitem:100');
      expect(calls[0].lastChanged).toBe('2024-06-01T00:00:00Z');
      expect(typeof calls[0].lastProcessed).toBe('number');
    });

    it('getProcessedItemState delegates to repo.getState', () => {
      const repo = createMockHeartbeatRepo({
        getState: (key: string) => {
          if (key === 'workitem:200') {
            return { key: 'workitem:200', last_changed: '2024-07-01T00:00:00Z', last_processed: 123 };
          }
          return undefined;
        },
      });

      const service = new HeartbeatService(TEST_CONFIG_DIR, undefined, repo);

      expect(service.getProcessedItemState('workitem:200')).toBe('2024-07-01T00:00:00Z');
      expect(service.getProcessedItemState('workitem:999')).toBeUndefined();
    });

    it('getAllState delegates to repo.getAllState', () => {
      const records: HeartbeatStateRecord[] = [
        { key: 'workitem:1', last_changed: 'date-a', last_processed: 100 },
        { key: 'workitem:2', last_changed: 'date-b', last_processed: 200 },
      ];
      const repo = createMockHeartbeatRepo({
        getAllState: () => records,
      });

      const service = new HeartbeatService(TEST_CONFIG_DIR, undefined, repo);
      expect(service.getAllState()).toEqual(records);
    });

    it('getAllState returns [] when no repo is provided', () => {
      const service = new HeartbeatService(TEST_CONFIG_DIR);
      expect(service.getAllState()).toEqual([]);
    });
  });
});

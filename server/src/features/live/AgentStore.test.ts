import { EventEmitter } from 'events';
import { AgentStore } from './AgentStore';
import { ClaudeAgentSession } from '../../shared/infra/runtime/index';
import { noopLogger } from '../../../tests/__helpers/index';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

beforeEach(() => {
  mockSpawn.mockReset();

  const defaultMockProcess = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    pid: 99999,
  });
  mockSpawn.mockReturnValue(defaultMockProcess);
});

describe('AgentStore', () => {
  describe('create()', () => {
    it('creates and tracks sessions by ID', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      const session = store.create('session-1', 'client-A');

      expect(session).toBeInstanceOf(ClaudeAgentSession);
      expect(store.get('session-1')).toBe(session);
    });

    it('associates sessions with client IDs', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-A');
      store.create('session-3', 'client-B');

      const clientASessions = store.getByClient('client-A');
      expect(clientASessions).toHaveLength(2);
      expect(clientASessions.map(e => e.getSessionId())).toContain('session-1');
      expect(clientASessions.map(e => e.getSessionId())).toContain('session-2');
    });
  });

  describe('remove()', () => {
    it('removes session and returns it', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      const session = store.create('session-1', 'client-A');
      const removed = store.remove('session-1');

      expect(removed).toBe(session);
      expect(store.get('session-1')).toBeUndefined();
    });

    it('returns undefined for non-existent session', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      const removed = store.remove('non-existent');

      expect(removed).toBeUndefined();
    });
  });

  describe('removeByClient()', () => {
    it('removes all sessions for a client', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-A');
      store.create('session-3', 'client-B');

      const removed = store.removeByClient('client-A');

      expect(removed).toHaveLength(2);
      expect(store.get('session-1')).toBeUndefined();
      expect(store.get('session-2')).toBeUndefined();
      expect(store.get('session-3')).toBeDefined();
    });

    it('returns empty array for non-existent client', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      const removed = store.removeByClient('non-existent');

      expect(removed).toHaveLength(0);
    });
  });

  describe('has()', () => {
    it('returns true for existing session', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      store.create('session-1', 'client-A');

      expect(store.has('session-1')).toBe(true);
    });

    it('returns false for non-existent session', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));

      expect(store.has('session-1')).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('returns all sessions', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-B');

      const all = store.getAll();
      expect(all).toHaveLength(2);
    });

    it('returns empty array when no sessions', () => {
      const store = new AgentStore(noopLogger, (id, log) => new ClaudeAgentSession(id, log));
      expect(store.getAll()).toHaveLength(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { realpathSync } from 'fs';
import { registerLiveHandlers, type LiveHandlerDeps } from './handlers';
import type { WsGateway, WsHandler, WsConnectionHandler } from '../../gateway/types';
import type { AuthenticatedClient, WSMessage } from '../../gateway/protocol';
import type { AgentStore } from './AgentStore';
import type { AgentSession } from '../../shared/provider/index';
import { WorkingDirValidator } from '../../shared/provider/index';
import { noopLogger } from '../../../tests/__helpers/index';

// On macOS /tmp is a symlink to /private/tmp; the validator resolves symlinks
const REAL_TMP = realpathSync('/tmp');

// ── Mock WsGateway ──────────────────────────────────────────────────

class MockWsGateway implements WsGateway {
  handlers = new Map<string, WsHandler>();
  connectHandlers: WsConnectionHandler[] = [];
  disconnectHandlers: WsConnectionHandler[] = [];

  on(type: string, handler: WsHandler): void {
    this.handlers.set(type, handler);
  }
  onConnect(handler: WsConnectionHandler): void {
    this.connectHandlers.push(handler);
  }
  onDisconnect(handler: WsConnectionHandler): void {
    this.disconnectHandlers.push(handler);
  }

  // Test helpers
  triggerMessage(type: string, client: AuthenticatedClient, payload: unknown, id?: string): void {
    const handler = this.handlers.get(type);
    if (handler) handler(client, payload, id);
  }
  triggerDisconnect(client: AuthenticatedClient): void {
    for (const handler of this.disconnectHandlers) handler(client);
  }

  // Required by interface but unused in unit tests
  start(): void { /* noop */ }
  async stop(): Promise<void> { /* noop */ }
  getClientCount(): number { return 0; }
  broadcast(): void { /* noop */ }
}

// ── Mock helpers ────────────────────────────────────────────────────

function createMockClient(clientId = 'test-client'): AuthenticatedClient & { sentMessages: WSMessage[] } {
  const sentMessages: WSMessage[] = [];
  return {
    clientId,
    send: (msg: WSMessage) => { sentMessages.push(msg); },
    sentMessages,
  };
}

function createMockExecutor(): AgentSession & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    start: vi.fn(),
    cancel: vi.fn(),
    getSessionId: vi.fn(() => 'mock-session'),
  });
}

function createMockAgentStore() {
  const executors = new Map<string, AgentSession & EventEmitter>();

  return {
    create: vi.fn((sessionId: string, _clientId: string, _source?: string) => {
      const executor = createMockExecutor();
      executors.set(sessionId, executor);
      return executor;
    }),
    get: vi.fn((sessionId: string) => executors.get(sessionId)),
    has: vi.fn((sessionId: string) => executors.has(sessionId)),
    remove: vi.fn((sessionId: string) => {
      const e = executors.get(sessionId);
      executors.delete(sessionId);
      return e;
    }),
    removeByClient: vi.fn((_clientId: string): (AgentSession & EventEmitter)[] => []),
    getByClient: vi.fn((_clientId: string): AgentSession[] => []),
    getAll: vi.fn((): AgentSession[] => []),
    // Internal helper for tests
    _executors: executors,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('registerLiveHandlers', () => {
  let gateway: MockWsGateway;
  let agentStore: ReturnType<typeof createMockAgentStore>;
  let validator: WorkingDirValidator;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    gateway = new MockWsGateway();
    agentStore = createMockAgentStore();
    validator = new WorkingDirValidator(['/tmp']);
    client = createMockClient();
  });

  function register(opts?: { validator?: WorkingDirValidator }): void {
    const deps: LiveHandlerDeps = {
      agentStore: agentStore as unknown as AgentStore,
      validator: opts?.validator ?? validator,
      logger: noopLogger,
    };
    registerLiveHandlers(gateway, deps);
  }

  it('registers all expected handlers', () => {
    register();

    expect(gateway.handlers.has('session.start')).toBe(true);
    expect(gateway.handlers.has('session.resume')).toBe(true);
    expect(gateway.handlers.has('session.cancel')).toBe(true);
    expect(gateway.disconnectHandlers.length).toBeGreaterThan(0);
  });

  describe('session.start', () => {
    it('with valid dir creates executor and starts it', () => {
      register();

      gateway.triggerMessage('session.start', client, {
        sessionId: 'test-1',
        prompt: 'hello',
        workingDir: '/tmp',
        source: 'claude',
      });

      expect(agentStore.create).toHaveBeenCalledWith('test-1', 'test-client', 'claude');
      const executor = agentStore._executors.get('test-1');
      expect(executor).toBeDefined();
      expect(executor!.start).toHaveBeenCalledWith({
        prompt: 'hello',
        workingDir: REAL_TMP,
      });
    });

    it('with invalid dir sends session.error and does not create executor', () => {
      register();

      gateway.triggerMessage('session.start', client, {
        sessionId: 'test-2',
        prompt: 'hello',
        workingDir: '/not-allowed',
      });

      expect(agentStore.create).not.toHaveBeenCalled();
      expect(client.sentMessages).toHaveLength(1);
      expect(client.sentMessages[0].type).toBe('session.error');
      expect(client.sentMessages[0].payload).toHaveProperty('sessionId', 'test-2');
      expect(client.sentMessages[0].payload).toHaveProperty('error');
    });
  });

  describe('session.resume', () => {
    it('passes resumeSessionId to executor', () => {
      register();

      gateway.triggerMessage('session.resume', client, {
        sessionId: 'test-3',
        resumeSessionId: 'original-session-id',
        prompt: 'continue',
        workingDir: '/tmp',
        source: 'claude',
      });

      expect(agentStore.create).toHaveBeenCalledWith('test-3', 'test-client', 'claude');
      const executor = agentStore._executors.get('test-3');
      expect(executor).toBeDefined();
      expect(executor!.start).toHaveBeenCalledWith({
        prompt: 'continue',
        workingDir: REAL_TMP,
        resumeSessionId: 'original-session-id',
      });
    });
  });

  describe('session.cancel', () => {
    it('calls executor.cancel for known session', () => {
      register();

      // Start a session first so the executor exists
      gateway.triggerMessage('session.start', client, {
        sessionId: 'test-4',
        prompt: 'hello',
        workingDir: '/tmp',
      });

      gateway.triggerMessage('session.cancel', client, {
        sessionId: 'test-4',
      });

      const executor = agentStore._executors.get('test-4');
      expect(executor!.cancel).toHaveBeenCalled();
    });

    it('is no-op for unknown session', () => {
      register();

      // Should not throw
      expect(() => {
        gateway.triggerMessage('session.cancel', client, {
          sessionId: 'nonexistent',
        });
      }).not.toThrow();
    });
  });

  describe('onDisconnect', () => {
    it('cancels all client sessions', () => {
      const executor1 = createMockExecutor();
      const executor2 = createMockExecutor();
      agentStore.removeByClient.mockReturnValue([executor1, executor2]);

      register();
      gateway.triggerDisconnect(client);

      expect(agentStore.removeByClient).toHaveBeenCalledWith('test-client');
      expect(executor1.cancel).toHaveBeenCalled();
      expect(executor2.cancel).toHaveBeenCalled();
    });
  });

  describe('wireSessionEvents', () => {
    it('executor message emits session.output to client', () => {
      register();

      gateway.triggerMessage('session.start', client, {
        sessionId: 'test-5',
        prompt: 'hello',
        workingDir: '/tmp',
      });

      const executor = agentStore._executors.get('test-5')!;
      executor.emit('message', { text: 'world' });

      // First message is session.output (start doesn't send anything to client)
      const outputMsg = client.sentMessages.find(m => m.type === 'session.output');
      expect(outputMsg).toBeDefined();
      expect(outputMsg!.payload).toEqual({
        sessionId: 'test-5',
        message: { text: 'world' },
      });
    });

    it('executor error emits session.error to client', () => {
      register();

      gateway.triggerMessage('session.start', client, {
        sessionId: 'test-6',
        prompt: 'hello',
        workingDir: '/tmp',
      });

      const executor = agentStore._executors.get('test-6')!;
      executor.emit('error', 'something went wrong');

      const errorMsg = client.sentMessages.find(m => m.type === 'session.error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.payload).toEqual({
        sessionId: 'test-6',
        error: 'something went wrong',
      });
    });

    it('executor complete emits session.complete and removes from store', () => {
      register();

      gateway.triggerMessage('session.start', client, {
        sessionId: 'test-7',
        prompt: 'hello',
        workingDir: '/tmp',
      });

      const executor = agentStore._executors.get('test-7')!;
      executor.emit('complete', 0);

      const completeMsg = client.sentMessages.find(m => m.type === 'session.complete');
      expect(completeMsg).toBeDefined();
      expect(completeMsg!.payload).toEqual({
        sessionId: 'test-7',
        exitCode: 0,
      });
      expect(agentStore.remove).toHaveBeenCalledWith('test-7');
    });
  });
});

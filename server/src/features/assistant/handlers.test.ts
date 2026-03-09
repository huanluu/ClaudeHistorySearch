import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAssistantHandlers } from './handlers';
import { AssistantService } from './AssistantService';
import { MockAssistantBackend } from '../../../tests/__helpers/MockAssistantBackend';
import { noopLogger } from '../../../tests/__helpers/index';
import type { WsGateway, WsHandler, WsConnectionHandler } from '../../gateway/types';
import type { AuthenticatedClient, WSMessage } from '../../gateway/protocol';
import type { AssistantEvent } from './ports';

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

  triggerMessage(type: string, client: AuthenticatedClient, payload: unknown): void {
    const handler = this.handlers.get(type);
    if (handler) handler(client, payload);
  }
  triggerDisconnect(client: AuthenticatedClient): void {
    for (const handler of this.disconnectHandlers) handler(client);
  }

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

// ── Tests ───────────────────────────────────────────────────────────

describe('registerAssistantHandlers', () => {
  let gateway: MockWsGateway;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    gateway = new MockWsGateway();
    client = createMockClient();
  });

  function setup(eventSequences: AssistantEvent[][] = [], opts?: { delayMs?: number }) {
    const backend = new MockAssistantBackend(eventSequences, opts);
    const service = new AssistantService(backend, noopLogger);
    registerAssistantHandlers(gateway, { assistantService: service, logger: noopLogger });
    return { backend, service };
  }

  it('registers assistant.message and assistant.cancel handlers on gateway', () => {
    setup();
    expect(gateway.handlers.has('assistant.message')).toBe(true);
    expect(gateway.handlers.has('assistant.cancel')).toBe(true);
    expect(gateway.disconnectHandlers.length).toBeGreaterThan(0);
  });

  it('valid payload calls service and sends assistant.delta to client', async () => {
    setup([
      [{ type: 'delta', text: 'Hello!' }, { type: 'complete', sessionId: 's1' }],
    ]);

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-1',
      text: 'hi',
    });

    // Wait for async IIFE to complete
    await vi.waitFor(() => {
      expect(client.sentMessages.length).toBeGreaterThanOrEqual(2);
    });

    const delta = client.sentMessages.find(m => m.type === 'assistant.delta');
    expect(delta).toBeDefined();
    expect(delta!.payload).toEqual({ conversationId: 'conv-1', text: 'Hello!' });
  });

  it('complete event sent as assistant.complete to client', async () => {
    setup([
      [{ type: 'delta', text: 'hi' }, { type: 'complete', sessionId: 's1' }],
    ]);

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-2',
      text: 'test',
    });

    await vi.waitFor(() => {
      expect(client.sentMessages.some(m => m.type === 'assistant.complete')).toBe(true);
    });

    const complete = client.sentMessages.find(m => m.type === 'assistant.complete');
    expect(complete!.payload).toEqual({ conversationId: 'conv-2' });
  });

  it('error event sent as assistant.error to client', async () => {
    setup([
      [{ type: 'error', error: 'something broke' }],
    ]);

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-err',
      text: 'test',
    });

    await vi.waitFor(() => {
      expect(client.sentMessages.some(m => m.type === 'assistant.error')).toBe(true);
    });

    const errorMsg = client.sentMessages.find(m => m.type === 'assistant.error');
    expect(errorMsg!.payload).toEqual({
      conversationId: 'conv-err',
      error: 'something broke',
      errorCode: 'internal',
    });
  });

  it('assistant.cancel aborts in-flight iteration', async () => {
    setup([
      [
        { type: 'delta', text: 'chunk1' },
        { type: 'delta', text: 'chunk2' },
        { type: 'delta', text: 'chunk3' },
        { type: 'complete', sessionId: 's1' },
      ],
    ], { delayMs: 100 });

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-cancel',
      text: 'long message',
    });

    // Wait for first delta to arrive
    await vi.waitFor(() => {
      expect(client.sentMessages.some(m => m.type === 'assistant.delta')).toBe(true);
    });

    // Cancel
    gateway.triggerMessage('assistant.cancel', client, {
      conversationId: 'conv-cancel',
    });

    // Wait a bit for cancellation to propagate
    await new Promise(r => setTimeout(r, 200));

    // Should not have received all deltas
    const deltas = client.sentMessages.filter(m => m.type === 'assistant.delta');
    expect(deltas.length).toBeLessThan(3);
  });

  it('client.send() throws — loop breaks, no crash', async () => {
    setup([
      [{ type: 'delta', text: 'first' }, { type: 'delta', text: 'second' }, { type: 'complete', sessionId: 's1' }],
    ]);

    const throwingClient = {
      clientId: 'throw-client',
      send: vi.fn().mockImplementationOnce(() => {
        // First call succeeds (noop)
      }).mockImplementationOnce(() => {
        throw new Error('WebSocket closed');
      }),
    };

    gateway.triggerMessage('assistant.message', throwingClient, {
      conversationId: 'conv-throw',
      text: 'test',
    });

    // Wait for handler to process
    await new Promise(r => setTimeout(r, 50));

    // Should have called send at least once, handler should not crash
    expect(throwingClient.send).toHaveBeenCalled();
  });

  it('client disconnect aborts all active conversations', async () => {
    setup([
      [{ type: 'delta', text: 'a' }, { type: 'complete', sessionId: 's1' }],
      [{ type: 'delta', text: 'b' }, { type: 'complete', sessionId: 's2' }],
    ], { delayMs: 200 });

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-dc-1',
      text: 'msg1',
    });
    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-dc-2',
      text: 'msg2',
    });

    // Wait for iterations to start
    await new Promise(r => setTimeout(r, 50));

    // Disconnect
    gateway.triggerDisconnect(client);

    // Wait for abort to propagate
    await new Promise(r => setTimeout(r, 300));

    // Both should have been aborted (no complete messages expected)
    const completes = client.sentMessages.filter(m => m.type === 'assistant.complete');
    expect(completes.length).toBe(0);
  });

  it('unknown event type from backend is silently ignored', async () => {
    const warnSpy = vi.fn();
    const loggerWithWarn = { ...noopLogger, warn: warnSpy };
    const backend = new MockAssistantBackend([
      [{ type: 'unknown-type' as 'delta', text: 'wat' }, { type: 'complete', sessionId: 's1' }],
    ]);
    const service = new AssistantService(backend, noopLogger);
    registerAssistantHandlers(gateway, { assistantService: service, logger: loggerWithWarn });

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-unknown',
      text: 'test',
    });

    await vi.waitFor(() => {
      expect(client.sentMessages.some(m => m.type === 'assistant.complete')).toBe(true);
    });

    // Warning logged for unknown type
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('Unknown assistant event type') }),
    );
  });

  it('second assistant.message for same conversationId aborts the first', async () => {
    // Two sequences: first is slow, second is fast
    setup([
      [
        { type: 'delta', text: 'slow-1' },
        { type: 'delta', text: 'slow-2' },
        { type: 'complete', sessionId: 'slow-sess' },
      ],
      [
        { type: 'delta', text: 'fast-1' },
        { type: 'complete', sessionId: 'fast-sess' },
      ],
    ], { delayMs: 100 });

    // Start first message
    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-replace',
      text: 'first message',
    });

    // Wait briefly, then send second (abort-and-replace)
    await new Promise(r => setTimeout(r, 50));
    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-replace',
      text: 'second message',
    });

    // Wait for second to complete
    await vi.waitFor(() => {
      expect(client.sentMessages.some(m => m.type === 'assistant.complete')).toBe(true);
    }, { timeout: 2000 });

    // Should have fast-1 delta and complete
    const deltas = client.sentMessages.filter(m => m.type === 'assistant.delta');
    const fastDelta = deltas.find(m => (m.payload as { text: string }).text === 'fast-1');
    expect(fastDelta).toBeDefined();
  });

  it('.catch() handler sends assistant.error to client and logs error', async () => {
    const errorSpy = vi.fn();
    const loggerWithError = { ...noopLogger, error: errorSpy };

    // Create a service that throws during iteration
    const throwingBackend = {
      run(): AsyncIterable<AssistantEvent> {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next(): Promise<IteratorResult<AssistantEvent>> {
                throw new Error('Backend exploded');
              },
            };
          },
        };
      },
    };
    const service = new AssistantService(throwingBackend, noopLogger);
    registerAssistantHandlers(gateway, { assistantService: service, logger: loggerWithError });

    gateway.triggerMessage('assistant.message', client, {
      conversationId: 'conv-catch',
      text: 'test',
    });

    await vi.waitFor(() => {
      expect(client.sentMessages.some(m => m.type === 'assistant.error')).toBe(true);
    });

    const errorMsg = client.sentMessages.find(m => m.type === 'assistant.error');
    expect(errorMsg!.payload).toEqual({
      conversationId: 'conv-catch',
      error: 'Backend exploded',
      errorCode: 'internal',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('Backend exploded') }),
    );
  });
});

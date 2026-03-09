import { EventEmitter } from 'events';
import { waitForMessage, waitFor } from './ws-helpers';
import type WebSocket from 'ws';

/** Minimal WebSocket-like emitter for testing. */
function createMockWs(): WebSocket {
  return new EventEmitter() as unknown as WebSocket;
}

describe('waitForMessage', () => {
  it('resolves with matching message', async () => {
    const ws = createMockWs();
    const promise = waitForMessage(ws, 'greeting');

    // Emit a non-matching message first, then matching
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'other' })));
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'greeting', payload: 'hi' })));

    const result = await promise;
    expect(result).toEqual({ type: 'greeting', payload: 'hi' });
  });

  it('rejects with diagnostic timeout error', async () => {
    const ws = createMockWs();
    await expect(waitForMessage(ws, 'never-sent', 50)).rejects.toThrow(
      "Timeout waiting for 'never-sent' message",
    );
  });
});

describe('waitFor', () => {
  it('resolves when predicate passes', async () => {
    let count = 0;
    const interval = setInterval(() => count++, 5);

    await waitFor(() => expect(count).toBeGreaterThanOrEqual(3), 500);
    clearInterval(interval);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('rejects when predicate never passes', async () => {
    await expect(waitFor(() => { throw new Error('nope'); }, 50)).rejects.toThrow(
      'waitFor timed out after 50ms',
    );
  });
});

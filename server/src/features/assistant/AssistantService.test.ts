import { describe, it, expect, beforeEach } from 'vitest';
import { AssistantService } from './AssistantService';
import { MockAssistantBackend } from '../../../tests/__helpers/MockAssistantBackend';
import { noopLogger } from '../../../tests/__helpers/index';
import type { AssistantEvent } from './ports';

async function collectEvents(
  gen: AsyncGenerator<AssistantEvent>,
): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe('AssistantService', () => {
  let backend: MockAssistantBackend;
  let service: AssistantService;

  beforeEach(() => {
    backend = new MockAssistantBackend([]);
    service = new AssistantService(backend, noopLogger);
  });

  it('yields events from backend', async () => {
    const events: AssistantEvent[] = [
      { type: 'delta', text: 'Hello' },
      { type: 'complete', sessionId: 'sess-1' },
    ];
    backend = new MockAssistantBackend([events]);
    service = new AssistantService(backend, noopLogger);

    const result = await collectEvents(service.handleMessage('hi', 'conv-1'));

    expect(result).toEqual(events);
  });

  it('passes prompt and conversationId to backend options', async () => {
    backend = new MockAssistantBackend([[{ type: 'complete', sessionId: 's1' }]]);
    service = new AssistantService(backend, noopLogger);

    await collectEvents(service.handleMessage('hello world', 'conv-2'));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].prompt).toBe('hello world');
    expect(backend.calls[0].options.conversationId).toBe('conv-2');
  });

  it('second message with same conversationId passes resumeSessionId', async () => {
    backend = new MockAssistantBackend([
      [{ type: 'complete', sessionId: 'sess-abc' }],
      [{ type: 'complete', sessionId: 'sess-def' }],
    ]);
    service = new AssistantService(backend, noopLogger);

    await collectEvents(service.handleMessage('first', 'conv-3'));
    await collectEvents(service.handleMessage('second', 'conv-3'));

    expect(backend.calls[0].options.resumeSessionId).toBeUndefined();
    expect(backend.calls[1].options.resumeSessionId).toBe('sess-abc');
  });

  it('different conversationId has independent state', async () => {
    backend = new MockAssistantBackend([
      [{ type: 'complete', sessionId: 'sess-x' }],
      [{ type: 'complete', sessionId: 'sess-y' }],
    ]);
    service = new AssistantService(backend, noopLogger);

    await collectEvents(service.handleMessage('msg-a', 'conv-A'));
    await collectEvents(service.handleMessage('msg-b', 'conv-B'));

    expect(backend.calls[0].options.resumeSessionId).toBeUndefined();
    expect(backend.calls[1].options.resumeSessionId).toBeUndefined();
  });

  it('backend error event yielded to caller', async () => {
    backend = new MockAssistantBackend([
      [{ type: 'error', error: 'something broke' }],
    ]);
    service = new AssistantService(backend, noopLogger);

    const result = await collectEvents(service.handleMessage('test', 'conv-err'));

    expect(result).toEqual([{ type: 'error', error: 'something broke' }]);
  });

  it('AbortSignal aborted stops iteration', async () => {
    backend = new MockAssistantBackend(
      [[
        { type: 'delta', text: 'chunk1' },
        { type: 'delta', text: 'chunk2' },
        { type: 'complete', sessionId: 's1' },
      ]],
      { delayMs: 50 },
    );
    service = new AssistantService(backend, noopLogger);

    const controller = new AbortController();
    const gen = service.handleMessage('test', 'conv-abort', controller.signal);

    // Collect first event then abort
    const first = await gen.next();
    expect(first.done).toBe(false);
    controller.abort();

    const rest = await gen.next();
    expect(rest.done).toBe(true);
  });

  it('two concurrent handleMessage calls with different conversationIds do not cross-contaminate', async () => {
    backend = new MockAssistantBackend(
      [
        [{ type: 'complete', sessionId: 'sess-slow' }],
        [{ type: 'complete', sessionId: 'sess-fast' }],
      ],
      { delayMs: 20 },
    );
    service = new AssistantService(backend, noopLogger);

    const [eventsA, eventsB] = await Promise.all([
      collectEvents(service.handleMessage('slow', 'conv-slow')),
      collectEvents(service.handleMessage('fast', 'conv-fast')),
    ]);

    expect(eventsA).toEqual([{ type: 'complete', sessionId: 'sess-slow' }]);
    expect(eventsB).toEqual([{ type: 'complete', sessionId: 'sess-fast' }]);
    expect(backend.calls[0].options.conversationId).toBe('conv-slow');
    expect(backend.calls[1].options.conversationId).toBe('conv-fast');
  });

  it('clearConversation removes entry so next message has no resumeSessionId', async () => {
    backend = new MockAssistantBackend([
      [{ type: 'complete', sessionId: 'sess-clear' }],
      [{ type: 'complete', sessionId: 'sess-new' }],
    ]);
    service = new AssistantService(backend, noopLogger);

    await collectEvents(service.handleMessage('first', 'conv-clear'));
    service.clearConversation('conv-clear');
    await collectEvents(service.handleMessage('second', 'conv-clear'));

    expect(backend.calls[1].options.resumeSessionId).toBeUndefined();
  });

  it('clearAll removes all entries', async () => {
    backend = new MockAssistantBackend([
      [{ type: 'complete', sessionId: 'sess-1' }],
      [{ type: 'complete', sessionId: 'sess-2' }],
      [{ type: 'complete', sessionId: 'sess-3' }],
      [{ type: 'complete', sessionId: 'sess-4' }],
    ]);
    service = new AssistantService(backend, noopLogger);

    await collectEvents(service.handleMessage('a', 'conv-1'));
    await collectEvents(service.handleMessage('b', 'conv-2'));
    service.clearAll();
    await collectEvents(service.handleMessage('c', 'conv-1'));
    await collectEvents(service.handleMessage('d', 'conv-2'));

    expect(backend.calls[2].options.resumeSessionId).toBeUndefined();
    expect(backend.calls[3].options.resumeSessionId).toBeUndefined();
  });

  it('backend yields complete without sessionId — map not updated, no error', async () => {
    backend = new MockAssistantBackend([
      [{ type: 'complete' }], // no sessionId
      [{ type: 'complete', sessionId: 'sess-after' }],
    ]);
    service = new AssistantService(backend, noopLogger);

    await collectEvents(service.handleMessage('test', 'conv-no-sid'));
    await collectEvents(service.handleMessage('test2', 'conv-no-sid'));

    // Second call should have no resumeSessionId since first complete had none
    expect(backend.calls[1].options.resumeSessionId).toBeUndefined();
  });
});

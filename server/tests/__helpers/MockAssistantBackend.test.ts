import { MockAssistantBackend } from './MockAssistantBackend';
import type { AssistantEvent } from '../../src/features/assistant/index';

describe('MockAssistantBackend', () => {
  it('yields configured events in order and records calls', async () => {
    const events: AssistantEvent[] = [
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'complete', sessionId: 'sess-1' },
    ];
    const mock = new MockAssistantBackend([events]);

    const collected: AssistantEvent[] = [];
    for await (const event of mock.run('test prompt', { conversationId: 'conv-1' })) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
    expect(mock.calls).toEqual([
      { prompt: 'test prompt', options: { conversationId: 'conv-1' } },
    ]);
  });

  it('yields different event sequences for successive calls', async () => {
    const seq1: AssistantEvent[] = [{ type: 'delta', text: 'first' }];
    const seq2: AssistantEvent[] = [{ type: 'error', error: 'boom' }];
    const mock = new MockAssistantBackend([seq1, seq2]);

    const first: AssistantEvent[] = [];
    for await (const e of mock.run('p1', { conversationId: 'c1' })) first.push(e);

    const second: AssistantEvent[] = [];
    for await (const e of mock.run('p2', { conversationId: 'c2' })) second.push(e);

    expect(first).toEqual(seq1);
    expect(second).toEqual(seq2);
    expect(mock.calls).toHaveLength(2);
  });

  it('supports delayed yields', async () => {
    const events: AssistantEvent[] = [
      { type: 'delta', text: 'slow' },
      { type: 'complete' },
    ];
    const mock = new MockAssistantBackend([events], { delayMs: 10 });

    const start = Date.now();
    const collected: AssistantEvent[] = [];
    for await (const e of mock.run('p', { conversationId: 'c' })) collected.push(e);
    const elapsed = Date.now() - start;

    expect(collected).toEqual(events);
    // 2 events * 10ms delay = at least 20ms
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it('respects AbortSignal — breaks iteration when aborted', async () => {
    const events: AssistantEvent[] = [
      { type: 'delta', text: 'one' },
      { type: 'delta', text: 'two' },
      { type: 'delta', text: 'three' },
      { type: 'complete' },
    ];
    const mock = new MockAssistantBackend([events], { delayMs: 50 });

    const controller = new AbortController();
    const collected: AssistantEvent[] = [];

    // Abort after first event
    setTimeout(() => controller.abort(), 60);

    for await (const e of mock.run('p', { conversationId: 'c', signal: controller.signal })) {
      collected.push(e);
    }

    // Should have gotten 1-2 events, not all 4
    expect(collected.length).toBeLessThan(events.length);
  });
});

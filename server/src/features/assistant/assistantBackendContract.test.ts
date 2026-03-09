/**
 * Contract test for AssistantBackend implementations.
 * Lives with the port it verifies (features/assistant/ports.ts).
 * Test files have relaxed architecture rules — can import from infra + test helpers.
 */
import { describe, it, expect } from 'vitest';
import type { AssistantBackend, AssistantEvent } from './ports';
import { MockAssistantBackend } from '../../../tests/__helpers/MockAssistantBackend';

async function collectEvents(backend: AssistantBackend, prompt: string): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of backend.run(prompt, { conversationId: 'contract-test' })) {
    events.push(event);
  }
  return events;
}

function runContractSuite(name: string, createBackend: () => AssistantBackend) {
  describe(`AssistantBackend contract: ${name}`, () => {
    it('emits at least one event', async () => {
      const events = await collectEvents(createBackend(), 'hello');
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('final event is complete or error', async () => {
      const events = await collectEvents(createBackend(), 'hello');
      const last = events[events.length - 1];
      expect(['complete', 'error']).toContain(last.type);
    });

    it('complete event includes sessionId', async () => {
      const events = await collectEvents(createBackend(), 'hello');
      const complete = events.find(e => e.type === 'complete');
      if (complete) {
        expect(complete.sessionId).toBeDefined();
      }
    });

    it('events arrive in valid sequence: delta* then complete|error', async () => {
      const events = await collectEvents(createBackend(), 'hello');

      let seenTerminal = false;
      for (const event of events) {
        if (seenTerminal) {
          // No events after terminal
          expect.unreachable(`Event after terminal: ${event.type}`);
        }
        if (event.type === 'complete' || event.type === 'error') {
          seenTerminal = true;
        }
      }
      expect(seenTerminal).toBe(true);
    });

    it('respects abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const events: AssistantEvent[] = [];
      for await (const event of createBackend().run('hello', {
        conversationId: 'abort-test',
        signal: controller.signal,
      })) {
        events.push(event);
      }

      // Should not emit delta events when pre-aborted
      const deltas = events.filter(e => e.type === 'delta');
      expect(deltas.length).toBe(0);
    });
  });
}

// Always runs — MockAssistantBackend
runContractSuite('MockAssistantBackend', () =>
  new MockAssistantBackend([
    [
      { type: 'delta', text: 'Hi' },
      { type: 'complete', sessionId: 'mock-sess-1' },
    ],
  ]),
);

// Conditional — real SDK (requires Claude CLI, don't run in CI)
if (process.env.TEST_WITH_SDK === '1') {
  // Dynamic import to avoid loading SDK in normal test runs
  const { SdkAssistantBackend } = await import('../../shared/infra/assistant/index');
  const noopLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    verbose: () => {},
    log: () => {},
  };
  runContractSuite('SdkAssistantBackend', () =>
    new SdkAssistantBackend(noopLogger),
  );
}

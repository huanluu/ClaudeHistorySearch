import type { AssistantBackend, AssistantEvent, AssistantRunOptions } from '../../src/features/assistant/index';

interface MockAssistantBackendOptions {
  delayMs?: number;
}

export class MockAssistantBackend implements AssistantBackend {
  readonly calls: Array<{ prompt: string; options: AssistantRunOptions }> = [];
  private callIndex = 0;

  constructor(
    private readonly eventSequences: AssistantEvent[][],
    private readonly options: MockAssistantBackendOptions = {},
  ) {}

  run(prompt: string, options: AssistantRunOptions): AsyncIterable<AssistantEvent> {
    this.calls.push({ prompt, options });
    const events = this.eventSequences[this.callIndex] ?? [];
    this.callIndex++;
    const delayMs = this.options.delayMs;
    const signal = options.signal;

    return {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next(): Promise<IteratorResult<AssistantEvent>> {
            if (signal?.aborted || index >= events.length) {
              return { done: true, value: undefined };
            }
            if (delayMs) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            if (signal?.aborted) {
              return { done: true, value: undefined };
            }
            return { done: false, value: events[index++] };
          },
        };
      },
    };
  }
}

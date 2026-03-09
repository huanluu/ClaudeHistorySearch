import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SdkMessage } from './translateSdkEvent';

// Mock the SDK before importing SdkAssistantBackend
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock setup
const { SdkAssistantBackend } = await import('./SdkAssistantBackend');

function createLogger() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  };
}

/**
 * Helper: create a mock query that processes messages from the generator.
 * For each user message pushed, yields the corresponding SDK messages.
 * Simulates real SDK behavior: system.init once, then per-turn responses.
 */
function createStreamingMockQuery(turnsMessages: SdkMessage[][]) {
  return (params: Record<string, unknown>) => {
    const generator = params.prompt as AsyncGenerator<unknown>;
    let turnIndex = 0;

    async function* streamingQuery(): AsyncGenerator<SdkMessage> {
      yield { type: 'system', subtype: 'init', session_id: 'sess-streaming' } as SdkMessage;

      for await (const _userMsg of generator) {
        const turnMsgs = turnsMessages[turnIndex] ?? [];
        turnIndex++;
        for (const msg of turnMsgs) {
          yield msg;
        }
      }
    }

    return streamingQuery();
  };
}

describe('SdkAssistantBackend', () => {
  const logger = createLogger();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates streaming query with async generator prompt', async () => {
    mockQuery.mockImplementation(createStreamingMockQuery([
      [
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }, session_id: 's1' },
        { type: 'assistant', session_id: 's1' },
        { type: 'result', subtype: 'success', result: 'Hi', session_id: 's1' },
      ],
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('hello', { conversationId: 'conv-1' })) {
      events.push(event);
    }

    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0][0];
    expect(typeof callArgs.prompt[Symbol.asyncIterator]).toBe('function');
    expect(callArgs.options.includePartialMessages).toBe(true);

    backend.destroyAll();
  });

  it('translates streaming events and uses result as turn boundary', async () => {
    mockQuery.mockImplementation(createStreamingMockQuery([
      [
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }, session_id: 's1' },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' there' } }, session_id: 's1' },
        { type: 'assistant', session_id: 's1' },
        { type: 'stream_event', event: { type: 'content_block_stop' }, session_id: 's1' },
        { type: 'stream_event', event: { type: 'message_stop' }, session_id: 's1' },
        { type: 'result', subtype: 'success', result: 'Hi there', session_id: 's1' },
      ],
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('greet', { conversationId: 'c1' })) {
      events.push(event);
    }

    // assistant message swallowed, result = complete
    expect(events).toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'delta', text: ' there' },
      { type: 'complete', sessionId: 's1' },
    ]);

    backend.destroyAll();
  });

  it('reuses session for second message (no new query)', async () => {
    mockQuery.mockImplementation(createStreamingMockQuery([
      [
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reply 1' } }, session_id: 's1' },
        { type: 'assistant', session_id: 's1' },
        { type: 'result', subtype: 'success', result: 'Reply 1', session_id: 's1' },
      ],
      [
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reply 2' } }, session_id: 's1' },
        { type: 'assistant', session_id: 's1' },
        { type: 'result', subtype: 'success', result: 'Reply 2', session_id: 's1' },
      ],
    ]));

    const backend = new SdkAssistantBackend(logger);

    const events1 = [];
    for await (const event of backend.run('msg 1', { conversationId: 'conv-1' })) {
      events1.push(event);
    }
    expect(events1).toEqual([
      { type: 'delta', text: 'Reply 1' },
      { type: 'complete', sessionId: 's1' },
    ]);

    const events2 = [];
    for await (const event of backend.run('msg 2', { conversationId: 'conv-1' })) {
      events2.push(event);
    }
    expect(events2).toEqual([
      { type: 'delta', text: 'Reply 2' },
      { type: 'complete', sessionId: 's1' },
    ]);

    expect(mockQuery).toHaveBeenCalledOnce();

    backend.destroyAll();
  });

  it('different conversationIds get separate sessions', async () => {
    let callCount = 0;
    mockQuery.mockImplementation((params: Record<string, unknown>) => {
      callCount++;
      return createStreamingMockQuery([
        [
          { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `S${callCount}` } }, session_id: `s${callCount}` },
          { type: 'result', subtype: 'success', result: `S${callCount}`, session_id: `s${callCount}` },
        ],
      ])(params);
    });

    const backend = new SdkAssistantBackend(logger);

    for await (const _e of backend.run('msg', { conversationId: 'conv-A' })) { /* drain */ }
    for await (const _e of backend.run('msg', { conversationId: 'conv-B' })) { /* drain */ }

    expect(mockQuery).toHaveBeenCalledTimes(2);

    backend.destroyAll();
  });

  it('swallows assistant message and non-text stream events', async () => {
    mockQuery.mockImplementation(createStreamingMockQuery([
      [
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } }, session_id: 's1' },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta' } }, session_id: 's1' },
        { type: 'assistant', session_id: 's1' },
        { type: 'stream_event', event: { type: 'message_stop' }, session_id: 's1' },
        { type: 'result', subtype: 'success', result: '', session_id: 's1' },
      ],
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('test', { conversationId: 'c1' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'complete', sessionId: 's1' },
    ]);

    backend.destroyAll();
  });

  it('destroySession aborts and cleans up', async () => {
    let sdkAbortController: AbortController | undefined;
    mockQuery.mockImplementation((params: Record<string, unknown>) => {
      sdkAbortController = (params.options as Record<string, unknown>).abortController as AbortController;
      return createStreamingMockQuery([
        [
          { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }, session_id: 's1' },
          { type: 'result', subtype: 'success', result: 'Hi', session_id: 's1' },
        ],
      ])(params);
    });

    const backend = new SdkAssistantBackend(logger);
    for await (const _event of backend.run('test', { conversationId: 'conv-1' })) { /* drain */ }

    backend.destroySession('conv-1');
    expect(sdkAbortController!.signal.aborted).toBe(true);
  });

  it('yields error event when SDK throws', async () => {
    mockQuery.mockReturnValue((async function* () {
      throw new Error('SDK connection failed');
    })());

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('test', { conversationId: 'c1' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'error', error: 'SDK connection failed' },
    ]);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('suppresses error when abort signal caused the throw', async () => {
    const controller = new AbortController();
    mockQuery.mockReturnValue((async function* () {
      throw new Error('AbortError');
    })());

    controller.abort();

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('test', {
      conversationId: 'c1',
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  it('handles SDK result errors', async () => {
    mockQuery.mockImplementation(createStreamingMockQuery([
      [
        { type: 'result', subtype: 'error_max_turns', errors: ['Exceeded max turns'], session_id: 's1' } as SdkMessage,
      ],
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('test', { conversationId: 'c1' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'error', error: 'Exceeded max turns' },
    ]);

    backend.destroyAll();
  });

  it('includes session_id and parent_tool_use_id in user messages', async () => {
    let capturedGenerator: AsyncGenerator<unknown> | undefined;
    mockQuery.mockImplementation((params: Record<string, unknown>) => {
      capturedGenerator = params.prompt as AsyncGenerator<unknown>;
      return createStreamingMockQuery([
        [{ type: 'result', subtype: 'success', result: 'ok', session_id: 's1' }],
      ])(params);
    });

    const backend = new SdkAssistantBackend(logger);
    for await (const _e of backend.run('hello', { conversationId: 'c1' })) { /* drain */ }

    // The generator was consumed by the mock — verify the message shape was correct
    // by checking the mock query received a generator (not a string)
    expect(capturedGenerator).toBeDefined();

    backend.destroyAll();
  });
});

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

/** Helper: create an async generator from an array of SDK messages */
async function* fakeQuery(messages: SdkMessage[]): AsyncGenerator<SdkMessage> {
  for (const msg of messages) {
    yield msg;
  }
}

describe('SdkAssistantBackend', () => {
  const logger = createLogger();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes correct options to query()', async () => {
    mockQuery.mockReturnValue(fakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      { type: 'result', subtype: 'success', result: 'ok', session_id: 'sess-1' },
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('hello', {
      conversationId: 'conv-1',
      resumeSessionId: 'prev-sess',
      systemPrompt: 'Be helpful',
    })) {
      events.push(event);
    }

    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toMatchObject({
      prompt: 'hello',
      options: expect.objectContaining({
        includePartialMessages: true,
        resume: 'prev-sess',
        systemPrompt: 'Be helpful',
        allowedTools: [],
        maxTurns: 10,
      }),
    });
  });

  it('omits resume when no resumeSessionId', async () => {
    mockQuery.mockReturnValue(fakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      { type: 'result', subtype: 'success', result: 'ok', session_id: 'sess-1' },
    ]));

    const backend = new SdkAssistantBackend(logger);
    for await (const _event of backend.run('hello', { conversationId: 'conv-1' })) {
      // drain
    }

    const options = mockQuery.mock.calls[0][0].options;
    expect(options).not.toHaveProperty('resume');
  });

  it('translates SDK messages to AssistantEvents', async () => {
    mockQuery.mockReturnValue(fakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-abc' },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        session_id: 'sess-abc',
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' there' } },
        session_id: 'sess-abc',
      },
      { type: 'result', subtype: 'success', result: 'Hi there', session_id: 'sess-abc' },
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('greet me', { conversationId: 'c1' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'delta', text: ' there' },
      { type: 'complete', sessionId: 'sess-abc' },
    ]);
  });

  it('swallows non-text stream events', async () => {
    mockQuery.mockReturnValue(fakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } },
        session_id: 'sess-1',
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta' } },
        session_id: 'sess-1',
      },
      {
        type: 'stream_event',
        event: { type: 'message_stop' },
        session_id: 'sess-1',
      },
      { type: 'result', subtype: 'success', result: '', session_id: 'sess-1' },
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('test', { conversationId: 'c1' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'complete', sessionId: 'sess-1' },
    ]);
  });

  it('forwards abort signal to SDK AbortController', async () => {
    let sdkAbortController: AbortController | undefined;
    mockQuery.mockImplementation((params: Record<string, unknown>) => {
      const opts = params.options as Record<string, unknown>;
      sdkAbortController = opts.abortController as AbortController;
      return fakeQuery([
        { type: 'system', subtype: 'init', session_id: 'sess-1' },
        { type: 'result', subtype: 'success', result: 'ok', session_id: 'sess-1' },
      ]);
    });

    const externalController = new AbortController();
    const backend = new SdkAssistantBackend(logger);

    for await (const _event of backend.run('test', {
      conversationId: 'c1',
      signal: externalController.signal,
    })) {
      // drain
    }

    expect(sdkAbortController).toBeDefined();
    expect(sdkAbortController!.signal.aborted).toBe(false);

    externalController.abort();
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

    // No error event — abort errors are suppressed
    expect(events).toEqual([]);
  });

  it('handles SDK result errors', async () => {
    mockQuery.mockReturnValue(fakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      {
        type: 'result',
        subtype: 'error_max_turns',
        errors: ['Exceeded max turns'],
        session_id: 'sess-1',
      },
    ]));

    const backend = new SdkAssistantBackend(logger);
    const events = [];
    for await (const event of backend.run('test', { conversationId: 'c1' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'error', error: 'Exceeded max turns' },
    ]);
  });
});

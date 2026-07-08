import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionEvent } from '@github/copilot-sdk';

type EventHandler = (event: SessionEvent) => void;

class MockSession {
  readonly sessionId = 'copilot-session-1';
  readonly handlers: EventHandler[] = [];
  readonly sentPrompts: string[] = [];
  readonly abort = vi.fn().mockResolvedValue(undefined);
  readonly disconnect = vi.fn().mockResolvedValue(undefined);

  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  async send(options: { prompt: string }): Promise<string> {
    this.sentPrompts.push(options.prompt);
    return 'message-1';
  }

  emit(event: SessionEvent): void {
    for (const handler of [...this.handlers]) {
      handler(event);
    }
  }
}

const { mockCreateSession, mockResumeSession, mockStop, sessions } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockResumeSession: vi.fn(),
  mockStop: vi.fn().mockResolvedValue([]),
  sessions: [] as MockSession[],
}));

vi.mock('@github/copilot-sdk', () => {
  class CopilotClient {
    createSession = mockCreateSession;
    resumeSession = mockResumeSession;
    stop = mockStop;
  }
  class ToolSet {
    addBuiltIn(): ToolSet { return this; }
    addMcp(): ToolSet { return this; }
    addCustom(): ToolSet { return this; }
  }
  return {
    approveAll: vi.fn(),
    BuiltInTools: { Isolated: ['read', 'think'] },
    CopilotClient,
    RuntimeConnection: { forStdio: vi.fn(() => ({ kind: 'stdio' })) },
    ToolSet,
    defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
  };
});

const { CopilotAssistantBackend, SdkAssistantBackend } = await import('./CopilotAssistantBackend');

function createLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
  };
}

function messageDelta(text: string): SessionEvent {
  return {
    type: 'assistant.message_delta',
    data: { deltaContent: text, messageId: 'm1' },
    ephemeral: true,
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
  } as SessionEvent;
}

function message(content: string): SessionEvent {
  return {
    type: 'assistant.message',
    data: { content, messageId: 'm1' },
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
  } as SessionEvent;
}

function idle(aborted = false): SessionEvent {
  return {
    type: 'session.idle',
    data: aborted ? { aborted: true } : {},
    ephemeral: true,
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
  } as SessionEvent;
}

function assistantIdle(): SessionEvent {
  return {
    type: 'assistant.idle',
    data: {},
    ephemeral: true,
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
  } as SessionEvent;
}

function sessionError(text: string): SessionEvent {
  return {
    type: 'session.error',
    data: { errorType: 'query', message: text },
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
  } as SessionEvent;
}

describe('CopilotAssistantBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.length = 0;
    mockCreateSession.mockImplementation(() => {
      const session = new MockSession();
      sessions.push(session);
      return Promise.resolve(session);
    });
    mockResumeSession.mockImplementation(() => {
      const session = new MockSession();
      sessions.push(session);
      return Promise.resolve(session);
    });
    mockStop.mockResolvedValue([]);
  });

  it('exports SdkAssistantBackend as compatibility alias', () => {
    expect(SdkAssistantBackend).toBe(CopilotAssistantBackend);
  });

  it('creates a Copilot session and sends the prompt', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(messageDelta('Hi'));
    sessions[0].emit(idle());

    const second = await iterator.next();

    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(sessions[0].sentPrompts).toEqual(['hello']);
    expect((await first).value).toEqual({ type: 'delta', text: 'Hi' });
    expect(second.value).toEqual({ type: 'complete', sessionId: 'copilot-session-1' });
    await backend.destroyAll();
  });

  it('reuses the Copilot session for the same conversation', async () => {
    const backend = new CopilotAssistantBackend(createLogger());

    const first = backend.run('one', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const firstEvent = first.next();
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(message('First'));
    sessions[0].emit(idle());
    await firstEvent;
    await first.next();
    await first.next();

    const second = backend.run('two', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const secondEvent = second.next();
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(message('Second'));
    sessions[0].emit(idle());
    await secondEvent;
    await second.next();
    await second.next();

    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(sessions[0].sentPrompts).toEqual(['one', 'two']);
    await backend.destroyAll();
  });

  it('resumes when resumeSessionId is provided for a new conversation', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1', resumeSessionId: 'existing-session' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(idle());
    await first;

    expect(mockResumeSession).toHaveBeenCalledWith('existing-session', expect.any(Object));
    await backend.destroyAll();
  });

  it('falls back to final assistant.message when streaming delta was not emitted', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(message('Full response'));
    sessions[0].emit(idle());

    expect((await first).value).toEqual({ type: 'delta', text: 'Full response' });
    expect((await iterator.next()).value).toEqual({ type: 'complete', sessionId: 'copilot-session-1' });
    await backend.destroyAll();
  });

  it('emits errors from session.error events', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(sessionError('API Error'));

    expect((await first).value).toEqual({ type: 'error', error: 'API Error' });
    await backend.destroyAll();
  });

  it('aborts the Copilot session when the caller aborts', async () => {
    const controller = new AbortController();
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1', signal: controller.signal })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    controller.abort();

    expect((await first).done).toBe(true);
    expect(sessions[0].abort).toHaveBeenCalledOnce();
    await backend.destroyAll();
  });

  it('destroyAll unblocks an active run before disconnecting sessions', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));

    const destroy = backend.destroyAll();

    expect((await first).done).toBe(true);
    await destroy;
    expect(sessions[0].disconnect).toHaveBeenCalledOnce();
  });

  it('does not send a prompt if aborted while creating a new session', async () => {
    const controller = new AbortController();
    let resolveCreate!: (session: MockSession) => void;
    mockCreateSession.mockReturnValue(new Promise(resolve => { resolveCreate = resolve; }));

    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1', signal: controller.signal })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalledOnce());
    controller.abort();
    const session = new MockSession();
    sessions.push(session);
    resolveCreate(session);

    expect((await first).done).toBe(true);
    expect(session.sentPrompts).toEqual([]);
    expect(session.disconnect).toHaveBeenCalledOnce();
    await backend.destroyAll();
  });

  it('does not send a prompt if shutdown starts while creating a new session', async () => {
    let resolveCreate!: (session: MockSession) => void;
    mockCreateSession.mockReturnValue(new Promise(resolve => { resolveCreate = resolve; }));

    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalledOnce());
    const destroy = backend.destroyAll();
    const session = new MockSession();
    sessions.push(session);
    resolveCreate(session);

    expect((await first).done).toBe(true);
    await destroy;
    expect(session.sentPrompts).toEqual([]);
    expect(session.disconnect).toHaveBeenCalledOnce();
  });

  it('destroys a session after send fails', async () => {
    const session = new MockSession();
    sessions.push(session);
    vi.spyOn(session, 'send').mockRejectedValue(new Error('send failed'));
    mockCreateSession.mockResolvedValue(session);

    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));

    expect((await first).value).toEqual({ type: 'error', error: 'send failed' });
    expect(session.disconnect).toHaveBeenCalledOnce();
    await backend.destroyAll();
  });

  it('preserves original send error when cleanup fails', async () => {
    const logger = createLogger();
    const session = new MockSession();
    sessions.push(session);
    vi.spyOn(session, 'send').mockRejectedValue(new Error('send failed'));
    session.disconnect.mockRejectedValue(new Error('disconnect failed'));
    mockCreateSession.mockResolvedValue(session);

    const backend = new CopilotAssistantBackend(logger);
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toEqual({ type: 'error', error: 'send failed' });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'Copilot assistant cleanup failed: disconnect failed',
      op: 'copilot.assistant',
    }));
    await backend.destroyAll();
  });

  it('serializes runs for the same conversation until the prior run unsubscribes', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const firstRun = backend.run('one', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const firstEvent = firstRun.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));

    const secondRun = backend.run('two', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const secondEvent = secondRun.next();
    await Promise.resolve();

    expect(sessions[0].sentPrompts).toEqual(['one']);
    sessions[0].emit(idle());
    await firstEvent;
    await firstRun.next();

    await vi.waitFor(() => expect(sessions[0].sentPrompts).toEqual(['one', 'two']));
    sessions[0].emit(idle());
    await secondEvent;
    await backend.destroyAll();
  });

  it('keeps the run lock until abort is acknowledged', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const controller = new AbortController();
    let resolveAbort!: () => void;

    const firstRun = backend.run('one', { conversationId: 'conv-1', signal: controller.signal })[Symbol.asyncIterator]();
    const firstEvent = firstRun.next();
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].abort.mockReturnValue(new Promise<void>(resolve => { resolveAbort = resolve; }));

    controller.abort();
    await Promise.resolve();

    const secondRun = backend.run('two', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const secondEvent = secondRun.next();
    await Promise.resolve();
    expect(sessions[0].sentPrompts).toEqual(['one']);

    resolveAbort();
    expect((await firstEvent).done).toBe(true);
    await vi.waitFor(() => expect(sessions[0].sentPrompts).toEqual(['one', 'two']));
    sessions[0].emit(idle());
    await secondEvent;
    await secondRun.next();
    await backend.destroyAll();
  });

  it('serializes concurrent first runs for the same conversation', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const firstRun = backend.run('one', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const secondRun = backend.run('two', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const firstEvent = firstRun.next();
    const secondEvent = secondRun.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    expect(sessions[0].sentPrompts).toEqual(['one']);

    sessions[0].emit(idle());
    await firstEvent;
    await firstRun.next();

    await vi.waitFor(() => expect(sessions[0].sentPrompts).toEqual(['one', 'two']));
    sessions[0].emit(idle());
    await secondEvent;
    await secondRun.next();
    await backend.destroyAll();
  });

  it('releases the run lock when a queued run is aborted before it starts', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const firstRun = backend.run('one', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const firstEvent = firstRun.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));

    const queuedController = new AbortController();
    const queuedRun = backend.run('two', { conversationId: 'conv-1', signal: queuedController.signal })[Symbol.asyncIterator]();
    const queuedEvent = queuedRun.next();
    queuedController.abort();

    sessions[0].emit(idle());
    await firstEvent;
    await firstRun.next();
    expect((await queuedEvent).done).toBe(true);

    const thirdRun = backend.run('three', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const thirdEvent = thirdRun.next();
    await vi.waitFor(() => expect(sessions[0].sentPrompts).toEqual(['one', 'three']));
    sessions[0].emit(idle());
    await thirdEvent;
    await thirdRun.next();
    await backend.destroyAll();
  });

  it('does not start queued runs after destroyAll begins', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const firstRun = backend.run('one', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const firstEvent = firstRun.next();
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));

    const queuedRun = backend.run('two', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const queuedEvent = queuedRun.next();
    await Promise.resolve();

    const destroy = backend.destroyAll();
    sessions[0].emit(idle());
    await firstEvent;

    expect((await queuedEvent).done).toBe(true);
    await destroy;
    expect(sessions[0].sentPrompts).toEqual(['one']);
  });

  it('does not emit complete for an aborted idle event', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(idle(true));

    expect((await first).done).toBe(true);
    await backend.destroyAll();
  });


  it('passes custom cron tools and WorkIQ MCP servers into session config', async () => {
    const backend = new CopilotAssistantBackend(
      createLogger(),
      () => [{ name: 'cron_list' }],
      () => ({ 'work-iq': { command: 'node', args: ['workiq', 'mcp'] } }),
    );
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(idle());
    await first;

    expect(mockCreateSession.mock.calls[0][0]).toEqual(expect.objectContaining({
      includeSubAgentStreamingEvents: false,
      tools: [{ name: 'cron_list' }],
      mcpServers: { 'work-iq': { command: 'node', args: ['workiq', 'mcp'] } },
    }));
    await backend.destroyAll();
  });

  it('ignores assistant.idle and waits for session.idle before completing', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit(assistantIdle());
    await Promise.resolve();

    sessions[0].emit(idle());

    expect((await first).value).toEqual({ type: 'complete', sessionId: 'copilot-session-1' });
    await backend.destroyAll();
  });

  it('ignores sub-agent events', async () => {
    const backend = new CopilotAssistantBackend(createLogger());
    const iterator = backend.run('hello', { conversationId: 'conv-1' })[Symbol.asyncIterator]();
    const first = iterator.next();

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    await vi.waitFor(() => expect(sessions[0].handlers).toHaveLength(1));
    sessions[0].emit({ ...messageDelta('internal'), agentId: 'agent-1' } as SessionEvent);
    await Promise.resolve();

    sessions[0].emit(messageDelta('visible'));
    sessions[0].emit(idle());

    expect((await first).value).toEqual({ type: 'delta', text: 'visible' });
    expect((await iterator.next()).value).toEqual({ type: 'complete', sessionId: 'copilot-session-1' });
    await backend.destroyAll();
  });
});

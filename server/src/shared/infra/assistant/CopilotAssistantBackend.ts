import {
  approveAll,
  BuiltInTools,
  CopilotClient,
  type CopilotSession,
  type MCPServerConfig,
  RuntimeConnection,
  type SessionConfig,
  type SessionEvent,
  ToolSet,
  type Tool,
} from '@github/copilot-sdk';
import type { Logger } from '../../provider/index';

interface CopilotAssistantEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;
  error?: string;
  sessionId?: string;
}

interface CopilotRunOptions {
  conversationId: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

interface CopilotSessionState {
  session: CopilotSession;
}

type CopilotToolFactory = () => Tool<unknown>[];

type McpServerFactory = () => Record<string, MCPServerConfig>;

type QueueItem = CopilotAssistantEvent | null;

interface EventQueue {
  push(item: QueueItem): void;
  next(): Promise<QueueItem>;
}

function createEventQueue(): EventQueue {
  const items: QueueItem[] = [];
  let waiting: ((item: QueueItem) => void) | null = null;

  return {
    push(item: QueueItem): void {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(item);
        return;
      }
      items.push(item);
    },
    next(): Promise<QueueItem> {
      if (items.length > 0) {
        return Promise.resolve(items.shift() ?? null);
      }
      return new Promise(resolve => { waiting = resolve; });
    },
  };
}

export class CopilotAssistantBackend {
  private readonly client: CopilotClient;
  private readonly sessions = new Map<string, CopilotSessionState>();
  private readonly runLocks = new Map<string, Promise<void>>();
  private readonly activeQueues = new Map<string, Set<EventQueue>>();

  constructor(
    private readonly logger: Logger,
    private readonly toolFactory?: CopilotToolFactory,
    private readonly mcpServerFactory?: McpServerFactory,
  ) {
    this.client = new CopilotClient({
      connection: RuntimeConnection.forStdio(),
      mode: 'copilot-cli',
      logLevel: 'error',
    });
  }

  async *run(prompt: string, options: CopilotRunOptions): AsyncGenerator<CopilotAssistantEvent> {
    if (options.signal?.aborted) return;

    const previousRun = this.runLocks.get(options.conversationId) ?? Promise.resolve();
    let releaseRun!: () => void;
    const currentRun = new Promise<void>(resolve => { releaseRun = resolve; });
    const chainedRun = previousRun.catch(() => {}).then(() => currentRun);
    this.runLocks.set(options.conversationId, chainedRun);

    let state: CopilotSessionState | undefined;
    let unsubscribe: (() => void) | undefined;
    let queue: EventQueue | undefined;

    const onAbort = (): void => {
      queue?.push(null);
      void state?.session.abort()
        .catch((error: unknown) => {
          this.logger.warn({
            msg: `Copilot assistant abort failed: ${error instanceof Error ? error.message : String(error)}`,
            op: 'copilot.assistant',
          });
        });
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await previousRun.catch(() => {});
      if (options.signal?.aborted) return;

      const hadSession = this.sessions.has(options.conversationId);
      state = await this.getOrCreateSession(options);
      if (options.signal?.aborted) {
        if (hadSession) {
          await state.session.abort();
        } else {
          await this.destroySession(options.conversationId);
        }
        return;
      }

      const turnQueue = createEventQueue();
      queue = turnQueue;
      this.addActiveQueue(options.conversationId, turnQueue);
      const turnState = { emittedDelta: false };
      unsubscribe = state.session.on((event: SessionEvent) => {
        this.enqueueEvent(event, turnState, turnQueue, state!.session.sessionId);
      });

      await state.session.send({ prompt });

      while (!options.signal?.aborted) {
        const item = await turnQueue.next();
        if (options.signal?.aborted) break;
        if (item === null) break;
        yield item;
        if (item.type === 'complete' || item.type === 'error') break;
      }
    } catch (error: unknown) {
      if (!options.signal?.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error({ msg: `Copilot assistant failed: ${message}`, op: 'copilot.assistant', err: error });
        await this.destroySession(options.conversationId);
        yield { type: 'error', error: message };
      }
    } finally {
      unsubscribe?.();
      if (queue) {
        this.removeActiveQueue(options.conversationId, queue);
      }
      options.signal?.removeEventListener('abort', onAbort);
      releaseRun();
      if (this.runLocks.get(options.conversationId) === chainedRun) {
        this.runLocks.delete(options.conversationId);
      }
    }
  }

  async destroySession(conversationId: string): Promise<void> {
    const state = this.sessions.get(conversationId);
    if (!state) return;
    this.sessions.delete(conversationId);
    this.closeActiveQueues(conversationId);
    await state.session.disconnect();
  }

  async destroyAll(): Promise<void> {
    for (const conversationId of this.sessions.keys()) {
      this.closeActiveQueues(conversationId);
    }
    const states = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(states.map(state => state.session.disconnect()));
    const errors = await this.client.stop();
    if (errors.length > 0) {
      this.logger.warn({ msg: `Copilot client stopped with ${errors.length} cleanup error${errors.length === 1 ? '' : 's'}`, op: 'copilot.assistant' });
    }
  }

  private async getOrCreateSession(options: CopilotRunOptions): Promise<CopilotSessionState> {
    const existing = this.sessions.get(options.conversationId);
    if (existing) return existing;

    const config = this.buildSessionConfig(options);
    const session = options.resumeSessionId
      ? await this.client.resumeSession(options.resumeSessionId, config)
      : await this.client.createSession(config);
    const state: CopilotSessionState = { session };
    this.sessions.set(options.conversationId, state);
    return state;
  }

  private addActiveQueue(conversationId: string, queue: EventQueue): void {
    let queues = this.activeQueues.get(conversationId);
    if (!queues) {
      queues = new Set();
      this.activeQueues.set(conversationId, queues);
    }
    queues.add(queue);
  }

  private removeActiveQueue(conversationId: string, queue: EventQueue): void {
    const queues = this.activeQueues.get(conversationId);
    if (!queues) return;
    queues.delete(queue);
    if (queues.size === 0) {
      this.activeQueues.delete(conversationId);
    }
  }

  private closeActiveQueues(conversationId: string): void {
    const queues = this.activeQueues.get(conversationId);
    if (!queues) return;
    for (const queue of queues) {
      queue.push(null);
    }
    this.activeQueues.delete(conversationId);
  }

  private buildSessionConfig(options: CopilotRunOptions): SessionConfig {
    const availableTools = new ToolSet()
      .addBuiltIn(BuiltInTools.Isolated)
      .addMcp('*')
      .addCustom('*');

    return {
      clientName: 'ClaudeHistorySearch',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      streaming: true,
      includeSubAgentStreamingEvents: false,
      onPermissionRequest: approveAll,
      availableTools,
      tools: this.toolFactory?.() ?? [],
      mcpServers: this.mcpServerFactory?.() ?? {},
      workingDirectory: process.cwd(),
      ...(options.systemPrompt && { systemMessage: { mode: 'append', content: options.systemPrompt } }),
    };
  }

  private enqueueEvent(event: SessionEvent, turnState: { emittedDelta: boolean }, queue: EventQueue, sessionId: string): void {
    if (event.agentId) {
      return;
    }

    if (event.type === 'assistant.message_delta') {
      turnState.emittedDelta = true;
      if (event.data.deltaContent) {
        queue.push({ type: 'delta', text: event.data.deltaContent });
      }
      return;
    }

    if (event.type === 'assistant.message') {
      if (!turnState.emittedDelta && event.data.content) {
        queue.push({ type: 'delta', text: event.data.content });
      }
      return;
    }

    if (event.type === 'session.idle') {
      if (event.data.aborted) {
        queue.push(null);
        return;
      }
      queue.push({ type: 'complete', sessionId });
      return;
    }

    if (event.type === 'session.error') {
      queue.push({ type: 'error', error: event.data.message });
    }
  }
}

export { CopilotAssistantBackend as SdkAssistantBackend };

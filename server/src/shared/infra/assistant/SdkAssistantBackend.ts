/**
 * Real LLM backend adapter using @anthropic-ai/claude-agent-sdk in streaming input mode.
 *
 * Streaming mode: one persistent subprocess per conversation. The SDK manages
 * context automatically. Each call to run() pushes a message to the session's
 * async generator and iterates until a `result` message (the per-turn boundary).
 *
 * Key learnings from spike:
 * - `assistant` message arrives MID-STREAM (before stop events) — swallow it
 * - `result` is emitted per-turn (not per-query) — use it as the turn boundary
 * - After `result`, the query stays alive waiting for the next generator yield
 * - SDKUserMessage requires session_id: "" and parent_tool_use_id: null
 *
 * Piggybacks on the local Claude CLI (no separate API key needed).
 * Must run outside Claude Code (CLAUDECODE env var blocks subprocess spawning).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from '../../provider/index';
import { translateSdkEvent, type SdkMessage, type TranslationState } from './translateSdkEvent';

// --- Message channel: push/pull async generator for feeding messages to the SDK ---

interface SdkUserMessage {
  type: 'user';
  session_id: string;
  parent_tool_use_id: null;
  message: { role: 'user'; content: string };
}

interface MessageChannel {
  generator: AsyncGenerator<SdkUserMessage>;
  push(msg: SdkUserMessage): void;
  close(): void;
}

function createMessageChannel(): MessageChannel {
  const queue: SdkUserMessage[] = [];
  let waiting: ((result: IteratorResult<SdkUserMessage>) => void) | null = null;
  let closed = false;

  const generator: AsyncGenerator<SdkUserMessage> = {
    next(): Promise<IteratorResult<SdkUserMessage>> {
      if (closed) return Promise.resolve({ done: true, value: undefined });
      if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift()! });
      return new Promise(resolve => { waiting = resolve; });
    },
    return(): Promise<IteratorResult<SdkUserMessage>> {
      closed = true;
      if (waiting) { waiting({ done: true, value: undefined }); waiting = null; }
      return Promise.resolve({ done: true, value: undefined });
    },
    throw(e: unknown): Promise<IteratorResult<SdkUserMessage>> {
      closed = true;
      return Promise.reject(e);
    },
    [Symbol.asyncIterator]() { return this; },
    async [Symbol.asyncDispose]() { closed = true; },
  };

  return {
    generator,
    push(msg: SdkUserMessage) {
      if (closed) return;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: false, value: msg });
      } else {
        queue.push(msg);
      }
    },
    close() {
      closed = true;
      if (waiting) { waiting({ done: true, value: undefined }); waiting = null; }
    },
  };
}

// --- Session management ---

interface SdkSession {
  channel: MessageChannel;
  queryIterator: AsyncIterator<unknown>;
  abortController: AbortController;
  state: TranslationState;
}

// Structural types matching AssistantBackend contract (no import from features/)
interface SdkAssistantEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;
  error?: string;
  sessionId?: string;
}

interface SdkRunOptions {
  conversationId: string;
  /** Unused — streaming mode manages context via persistent subprocess. Present for structural compat. */
  resumeSessionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export class SdkAssistantBackend {
  private readonly sessions = new Map<string, SdkSession>();

  constructor(
    private readonly logger: Logger,
    private readonly mcpServers?: Record<string, McpServerConfig>,
  ) {}

  async *run(prompt: string, options: SdkRunOptions): AsyncGenerator<SdkAssistantEvent> {
    let session = this.sessions.get(options.conversationId);
    const isNewSession = !session;

    if (!session) {
      session = this.createSession(options);
      this.sessions.set(options.conversationId, session);
    }

    // Forward external signal to destroy session on abort.
    // Removed in finally block to prevent listener accumulation across turns.
    const onAbort = (): void => { this.destroySession(options.conversationId); };
    if (options.signal) {
      if (options.signal.aborted) {
        this.destroySession(options.conversationId);
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    this.logger.verbose({
      msg: isNewSession ? 'Creating new SDK session' : 'Reusing SDK session',
      op: 'sdk.backend',
      context: { conversationId: options.conversationId },
    });

    // Push user message to the session's generator
    session.channel.push({
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: prompt },
    });

    // Iterate SDK output until `result` (per-turn boundary) or error.
    // The `assistant` message arrives mid-stream and is swallowed by translateSdkEvent.
    // After `result`, the query stays alive — waiting for the next generator yield.
    try {
      while (true) {
        if (options.signal?.aborted) break;

        const { value: message, done } = await session.queryIterator.next();
        if (done) {
          this.sessions.delete(options.conversationId);
          break;
        }

        const result = translateSdkEvent(message as SdkMessage, session.state);
        session.state = result.state;

        if (result.event) {
          if (result.event.type === 'complete' && !result.event.sessionId) {
            this.logger.warn({
              msg: 'SDK completed without session ID',
              op: 'sdk.backend',
              context: { conversationId: options.conversationId },
            });
          }
          yield result.event;
          // 'complete' from result = turn done; 'error' = something failed
          if (result.event.type === 'complete' || result.event.type === 'error') {
            break;
          }
        }
      }
    } catch (err: unknown) {
      this.destroySession(options.conversationId);
      if (options.signal?.aborted) return;

      const errorMessage = err instanceof Error ? err.message : 'Unknown SDK error';
      this.logger.error({
        msg: `SDK query failed: ${errorMessage}`,
        op: 'sdk.backend',
        context: { conversationId: options.conversationId },
      });
      yield { type: 'error', error: errorMessage };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Destroy a session and its subprocess. Abort first (kills subprocess), then close (unblocks generator). */
  destroySession(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.abortController.abort();
    session.channel.close();
    this.sessions.delete(conversationId);
  }

  /** Destroy all active sessions. */
  destroyAll(): void {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      this.destroySession(id);
    }
  }

  private createSession(options: SdkRunOptions): SdkSession {
    const channel = createMessageChannel();
    const abortController = new AbortController();

    const baseTools = [
      'Read', 'Glob', 'Grep', 'Bash',
      'Edit', 'Write',
      'WebSearch', 'WebFetch',
      'Agent', 'Mcp',
    ];

    const q = query({
      prompt: channel.generator,
      options: {
        model: 'claude-opus-4-6',
        effort: 'max',
        includePartialMessages: true,
        abortController,
        tools: baseTools,
        allowedTools: baseTools,
        maxTurns: 50, // Per-session limit; streaming mode reuses one subprocess across turns
        ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
        ...(this.mcpServers && { mcpServers: this.mcpServers }),
      },
    });

    return {
      channel,
      queryIterator: q[Symbol.asyncIterator](),
      abortController,
      state: { sessionId: undefined },
    };
  }
}

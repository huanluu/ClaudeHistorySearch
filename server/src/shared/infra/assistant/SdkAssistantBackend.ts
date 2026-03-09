/**
 * Real LLM backend adapter using @anthropic-ai/claude-agent-sdk.
 * Only file that imports the SDK — all other code uses the AssistantBackend port.
 *
 * Piggybacks on the local Claude CLI (no separate API key needed).
 * Must run outside Claude Code (CLAUDECODE env var blocks subprocess spawning).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from '../../provider/index';
import { translateSdkEvent, type SdkMessage, type TranslationState } from './translateSdkEvent';

// Structural types matching AssistantBackend contract (no import from features/)
interface SdkAssistantEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;
  error?: string;
  sessionId?: string;
}

interface SdkRunOptions {
  conversationId: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export class SdkAssistantBackend {
  constructor(private readonly logger: Logger) {}

  async *run(prompt: string, options: SdkRunOptions): AsyncGenerator<SdkAssistantEvent> {
    const abortController = new AbortController();
    // Forward external signal to SDK's AbortController.
    // { once: true } auto-removes the listener after it fires.
    if (options.signal) {
      options.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    this.logger.verbose({
      msg: 'Starting SDK query',
      op: 'sdk.backend',
      context: {
        conversationId: options.conversationId,
        hasResume: !!options.resumeSessionId,
        hasSystemPrompt: !!options.systemPrompt,
      },
    });

    const q = query({
      prompt,
      options: {
        includePartialMessages: true,
        abortController,
        allowedTools: [],
        maxTurns: 10,
        ...(options.resumeSessionId && { resume: options.resumeSessionId }),
        ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
      },
    });

    let state: TranslationState = { sessionId: undefined };

    try {
      for await (const message of q) {
        if (options.signal?.aborted) break;

        const result = translateSdkEvent(message as SdkMessage, state);
        state = result.state;
        if (result.event) {
          if (result.event.type === 'complete' && !result.event.sessionId) {
            this.logger.warn({
              msg: 'SDK completed without session ID — conversation resume will not work',
              op: 'sdk.backend',
              context: { conversationId: options.conversationId },
            });
          }
          yield result.event;
        }
      }
    } catch (err: unknown) {
      // AbortError is expected when signal fires — not a real error
      if (options.signal?.aborted) return;

      const errorMessage = err instanceof Error ? err.message : 'Unknown SDK error';
      this.logger.error({
        msg: `SDK query failed: ${errorMessage}`,
        op: 'sdk.backend',
        context: { conversationId: options.conversationId },
      });
      yield { type: 'error', error: errorMessage };
    }
  }
}

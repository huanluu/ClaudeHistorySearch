/**
 * Trivial echo backend for wiring and integration testing.
 * Temporary scaffolding — replaced by SdkAssistantBackend in #67.
 *
 * Uses structural typing to satisfy AssistantBackend without importing
 * from features/ (infra modules cannot depend on features).
 */

interface EchoEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;
  sessionId?: string;
}

interface EchoRunOptions {
  conversationId: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export class EchoAssistantBackend {
  async *run(prompt: string, options: EchoRunOptions): AsyncGenerator<EchoEvent> {
    if (options.signal?.aborted) return;
    yield { type: 'delta', text: `Echo: ${prompt}` };
    if (options.signal?.aborted) return;
    const sessionId = options.resumeSessionId ?? `echo-${Date.now()}`;
    yield { type: 'complete', sessionId };
  }
}

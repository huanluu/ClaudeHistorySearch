import type { AssistantBackend, AssistantEvent } from './ports';
import type { Logger } from '../../shared/provider/index';

export class AssistantService {
  private readonly sessionMap = new Map<string, string>();

  constructor(
    private readonly backend: AssistantBackend,
    private readonly logger: Logger,
  ) {}

  async *handleMessage(
    text: string,
    conversationId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AssistantEvent> {
    const resumeSessionId = this.sessionMap.get(conversationId);
    this.logger.verbose({
      msg: `Assistant handling message for conversation ${conversationId}`,
      op: 'assistant.service',
      context: { conversationId, hasResume: !!resumeSessionId },
    });

    for await (const event of this.backend.run(text, {
      conversationId,
      ...(resumeSessionId && { resumeSessionId }),
      signal,
    })) {
      if (signal?.aborted) break;
      if (event.type === 'complete' && event.sessionId) {
        this.sessionMap.set(conversationId, event.sessionId);
      }
      yield event;
    }
  }

  clearConversation(conversationId: string): void {
    this.sessionMap.delete(conversationId);
  }

  clearAll(): void {
    this.sessionMap.clear();
  }
}

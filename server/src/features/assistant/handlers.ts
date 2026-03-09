import type { Logger } from '../../shared/provider/index';
import type {
  AuthenticatedClient,
  ValidatedAssistantMessagePayload,
  ValidatedAssistantCancelPayload,
  WsGateway,
} from '../../gateway/index';
import type { AssistantService } from './AssistantService';

export interface AssistantHandlerDeps {
  assistantService: AssistantService;
  logger: Logger;
}

/**
 * Register WebSocket handlers for assistant chat.
 * Handles assistant.message, assistant.cancel, and client disconnect cleanup.
 *
 * Abort tracking lives entirely in the handler (AD10):
 *   Map<clientId, Map<conversationId, AbortController>>
 */
export function registerAssistantHandlers(
  gateway: WsGateway,
  deps: AssistantHandlerDeps,
): void {
  const { assistantService, logger } = deps;

  // Abort tracking: clientId → conversationId → AbortController
  const controllers = new Map<string, Map<string, AbortController>>();

  function getOrCreateClientMap(clientId: string): Map<string, AbortController> {
    let map = controllers.get(clientId);
    if (!map) {
      map = new Map();
      controllers.set(clientId, map);
    }
    return map;
  }

  function removeController(clientId: string, conversationId: string): void {
    const clientMap = controllers.get(clientId);
    if (clientMap) {
      clientMap.delete(conversationId);
      if (clientMap.size === 0) {
        controllers.delete(clientId);
      }
    }
  }

  gateway.on<ValidatedAssistantMessagePayload>('assistant.message', (client, payload) => {
    const { conversationId, text } = payload;

    // Abort-and-replace: if there's already an in-flight conversation, abort it
    const clientMap = getOrCreateClientMap(client.clientId);
    const existing = clientMap.get(conversationId);
    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    clientMap.set(conversationId, controller);

    void (async () => {
      for await (const event of assistantService.handleMessage(text, conversationId, controller.signal)) {
        try {
          switch (event.type) {
            case 'delta':
              client.send({ type: 'assistant.delta', payload: { conversationId, text: event.text } });
              break;
            case 'complete':
              client.send({ type: 'assistant.complete', payload: { conversationId } });
              break;
            case 'error':
              client.send({
                type: 'assistant.error',
                payload: { conversationId, error: event.error ?? 'Unknown error', errorCode: 'internal' },
              });
              break;
            default:
              logger.warn({
                msg: `Unknown assistant event type: ${(event as { type: string }).type}`,
                op: 'assistant.handler',
              });
          }
        } catch {
          // client.send() threw — client likely disconnected
          break;
        }
      }
      removeController(client.clientId, conversationId);
    })().catch((err: unknown) => {
      try {
        client.send({
          type: 'assistant.error',
          payload: {
            conversationId,
            error: err instanceof Error ? err.message : 'Internal error',
            errorCode: 'internal',
          },
        });
      } catch { /* ignore send failure */ }
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({
        msg: `Assistant handler error: ${errMsg}`,
        op: 'assistant.handler',
        context: { conversationId },
      });
      removeController(client.clientId, conversationId);
    });
  });

  gateway.on<ValidatedAssistantCancelPayload>('assistant.cancel', (client: AuthenticatedClient, payload) => {
    const clientMap = controllers.get(client.clientId);
    const controller = clientMap?.get(payload.conversationId);
    if (controller) {
      controller.abort();
    }
  });

  gateway.onDisconnect((client: AuthenticatedClient) => {
    const clientMap = controllers.get(client.clientId);
    if (clientMap) {
      for (const controller of clientMap.values()) {
        controller.abort();
      }
      controllers.delete(client.clientId);
    }
  });
}

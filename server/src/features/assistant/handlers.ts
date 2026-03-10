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
function sendAssistantEvent(
  client: AuthenticatedClient, event: { type: string; text?: string; error?: string },
  conversationId: string, logger: Logger,
): boolean {
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
        logger.warn({ msg: `Unknown assistant event type: ${event.type}`, op: 'assistant.handler' });
    }
    return true;
  } catch {
    return false; // client likely disconnected
  }
}

function handleStreamError(
  err: unknown, client: AuthenticatedClient, conversationId: string, logger: Logger,
): void {
  try {
    client.send({
      type: 'assistant.error',
      payload: { conversationId, error: err instanceof Error ? err.message : 'Internal error', errorCode: 'internal' },
    });
  } catch { /* ignore send failure */ }
  logger.error({
    msg: `Assistant handler error: ${err instanceof Error ? err.message : String(err)}`,
    op: 'assistant.handler', context: { conversationId },
  });
}

export function registerAssistantHandlers(
  gateway: WsGateway,
  deps: AssistantHandlerDeps,
): void {
  const { assistantService, logger } = deps;
  const controllers = new Map<string, Map<string, AbortController>>();

  function getOrCreateClientMap(clientId: string): Map<string, AbortController> {
    let map = controllers.get(clientId);
    if (!map) { map = new Map(); controllers.set(clientId, map); }
    return map;
  }

  function removeController(clientId: string, conversationId: string): void {
    const clientMap = controllers.get(clientId);
    if (clientMap) {
      clientMap.delete(conversationId);
      if (clientMap.size === 0) controllers.delete(clientId);
    }
  }

  gateway.on<ValidatedAssistantMessagePayload>('assistant.message', (client, payload) => {
    const { conversationId, text } = payload;
    const clientMap = getOrCreateClientMap(client.clientId);
    const existing = clientMap.get(conversationId);
    if (existing) existing.abort();

    const controller = new AbortController();
    clientMap.set(conversationId, controller);

    void (async () => {
      for await (const event of assistantService.handleMessage(text, conversationId, controller.signal)) {
        if (!sendAssistantEvent(client, event, conversationId, logger)) break;
      }
      removeController(client.clientId, conversationId);
    })().catch((err: unknown) => {
      handleStreamError(err, client, conversationId, logger);
      removeController(client.clientId, conversationId);
    });
  });

  gateway.on<ValidatedAssistantCancelPayload>('assistant.cancel', (client: AuthenticatedClient, payload) => {
    controllers.get(client.clientId)?.get(payload.conversationId)?.abort();
  });

  gateway.onDisconnect((client: AuthenticatedClient) => {
    const clientMap = controllers.get(client.clientId);
    if (clientMap) {
      for (const controller of clientMap.values()) controller.abort();
      controllers.delete(client.clientId);
    }
  });
}

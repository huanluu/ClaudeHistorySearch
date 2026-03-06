// Protocol — wire format types (server ↔ client contract)
export type {
  MessageType, WSMessage,
  AuthPayload, AuthResultPayload,
  SessionStartPayload, SessionResumePayload, SessionCancelPayload,
  SessionOutputPayload, SessionErrorPayload, SessionCompletePayload,
  AuthenticatedClient,
} from './protocol';

// Gateway interface types (gateway ↔ features contract)
export type { WsHandler, WsConnectionHandler, WsGateway } from './types';

// Implementations
export { Transport, type TransportOptions, type RequestContext } from './Transport';
export { HttpTransport, type HttpTransportOptions } from './HttpTransport';
export { WebSocketGateway, type WebSocketGatewayOptions } from './WebSocketGateway';

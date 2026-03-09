/**
 * Pure translation layer: SDK message shapes → AssistantEvent.
 *
 * Narrow type aliases for SDK messages — avoids importing SDK types directly
 * so this file is testable without the SDK installed. These shapes are derived
 * from @anthropic-ai/claude-agent-sdk .d.ts and validated by the Phase 0 spike.
 *
 * Forward-compatible: unknown message types return null (no crash).
 */

// --- Narrow SDK type aliases (subset of what we handle) ---

interface SdkSystemMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
}

interface SdkTextDelta {
  type: 'text_delta';
  text: string;
}

interface SdkContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: SdkTextDelta | { type: string };
}

interface SdkContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: { type: string };
}

interface SdkStreamEvent {
  type: 'stream_event';
  event: SdkContentBlockDeltaEvent | SdkContentBlockStartEvent | { type: string };
  session_id: string;
}

interface SdkSuccessResult {
  type: 'result';
  subtype: 'success';
  result: string;
  session_id: string;
}

interface SdkErrorResult {
  type: 'result';
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  errors: string[];
  session_id: string;
}

interface SdkAssistantMessage {
  type: 'assistant';
  session_id: string;
}

/** Union of SDK messages we explicitly handle. Unknown types fall through to null. */
export type SdkMessage =
  | SdkSystemMessage
  | SdkStreamEvent
  | SdkSuccessResult
  | SdkErrorResult
  | SdkAssistantMessage
  | { type: string };

// --- Translation types (structural match for AssistantEvent) ---

interface TranslatedEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;
  error?: string;
  sessionId?: string;
}

export interface TranslationState {
  sessionId: string | undefined;
}

export interface TranslationResult {
  event: TranslatedEvent | null;
  state: TranslationState;
}

// --- Implementation ---

function handleSystemInit(
  message: { session_id?: string },
  _state: TranslationState,
): TranslationResult {
  const sessionId = (message as SdkSystemMessage).session_id;
  return { event: null, state: { sessionId } };
}

function handleStreamEvent(
  message: SdkStreamEvent,
  state: TranslationState,
): TranslationResult {
  const event = message.event;

  if (event.type === 'content_block_delta') {
    const deltaEvent = event as SdkContentBlockDeltaEvent;
    if (deltaEvent.delta.type === 'text_delta') {
      const textDelta = deltaEvent.delta as SdkTextDelta;
      return { event: { type: 'delta', text: textDelta.text }, state };
    }
    // input_json_delta, thinking_delta, etc. — swallow
    return { event: null, state };
  }

  // content_block_start, message_start, message_delta, message_stop, content_block_stop — swallow
  return { event: null, state };
}

function handleResult(
  message: SdkSuccessResult | SdkErrorResult,
  state: TranslationState,
): TranslationResult {
  if (message.subtype === 'success') {
    return {
      event: { type: 'complete', sessionId: state.sessionId },
      state,
    };
  }
  // Error subtypes
  const errorMsg = (message as SdkErrorResult).errors;
  return {
    event: { type: 'error', error: errorMsg.join('; ') },
    state,
  };
}

/**
 * Translate a single SDK message into an AssistantEvent (or null to skip).
 * Pure function — never mutates state; returns a new state object when changed.
 */
export function translateSdkEvent(
  message: SdkMessage,
  state: TranslationState,
): TranslationResult {
  if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
    return handleSystemInit(message, state);
  }

  if (message.type === 'stream_event' && 'event' in message) {
    return handleStreamEvent(message as SdkStreamEvent, state);
  }

  // 'assistant' arrives mid-stream (before stop events). Swallow it but capture session_id.
  if (message.type === 'assistant' && 'session_id' in message) {
    const sessionId = (message as SdkAssistantMessage).session_id || state.sessionId;
    return { event: null, state: { sessionId } };
  }

  if (message.type === 'result' && 'subtype' in message) {
    return handleResult(message as SdkSuccessResult | SdkErrorResult, state);
  }

  // Unknown message type — forward compatible, swallow silently
  return { event: null, state };
}

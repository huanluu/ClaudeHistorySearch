import { describe, it, expect } from 'vitest';
import {
  translateSdkEvent,
  type SdkMessage,
  type TranslationState,
} from './translateSdkEvent';

function emptyState(): TranslationState {
  return { sessionId: undefined };
}

function stateWithSession(sessionId: string): TranslationState {
  return { sessionId };
}

describe('translateSdkEvent', () => {
  it('system.init captures sessionId in state, returns null event', () => {
    const msg: SdkMessage = { type: 'system', subtype: 'init', session_id: 'sess-123' };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toBeNull();
    expect(result.state.sessionId).toBe('sess-123');
  });

  it('stream_event with text_delta returns delta event', () => {
    const msg: SdkMessage = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello world' },
      },
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toEqual({ type: 'delta', text: 'Hello world' });
  });

  it('stream_event with input_json_delta returns null', () => {
    const msg: SdkMessage = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta' },
      },
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toBeNull();
  });

  it('stream_event with content_block_start returns null', () => {
    const msg: SdkMessage = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use' },
      },
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toBeNull();
  });

  it('stream_event with message_start returns null', () => {
    const msg: SdkMessage = {
      type: 'stream_event',
      event: { type: 'message_start' },
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toBeNull();
  });

  it('stream_event with content_block_stop returns null', () => {
    const msg: SdkMessage = {
      type: 'stream_event',
      event: { type: 'content_block_stop' },
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toBeNull();
  });

  it('result success returns complete with sessionId from state', () => {
    const msg: SdkMessage = {
      type: 'result',
      subtype: 'success',
      result: 'Done',
      session_id: 'sess-1',
    };
    const state = stateWithSession('sess-abc');
    const result = translateSdkEvent(msg, state);

    expect(result.event).toEqual({ type: 'complete', sessionId: 'sess-abc' });
  });

  it('result error_max_turns returns error event', () => {
    const msg: SdkMessage = {
      type: 'result',
      subtype: 'error_max_turns',
      errors: ['Max turns exceeded'],
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toEqual({ type: 'error', error: 'Max turns exceeded' });
  });

  it('result error_during_execution joins multiple errors', () => {
    const msg: SdkMessage = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['Network timeout', 'Retry failed'],
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toEqual({ type: 'error', error: 'Network timeout; Retry failed' });
  });

  it('missing init results in complete with undefined sessionId', () => {
    const msg: SdkMessage = {
      type: 'result',
      subtype: 'success',
      result: 'Done',
      session_id: 'sess-1',
    };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toEqual({ type: 'complete', sessionId: undefined });
  });

  it('duplicate init updates state to latest sessionId', () => {
    const init1: SdkMessage = { type: 'system', subtype: 'init', session_id: 'sess-1' };
    const init2: SdkMessage = { type: 'system', subtype: 'init', session_id: 'sess-2' };

    const result1 = translateSdkEvent(init1, emptyState());
    const result2 = translateSdkEvent(init2, result1.state);

    expect(result2.state.sessionId).toBe('sess-2');
  });

  it('assistant message is swallowed but captures session_id', () => {
    const msg: SdkMessage = { type: 'assistant', session_id: 'sess-from-assistant' };
    const result = translateSdkEvent(msg, emptyState());

    expect(result.event).toBeNull();
    expect(result.state.sessionId).toBe('sess-from-assistant');
  });

  it('unknown message type returns null event', () => {
    const msg: SdkMessage = { type: 'status' };
    const result = translateSdkEvent(msg, stateWithSession('sess-1'));

    expect(result.event).toBeNull();
    expect(result.state.sessionId).toBe('sess-1');
  });

  it('does not mutate input state', () => {
    const originalState = emptyState();
    const msg: SdkMessage = { type: 'system', subtype: 'init', session_id: 'sess-new' };

    const result = translateSdkEvent(msg, originalState);

    expect(originalState.sessionId).toBeUndefined();
    expect(result.state.sessionId).toBe('sess-new');
    expect(result.state).not.toBe(originalState);
  });
});

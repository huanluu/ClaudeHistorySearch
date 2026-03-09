import type WebSocket from 'ws';

export interface WSMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

/** Wait for a WebSocket message matching the given type. */
export function waitForMessage(ws: WebSocket, type: string, timeout = 2000): Promise<WSMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout waiting for '${type}' message`)); }, timeout);

    function cleanup() {
      clearTimeout(timer);
      ws.off('message', handler);
      ws.off('close', onClose);
      ws.off('error', onError);
    }
    function handler(data: WebSocket.RawData) {
      let msg: WSMessage;
      try {
        msg = JSON.parse(data.toString()) as WSMessage;
      } catch {
        return; // skip non-JSON frames
      }
      if (msg.type === type) {
        cleanup();
        resolve(msg);
      }
    }
    function onClose() { cleanup(); reject(new Error(`WebSocket closed before '${type}' message`)); }
    function onError(err: Error) { cleanup(); reject(err); }

    ws.on('message', handler);
    ws.on('close', onClose);
    ws.on('error', onError);
  });
}

/** Poll a predicate until it passes or times out. */
export function waitFor(fn: () => void, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function check() {
      try {
        fn();
        resolve();
      } catch {
        if (Date.now() >= deadline) {
          reject(new Error(`waitFor timed out after ${timeout}ms`));
        } else {
          setTimeout(check, 10);
        }
      }
    }
    check();
  });
}

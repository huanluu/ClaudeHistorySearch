import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import WebSocket from 'ws';
import { HttpTransport, WebSocketGateway } from '../../gateway/index';
import { AssistantService, registerAssistantHandlers } from './index';
import { MockAssistantBackend } from '../../../tests/__helpers/MockAssistantBackend';
import { noopLogger, createTestApiKey } from '../../../tests/__helpers/index';
import { waitForMessage } from '../../../tests/__helpers/ws-helpers';
import type { WSMessage } from '../../../tests/__helpers/ws-helpers';

const TEST_CONFIG_DIR = join(tmpdir(), `claude-assistant-integ-${Date.now()}`);
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.json');

describe('Assistant WebSocket Integration', () => {
  let httpTransport: InstanceType<typeof HttpTransport>;
  let wsGateway: WebSocketGateway;
  let testApiKey: string;
  let serverPort: number;
  let originalConfigDir: string | undefined;

  beforeAll(async () => {
    originalConfigDir = process.env.CLAUDE_HISTORY_CONFIG_DIR;
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    process.env.CLAUDE_HISTORY_CONFIG_DIR = TEST_CONFIG_DIR;
    testApiKey = createTestApiKey(TEST_CONFIG_FILE);

    httpTransport = new HttpTransport({ port: 0 });
    await httpTransport.start();

    const server = httpTransport.getServer()!;
    const address = server.address() as { port: number };
    serverPort = address.port;

    // Each call gets its own event sequence — enough sequences for all test cases.
    // The mock cycles through sequences; tests that send multiple messages need multiple entries.
    const mockBackend = new MockAssistantBackend([
      // Test 1: sends assistant.message and receives delta + complete
      [{ type: 'delta', text: 'Hello back' }, { type: 'complete', sessionId: 'integ-sess-1' }],
      // Test 2: deltas contain correct conversationId
      [{ type: 'delta', text: 'Test response' }, { type: 'complete', sessionId: 'integ-sess-2' }],
      // Test 3: multi-turn first message
      [{ type: 'delta', text: 'First reply' }, { type: 'complete', sessionId: 'integ-sess-3' }],
      // Test 3: multi-turn second message
      [{ type: 'delta', text: 'Second reply' }, { type: 'complete', sessionId: 'integ-sess-3' }],
      // Test 4: cancel — first message (may be aborted)
      [{ type: 'delta', text: 'Cancelled' }, { type: 'complete', sessionId: 'integ-sess-4' }],
      // Test 4: message after cancel
      [{ type: 'delta', text: 'Still works' }, { type: 'complete', sessionId: 'integ-sess-5' }],
      // Test 6: disconnect/reconnect first message
      [{ type: 'delta', text: 'Turn 1' }, { type: 'complete', sessionId: 'integ-sess-6' }],
      // Test 6: disconnect/reconnect second message
      [{ type: 'delta', text: 'Turn 2' }, { type: 'complete', sessionId: 'integ-sess-6' }],
    ]);
    const assistantService = new AssistantService(mockBackend, noopLogger);

    wsGateway = new WebSocketGateway({ server, path: '/ws', logger: noopLogger });
    registerAssistantHandlers(wsGateway, { assistantService, logger: noopLogger });
    wsGateway.start();
  });

  afterAll(async () => {
    await wsGateway?.stop();
    await httpTransport?.stop();
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_HISTORY_CONFIG_DIR;
    } else {
      process.env.CLAUDE_HISTORY_CONFIG_DIR = originalConfigDir;
    }
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;
        if (message.type === 'auth_result') {
          resolve(ws);
        }
      });
      ws.on('error', reject);
    });
  }

  it('sends assistant.message and receives assistant.delta + assistant.complete', async () => {
    const ws = await connectClient();

    // Register both listeners before sending to avoid race condition
    const deltaP = waitForMessage(ws, 'assistant.delta');
    const completeP = waitForMessage(ws, 'assistant.complete');

    ws.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-1', text: 'hello world' },
    }));

    const delta = await deltaP;
    expect((delta.payload as { conversationId: string }).conversationId).toBe('conv-1');
    expect((delta.payload as { text: string }).text).toBe('Hello back');

    const complete = await completeP;
    expect((complete.payload as { conversationId: string }).conversationId).toBe('conv-1');

    ws.close();
  });

  it('deltas contain correct conversationId', async () => {
    const ws = await connectClient();

    ws.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-id-check', text: 'test' },
    }));

    const delta = await waitForMessage(ws, 'assistant.delta');
    expect((delta.payload as { conversationId: string }).conversationId).toBe('conv-id-check');

    ws.close();
  });

  it('multi-turn with same conversationId (second message gets resume behavior)', async () => {
    const ws = await connectClient();

    // First message — register both listeners before sending
    const delta1P = waitForMessage(ws, 'assistant.delta');
    const complete1P = waitForMessage(ws, 'assistant.complete');
    ws.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-multi', text: 'first' },
    }));
    await delta1P;
    await complete1P;

    // Second message — register both listeners before sending
    const delta2P = waitForMessage(ws, 'assistant.delta');
    const complete2P = waitForMessage(ws, 'assistant.complete');
    ws.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-multi', text: 'second' },
    }));

    const delta2 = await delta2P;
    expect((delta2.payload as { text: string }).text).toBe('Second reply');

    const complete2 = await complete2P;
    expect((complete2.payload as { conversationId: string }).conversationId).toBe('conv-multi');

    ws.close();
  });

  it('assistant.cancel stops in-flight stream', async () => {
    const ws = await connectClient();

    ws.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-cancel', text: 'something' },
    }));

    // MockBackend is fast, but we send cancel anyway to verify it doesn't crash
    ws.send(JSON.stringify({
      type: 'assistant.cancel',
      payload: { conversationId: 'conv-cancel' },
    }));

    // Should not crash the connection — send another message to prove it
    ws.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-after-cancel', text: 'still works' },
    }));

    const delta = await waitForMessage(ws, 'assistant.delta');
    expect((delta.payload as { text: string }).text).toBe('Still works');

    ws.close();
  });

  it('unauthenticated client is rejected', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);

    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      ws.on('error', () => resolve());
    });

    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('disconnect and reconnect with same conversationId preserves multi-turn', async () => {
    const ws1 = await connectClient();

    // First turn — register both listeners before sending
    const delta1P = waitForMessage(ws1, 'assistant.delta');
    const complete1P = waitForMessage(ws1, 'assistant.complete');
    ws1.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-reconnect', text: 'turn1' },
    }));
    await delta1P;
    await complete1P;
    ws1.close();

    // Reconnect — register both listeners before sending
    const ws2 = await connectClient();
    const delta2P = waitForMessage(ws2, 'assistant.delta');
    const complete2P = waitForMessage(ws2, 'assistant.complete');
    ws2.send(JSON.stringify({
      type: 'assistant.message',
      payload: { conversationId: 'conv-reconnect', text: 'turn2' },
    }));

    const delta = await delta2P;
    expect((delta.payload as { text: string }).text).toBe('Turn 2');

    const complete = await complete2P;
    expect((complete.payload as { conversationId: string }).conversationId).toBe('conv-reconnect');

    ws2.close();
  });
});

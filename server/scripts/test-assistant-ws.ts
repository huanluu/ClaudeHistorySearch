#!/usr/bin/env tsx
/**
 * Manual test script for the assistant WebSocket echo backend.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/test-assistant-ws.ts            # interactive mode
 *   npx tsx scripts/test-assistant-ws.ts "hello"    # one-shot mode
 *
 * Requires the server to be running (npm start or launchd).
 * Reads API key from ~/.claude-history-server/.api-key.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import WebSocket from 'ws';

const PORT = 3847;
const CONFIG_DIR = process.env.CLAUDE_HISTORY_CONFIG_DIR || join(homedir(), '.claude-history-server');
const API_KEY_FILE = join(CONFIG_DIR, '.api-key');

interface WSMessage {
  type: string;
  payload?: Record<string, unknown>;
}

function getApiKey(): string {
  if (!existsSync(API_KEY_FILE)) {
    console.error(`No API key found at ${API_KEY_FILE}`);
    console.error('Run: cd server && npm run key:generate');
    process.exit(1);
  }
  return readFileSync(API_KEY_FILE, 'utf-8').trim();
}

function connect(apiKey: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?apiKey=${apiKey}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection timeout — is the server running on port ${PORT}?`));
    }, 5000);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as WSMessage;
      if (msg.type === 'auth_result') {
        clearTimeout(timeout);
        const payload = msg.payload as { success: boolean; message?: string };
        if (payload.success) {
          resolve(ws);
        } else {
          ws.close();
          reject(new Error(`Auth failed: ${payload.message ?? 'unknown'}`));
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function listenForResponses(ws: WebSocket): void {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as WSMessage;
    const payload = msg.payload as Record<string, unknown> | undefined;

    switch (msg.type) {
      case 'assistant.delta':
        process.stdout.write(`\x1b[36m${payload?.text ?? ''}\x1b[0m`);
        break;
      case 'assistant.complete':
        console.log('\n\x1b[32m[complete]\x1b[0m');
        break;
      case 'assistant.error':
        console.log(`\n\x1b[31m[error] ${payload?.error} (${payload?.errorCode ?? 'unknown'})\x1b[0m`);
        break;
      case 'error':
        console.log(`\x1b[31m[server error] ${JSON.stringify(payload)}\x1b[0m`);
        break;
    }
  });
}

function sendMessage(ws: WebSocket, text: string, conversationId: string): void {
  ws.send(JSON.stringify({
    type: 'assistant.message',
    payload: { conversationId, text },
  }));
}

async function main(): Promise<void> {
  const apiKey = getApiKey();
  const oneShotText = process.argv[2];

  console.log(`Connecting to ws://127.0.0.1:${PORT}/ws ...`);
  const ws = await connect(apiKey);
  console.log('Connected and authenticated.\n');

  listenForResponses(ws);

  const conversationId = `manual-${Date.now()}`;

  if (oneShotText) {
    // One-shot mode
    console.log(`> ${oneShotText}`);
    sendMessage(ws, oneShotText, conversationId);
    // Wait for complete then exit
    await new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as WSMessage;
        if (msg.type === 'assistant.complete' || msg.type === 'assistant.error') {
          setTimeout(() => { ws.close(); resolve(); }, 100);
        }
      });
    });
    return;
  }

  // Interactive mode
  console.log('Type a message and press Enter. Ctrl+C to quit.');
  console.log(`Conversation: ${conversationId}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('\x1b[33m> \x1b[0m');
  rl.prompt();

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    sendMessage(ws, text, conversationId);
    // Prompt again after response
    const onMsg = (data: WebSocket.RawData): void => {
      const msg = JSON.parse(data.toString()) as WSMessage;
      if (msg.type === 'assistant.complete' || msg.type === 'assistant.error') {
        ws.off('message', onMsg);
        rl.prompt();
      }
    };
    ws.on('message', onMsg);
  });

  rl.on('close', () => {
    ws.close();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

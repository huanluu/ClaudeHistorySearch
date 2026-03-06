import { mkdirSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { generateApiKey, validateApiKey, hasApiKey, removeApiKey } from './keyManager';

let testDir: string;
let originalConfigDir: string | undefined;

beforeEach(() => {
  testDir = join(tmpdir(), `keymanager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  originalConfigDir = process.env.CLAUDE_HISTORY_CONFIG_DIR;
  process.env.CLAUDE_HISTORY_CONFIG_DIR = testDir;
});

afterEach(() => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_HISTORY_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.CLAUDE_HISTORY_CONFIG_DIR;
  }
  rmSync(testDir, { recursive: true, force: true });
});

describe('generateApiKey', () => {
  it('returns a 64-character hex string', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists a SHA-256 hash (not plaintext) to config.json', () => {
    const key = generateApiKey();
    const config = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    const expectedHash = createHash('sha256').update(key).digest('hex');

    expect(config.apiKeyHash).toBe(expectedHash);
    expect(config.apiKeyHash).not.toBe(key);
    expect(config.apiKeyCreatedAt).toBeDefined();
  });

  it('writes plaintext key to .api-key file', () => {
    const key = generateApiKey();
    const stored = readFileSync(join(testDir, '.api-key'), 'utf-8');
    expect(stored).toBe(key);
  });

  it('sets restrictive permissions (0o600) on .api-key file', () => {
    generateApiKey();
    const stats = statSync(join(testDir, '.api-key'));
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('called twice overwrites the previous key', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();

    expect(key1).not.toBe(key2);

    const config = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    const expectedHash = createHash('sha256').update(key2).digest('hex');
    expect(config.apiKeyHash).toBe(expectedHash);

    const storedKey = readFileSync(join(testDir, '.api-key'), 'utf-8');
    expect(storedKey).toBe(key2);

    expect(validateApiKey(key1)).toBe(false);
    expect(validateApiKey(key2)).toBe(true);
  });
});

describe('validateApiKey', () => {
  it('returns true for the correct generated key', () => {
    const key = generateApiKey();
    expect(validateApiKey(key)).toBe(true);
  });

  it('returns false for a wrong key', () => {
    generateApiKey();
    expect(validateApiKey('wrong-key-value')).toBe(false);
  });

  it('returns false for undefined input', () => {
    generateApiKey();
    expect(validateApiKey(undefined)).toBe(false);
  });

  it('returns false for array input', () => {
    const key = generateApiKey();
    expect(validateApiKey([key])).toBe(false);
    expect(validateApiKey([key, key])).toBe(false);
  });
});

describe('hasApiKey', () => {
  it('returns false before any key is generated', () => {
    expect(hasApiKey()).toBe(false);
  });

  it('returns true after generateApiKey is called', () => {
    generateApiKey();
    expect(hasApiKey()).toBe(true);
  });

  it('returns false after removeApiKey is called', () => {
    generateApiKey();
    expect(hasApiKey()).toBe(true);
    removeApiKey();
    expect(hasApiKey()).toBe(false);
  });
});

describe('removeApiKey', () => {
  it('deletes the hash from config.json', () => {
    generateApiKey();
    removeApiKey();

    const config = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(config.apiKeyHash).toBeUndefined();
    expect(config.apiKeyCreatedAt).toBeUndefined();
  });

  it('deletes the .api-key file', () => {
    generateApiKey();
    expect(existsSync(join(testDir, '.api-key'))).toBe(true);
    removeApiKey();
    expect(existsSync(join(testDir, '.api-key'))).toBe(false);
  });
});

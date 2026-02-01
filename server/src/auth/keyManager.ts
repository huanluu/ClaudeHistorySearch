import { randomBytes, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface Config {
  apiKeyHash?: string;
  apiKeyCreatedAt?: string;
}

// Dynamic config path to support testing via env var
function getConfigDir(): string {
  return process.env.CLAUDE_HISTORY_CONFIG_DIR || join(homedir(), '.claude-history-server');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load config from disk
 */
function loadConfig(): Config {
  ensureConfigDir();
  const configFile = getConfigFile();
  if (!existsSync(configFile)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configFile, 'utf-8')) as Config;
  } catch {
    return {};
  }
}

/**
 * Save config to disk
 */
function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2));
}

/**
 * Hash an API key using SHA-256
 * We use SHA-256 instead of bcrypt for simplicity since API keys are random
 * and don't suffer from dictionary attacks like passwords do
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key
 * Returns the plaintext key (only shown once) and stores the hash
 */
export function generateApiKey(): string {
  const key = randomBytes(32).toString('hex');
  const hash = hashKey(key);

  const config = loadConfig();
  config.apiKeyHash = hash;
  config.apiKeyCreatedAt = new Date().toISOString();
  saveConfig(config);

  return key;
}

/**
 * Validate an API key against the stored hash
 */
export function validateApiKey(key: string | string[] | undefined): boolean {
  if (!key || Array.isArray(key)) return false;

  const config = loadConfig();
  if (!config.apiKeyHash) return false;

  const hash = hashKey(key);
  return hash === config.apiKeyHash;
}

/**
 * Check if an API key has been configured
 */
export function hasApiKey(): boolean {
  const config = loadConfig();
  return !!config.apiKeyHash;
}

/**
 * Remove the API key
 */
export function removeApiKey(): void {
  const config = loadConfig();
  delete config.apiKeyHash;
  delete config.apiKeyCreatedAt;
  saveConfig(config);
}

// CLI command for generating a key
if (process.argv[1]?.endsWith('keyManager.ts') && process.argv[2] === 'generate') {
  const key = generateApiKey();
  console.log('\n=== API Key Generated ===\n');
  console.log(`Your API key: ${key}\n`);
  console.log('IMPORTANT: Save this key securely. It will not be shown again.\n');
  console.log(`Config stored at: ${getConfigFile()}\n`);
}

import type { Logger } from '../../src/shared/provider/index';
import { randomBytes, createHash } from 'crypto';
import { writeFileSync } from 'fs';

export const noopLogger: Logger = {
  log: () => {},
  error: () => {},
  warn: () => {},
  verbose: () => {},
};

interface Config {
  apiKeyHash?: string;
  apiKeyCreatedAt?: string;
}

export function createTestApiKey(configFilePath: string): string {
  const key = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(key).digest('hex');
  const config: Config = {
    apiKeyHash: hash,
    apiKeyCreatedAt: new Date().toISOString(),
  };
  writeFileSync(configFilePath, JSON.stringify(config));
  return key;
}

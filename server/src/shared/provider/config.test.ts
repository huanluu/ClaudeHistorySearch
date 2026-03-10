import { join } from 'path';
import { homedir } from 'os';
import { getConfigDir } from './config';

describe('getConfigDir', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns default path when env var is not set', () => {
    delete process.env.CLAUDE_HISTORY_CONFIG_DIR;

    expect(getConfigDir()).toBe(join(homedir(), '.claude-history-server'));
  });

  it('returns custom path when CLAUDE_HISTORY_CONFIG_DIR is set', () => {
    vi.stubEnv('CLAUDE_HISTORY_CONFIG_DIR', '/tmp/custom-config');

    expect(getConfigDir()).toBe('/tmp/custom-config');
  });

  it('returns env var value for unusual paths', () => {
    vi.stubEnv('CLAUDE_HISTORY_CONFIG_DIR', '/mnt/volume/with spaces/config');

    expect(getConfigDir()).toBe('/mnt/volume/with spaces/config');
  });
});

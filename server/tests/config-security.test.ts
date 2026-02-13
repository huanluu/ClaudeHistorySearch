import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigService } from '../src/services/ConfigService.js';

describe('ConfigService security section', () => {
  let configDir: string;
  let configPath: string;
  let service: ConfigService;

  beforeEach(() => {
    configDir = join(tmpdir(), `config-sec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, 'config.json');
    service = new ConfigService(configDir);
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('should include security as an editable section', () => {
    const names = service.getEditableSectionNames();
    expect(names).toContain('security');
  });

  it('should accept valid string[] for allowedWorkingDirs', () => {
    const err = service.updateSection('security', {
      allowedWorkingDirs: ['/home/user/projects', '/tmp/test'],
    });
    expect(err).toBeNull();

    const section = service.getSection('security');
    expect(section!.allowedWorkingDirs).toEqual(['/home/user/projects', '/tmp/test']);
  });

  it('should reject non-array value for allowedWorkingDirs', () => {
    const err = service.updateSection('security', {
      allowedWorkingDirs: '/not/an/array' as any,
    });
    expect(err).toMatch(/must be an array/i);
  });

  it('should reject array with non-string items', () => {
    const err = service.updateSection('security', {
      allowedWorkingDirs: ['/valid', 123, true] as any,
    });
    expect(err).toMatch(/must contain only string/i);
  });

  it('should accept empty array', () => {
    const err = service.updateSection('security', {
      allowedWorkingDirs: [],
    });
    expect(err).toBeNull();

    const section = service.getSection('security');
    expect(section!.allowedWorkingDirs).toEqual([]);
  });

  it('should round-trip through updateSection and getSection', () => {
    const dirs = ['/Users/dev/project1', '/Users/dev/project2'];
    service.updateSection('security', { allowedWorkingDirs: dirs });

    const section = service.getSection('security');
    expect(section!.allowedWorkingDirs).toEqual(dirs);

    // Verify persisted on disk
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.security.allowedWorkingDirs).toEqual(dirs);
  });
});

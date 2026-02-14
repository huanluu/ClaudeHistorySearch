import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdirSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkingDirValidator } from '../src/provider/index.js';

describe('WorkingDirValidator', () => {
  // Resolve tmpdir to handle macOS /var → /private/var symlink
  let testRoot: string;
  let allowedDir: string;
  let forbiddenDir: string;
  let symlinkInside: string;
  let symlinkOutside: string;

  beforeAll(() => {
    const rawRoot = join(tmpdir(), `wdv-test-${Date.now()}`);
    mkdirSync(rawRoot, { recursive: true });
    testRoot = realpathSync(rawRoot);

    allowedDir = join(testRoot, 'allowed');
    forbiddenDir = join(testRoot, 'forbidden');
    symlinkInside = join(testRoot, 'link-inside');
    symlinkOutside = join(testRoot, 'link-outside');

    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(join(allowedDir, 'subdir'), { recursive: true });
    mkdirSync(forbiddenDir, { recursive: true });
    // Symlink pointing inside allowed dir
    symlinkSync(join(allowedDir, 'subdir'), symlinkInside);
    // Symlink pointing outside allowed dir
    symlinkSync(forbiddenDir, symlinkOutside);
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  describe('empty allowlist', () => {
    it('rejects all paths with helpful error', () => {
      const validator = new WorkingDirValidator([]);
      const result = validator.validate('/tmp');
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/no allowed working directories/i);
    });
  });

  describe('exact match', () => {
    it('allows exact match of allowed directory', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(allowedDir);
      expect(result.allowed).toBe(true);
      expect(result.resolvedPath).toBe(allowedDir);
    });
  });

  describe('subdirectory of allowed dir', () => {
    it('allows subdirectories', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(join(allowedDir, 'subdir'));
      expect(result.allowed).toBe(true);
    });
  });

  describe('path traversal', () => {
    it('blocks path traversal attempts that resolve outside allowlist', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const traversalPath = join(allowedDir, '..', 'forbidden');
      const result = validator.validate(traversalPath);
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/not within any allowed directory/i);
    });
  });

  describe('similar prefix attack', () => {
    it('blocks /tmp-evil when only /tmp is allowed', () => {
      const tmpDir = join(testRoot, 'tmp');
      const tmpEvil = join(testRoot, 'tmp-evil');
      mkdirSync(tmpDir, { recursive: true });
      mkdirSync(tmpEvil, { recursive: true });

      const validator = new WorkingDirValidator([tmpDir]);
      const result = validator.validate(tmpEvil);
      expect(result.allowed).toBe(false);
    });
  });

  describe('symlinks', () => {
    it('blocks symlink pointing outside allowed dir', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(symlinkOutside);
      expect(result.allowed).toBe(false);
    });

    it('allows symlink pointing inside allowed dir', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(symlinkInside);
      expect(result.allowed).toBe(true);
    });
  });

  describe('invalid input', () => {
    it('rejects null input', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(null as unknown as string);
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/invalid|required/i);
    });

    it('rejects empty string', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate('');
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/invalid|required/i);
    });

    it('rejects non-string input', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(123 as unknown as string);
      expect(result.allowed).toBe(false);
      expect(result.error).toMatch(/invalid|required/i);
    });
  });

  describe('non-existent subdirectory of allowed dir', () => {
    it('allows non-existent subdirectory (Claude may create it)', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const result = validator.validate(join(allowedDir, 'does-not-exist', 'yet'));
      expect(result.allowed).toBe(true);
    });
  });

  describe('setAllowedDirs (hot reload)', () => {
    it('updates the allowlist dynamically', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      expect(validator.validate(forbiddenDir).allowed).toBe(false);

      validator.setAllowedDirs([forbiddenDir]);
      expect(validator.validate(forbiddenDir).allowed).toBe(true);
      expect(validator.validate(allowedDir).allowed).toBe(false);
    });
  });

  describe('getAllowedDirs', () => {
    it('returns the resolved allowed directories', () => {
      const validator = new WorkingDirValidator([allowedDir]);
      const dirs = validator.getAllowedDirs();
      expect(dirs).toContain(allowedDir);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { NodeFileSystem } from './NodeFileSystem';

describe('NodeFileSystem', () => {
  let fs: NodeFileSystem;
  let tempDir: string;

  beforeEach(() => {
    fs = new NodeFileSystem();
    tempDir = mkdtempSync(join(tmpdir(), 'nodefs-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('readFile returns file contents', () => {
    const filePath = join(tempDir, 'test.txt');
    writeFileSync(filePath, 'hello world');
    expect(fs.readFile(filePath)).toBe('hello world');
  });

  it('writeFile creates a file with content', () => {
    const filePath = join(tempDir, 'out.txt');
    fs.writeFile(filePath, 'written');
    expect(fs.readFile(filePath)).toBe('written');
  });

  it('exists returns true for existing files', () => {
    const filePath = join(tempDir, 'exists.txt');
    writeFileSync(filePath, '');
    expect(fs.exists(filePath)).toBe(true);
  });

  it('exists returns false for missing files', () => {
    expect(fs.exists(join(tempDir, 'nope.txt'))).toBe(false);
  });

  it('listDirectory returns directory entries', () => {
    writeFileSync(join(tempDir, 'a.txt'), '');
    writeFileSync(join(tempDir, 'b.txt'), '');
    const entries = fs.listDirectory(tempDir);
    expect(entries.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('stat returns file metadata', () => {
    const filePath = join(tempDir, 'meta.txt');
    writeFileSync(filePath, 'content');
    const stat = fs.stat(filePath);
    expect(stat.isDirectory).toBe(false);
    expect(stat.mtimeMs).toBeGreaterThan(0);
    expect(stat.size).toBe(7);
  });

  it('stat returns isDirectory true for directories', () => {
    const dirPath = join(tempDir, 'subdir');
    mkdirSync(dirPath);
    expect(fs.stat(dirPath).isDirectory).toBe(true);
  });

  it('mkdir creates nested directories', () => {
    const nested = join(tempDir, 'a', 'b', 'c');
    fs.mkdir(nested, { recursive: true });
    expect(fs.exists(nested)).toBe(true);
    expect(fs.stat(nested).isDirectory).toBe(true);
  });
});

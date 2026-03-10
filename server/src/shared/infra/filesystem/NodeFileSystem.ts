import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import type { FileSystem, FileStat } from '../../provider/index';

export class NodeFileSystem implements FileSystem {
  readFile(path: string): string {
    return readFileSync(path, 'utf-8');
  }

  writeFile(path: string, content: string): void {
    writeFileSync(path, content);
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  listDirectory(path: string): string[] {
    return readdirSync(path);
  }

  stat(path: string): FileStat {
    const s = statSync(path);
    return { isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
  }

  mkdir(path: string, options?: { recursive: boolean }): void {
    mkdirSync(path, options);
  }
}

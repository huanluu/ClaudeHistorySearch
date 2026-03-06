/**
 * Shared utilities for scorecard structural tests.
 *
 * All scorecard test files import from here. Do not import
 * from src/ modules — these utilities work on the filesystem.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SRC_DIR = join(__dirname, '..', '..', 'src');
export const TESTS_DIR = join(__dirname, '..', '..', 'tests');
export const SERVER_DIR = join(__dirname, '..', '..');
export const ROOT_DIR = join(__dirname, '..', '..', '..');

/**
 * Recursively collect all .ts files in a directory.
 */
export function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Collect only source (non-test) .ts files from a directory. */
export function collectSrcFiles(dir: string): string[] {
  return collectTsFiles(dir).filter(f => !f.endsWith('.test.ts'));
}

/** Collect all test files from src/ (co-located), tests/, and scorecard/tests/. */
export function collectAllTestFiles(): string[] {
  const scorecardTestsDir = join(__dirname);
  return [
    ...collectTsFiles(SRC_DIR).filter(f => f.endsWith('.test.ts')),
    ...collectTsFiles(TESTS_DIR).filter(f => f.endsWith('.test.ts')),
    ...collectTsFiles(scorecardTestsDir).filter(f => f.endsWith('.test.ts')),
  ];
}

/**
 * Extract import paths from a TypeScript source file.
 * Matches both `import ... from '...'` and `import ... from "..."`.
 */
export function extractImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const imports: string[] = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

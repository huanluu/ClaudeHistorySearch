import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');

/**
 * Recursively collect all .ts files in a directory.
 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
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

/**
 * Extract import paths from a TypeScript source file.
 * Matches both `import ... from '...'` and `import ... from "..."`.
 */
function extractImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const imports: string[] = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

/**
 * Check if any import in the given module references a forbidden module.
 * Returns an array of violations: { file, importPath, forbiddenModule }.
 */
function findViolations(
  moduleDir: string,
  forbiddenModules: string[]
): Array<{ file: string; importPath: string; forbiddenModule: string }> {
  const files = collectTsFiles(join(SRC_DIR, moduleDir));
  const violations: Array<{ file: string; importPath: string; forbiddenModule: string }> = [];

  for (const file of files) {
    const imports = extractImports(file);
    for (const imp of imports) {
      for (const forbidden of forbiddenModules) {
        // Match imports like '../database/...' or './database/...' or '../database'
        const pattern = new RegExp(`(^|/)${forbidden}(/|$)`);
        if (pattern.test(imp)) {
          violations.push({
            file: file.replace(SRC_DIR + '/', ''),
            importPath: imp,
            forbiddenModule: forbidden,
          });
        }
      }
    }
  }

  return violations;
}

describe('Architecture: layer dependency rules', () => {
  it('provider/ has zero imports from database/, services/, sessions/, transport/, api/', () => {
    const violations = findViolations('provider', ['database', 'services', 'sessions', 'transport', 'api']);
    expect(violations).toEqual([]);
  });

  it('database/ has zero imports from services/, sessions/, transport/, api/', () => {
    const violations = findViolations('database', ['services', 'sessions', 'transport', 'api']);
    expect(violations).toEqual([]);
  });

  it('services/ has zero imports from sessions/, transport/, api/', () => {
    const violations = findViolations('services', ['sessions', 'transport', 'api']);
    expect(violations).toEqual([]);
  });

  it('sessions/ has zero imports from transport/, api/', () => {
    const violations = findViolations('sessions', ['transport', 'api']);
    expect(violations).toEqual([]);
  });

  // api/ is the top layer — no layer restrictions (can import everything)
});

describe('Architecture: barrel file existence', () => {
  const modules = ['provider', 'database', 'services', 'sessions', 'transport', 'api'];

  for (const mod of modules) {
    it(`${mod}/ has an index.ts barrel file`, () => {
      const indexPath = join(SRC_DIR, mod, 'index.ts');
      expect(() => statSync(indexPath)).not.toThrow();
    });
  }
});

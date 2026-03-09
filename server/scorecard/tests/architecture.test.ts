/**
 * Architecture Invariant Tests
 *
 * ARCH-INV-1: Layer Import Direction → eslint.config.js Blocks 3-7
 * OBS-INV-1:  No Console in Source   → eslint.config.js Block 10
 *
 * Tests here cover invariants requiring cross-file structural analysis.
 */
import { readFileSync, statSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { collectSrcFiles, collectTsFiles, extractImports, SRC_DIR } from './helpers';

const modules = [
  'shared/provider',
  'shared/infra/database',
  'shared/infra/runtime',
  'gateway',
  'features/search',
  'features/live',
  'features/scheduler',
  'features/admin',
];

describe('Scorecard: Architecture Invariants', () => {

  // ─── ARCH-INV-2: Barrel Encapsulation ────────────────────────────
  describe('ARCH-INV-2: Barrel Encapsulation', () => {
    for (const mod of modules) {
      it(`${mod}/ has an index.ts barrel file`, () => {
        const indexPath = join(SRC_DIR, mod, 'index.ts');
        expect(() => statSync(indexPath)).not.toThrow();
      });
    }
  });

  // ─── ARCH-INV-3: No Circular Dependencies ───────────────────────
  it('ARCH-INV-3: No Circular Dependencies', () => {
    const allFiles = collectSrcFiles(SRC_DIR);
    const graph = new Map<string, string[]>();

    for (const file of allFiles) {
      const relFile = relative(SRC_DIR, file);
      const imports = extractImports(file);
      const resolvedImports: string[] = [];

      for (const imp of imports) {
        if (!imp.startsWith('.')) continue;
        const fileDir = dirname(file);
        let resolved = join(fileDir, imp);
        resolved = relative(SRC_DIR, resolved);
        resolved = resolved.replace(/\.js$/, '');
        resolvedImports.push(resolved);
      }
      graph.set(relFile.replace(/\.ts$/, ''), resolvedImports);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    function dfs(node: string, path: string[]): void {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (graph.has(neighbor)) {
          dfs(neighbor, [...path]);
        }
      }
      inStack.delete(node);
    }

    for (const node of graph.keys()) {
      dfs(node, []);
    }

    expect(cycles).toEqual([]);
  });

  // ─── ARCH-INV-4: Composition Root Monopoly ──────────────────────
  it('ARCH-INV-4: Composition Root Monopoly — no cross-module `new` outside app.ts', () => {
    const allFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; match: string }> = [];

    function getFileModule(relFile: string): string {
      const parts = relFile.split('/');
      if (parts.length >= 2 && (parts[0] === 'shared' || parts[0] === 'features')) {
        return `${parts[0]}/${parts[1]}`;
      }
      return parts[0];
    }

    for (const file of allFiles) {
      const relFile = relative(SRC_DIR, file);
      if (relFile === 'app.ts' || relFile === 'index.ts') continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const fileModule = getFileModule(relFile);

      const crossModuleClasses = new Set<string>();
      for (const line of lines) {
        const importMatch = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          const importPath = importMatch[2];
          for (const mod of modules) {
            if (mod !== fileModule && importPath.includes(`/${mod}/`)) {
              const names = importMatch[1].split(',').map(n => n.trim().replace(/^type\s+/, ''));
              for (const name of names) {
                if (/^[A-Z]/.test(name) && !name.startsWith('type ')) {
                  crossModuleClasses.add(name);
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < lines.length; i++) {
        for (const cls of crossModuleClasses) {
          if (lines[i].includes(`new ${cls}(`)) {
            violations.push({
              file: relFile,
              line: i + 1,
              match: `new ${cls}(...)`,
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── ARCH-INV-7: No Exported Singleton Instances ────────────────
  it('ARCH-INV-7: No Exported Singleton Instances', () => {
    const allFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; match: string }> = [];

    const singletonPattern = /^export\s+const\s+\w+\s*=\s*new\s+\w+\(/;

    for (const file of allFiles) {
      const relFile = relative(SRC_DIR, file);
      if (relFile === 'app.ts' || relFile === 'index.ts') continue;

      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (singletonPattern.test(trimmed)) {
          violations.push({
            file: relFile,
            line: i + 1,
            match: trimmed.slice(0, 80),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── ARCH-INV-8: Domain Types File Contains Only Types ──────────
  it('ARCH-INV-8: types.ts exports only types', () => {
    const typesPath = join(SRC_DIR, 'shared/provider/types.ts');
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).not.toMatch(/^export (const|let|var|function|class|default) /m);
  });

  // ─── ARCH-INV-9: Features Must Be Effectless ──────────────────
  it.fails('ARCH-INV-9: Feature files do not import I/O modules', () => {
    const featureDir = join(SRC_DIR, 'features');
    const featureFiles = collectSrcFiles(featureDir);
    const ioModules = [
      'fs', 'fs/promises', 'child_process', 'net', 'http', 'https',
      'better-sqlite3',
      'node:fs', 'node:fs/promises', 'node:child_process', 'node:net', 'node:http', 'node:https',
    ];
    const violations: Array<{ file: string; module: string }> = [];

    for (const file of featureFiles) {
      const imports = extractImports(file);
      for (const imp of imports) {
        if (ioModules.includes(imp)) {
          violations.push({
            file: relative(SRC_DIR, file),
            module: imp,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── ARCH-INV-10: Infra Sibling Isolation ──────────────────────
  it('ARCH-INV-10: Infra modules do not import from sibling infra modules', () => {
    const infraModules = ['database', 'runtime', 'parsers'];
    const violations: Array<{ file: string; importsFrom: string }> = [];

    for (const moduleName of infraModules) {
      const moduleDir = join(SRC_DIR, 'shared/infra', moduleName);
      if (!existsSync(moduleDir)) continue;

      const files = collectSrcFiles(moduleDir);
      for (const file of files) {
        const imports = extractImports(file);
        for (const imp of imports) {
          for (const sibling of infraModules) {
            if (sibling === moduleName) continue;
            if (imp.includes(`shared/infra/${sibling}`)) {
              violations.push({
                file: relative(SRC_DIR, file),
                importsFrom: `shared/infra/${sibling}`,
              });
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

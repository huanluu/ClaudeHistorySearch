/**
 * Code Quality Invariant Tests
 *
 * CQ-INV-1: Zero `any` Types → eslint.config.js Block 9/9b
 *
 * Tests here cover invariants requiring cross-file structural analysis.
 */
import { readFileSync } from 'fs';
import { relative } from 'path';
import { collectSrcFiles, collectAllTestFiles, SRC_DIR, SERVER_DIR } from './helpers';

describe('Scorecard: Code Quality Invariants', () => {

  // ─── CQ-INV-3: No .js Extensions in Imports ────────────────────
  it('CQ-INV-3: No .js extensions in TypeScript imports', () => {
    const allFiles = [...collectSrcFiles(SRC_DIR), ...collectAllTestFiles()];
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of allFiles) {
      const relFile = relative(SERVER_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (/from\s+['"][^'"]*\.js['"]/.test(line) || /import\(\s*['"][^'"]*\.js['"]/.test(line)) {
          violations.push({
            file: relFile,
            line: i + 1,
            text: line.trim().substring(0, 100),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── CQ-INV-4: No File Over 400 Lines ──────────────────────────
  it.fails('CQ-INV-4: No source file exceeds 400 lines', () => {
    const srcFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; lines: number }> = [];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lineCount = content.split('\n').length;

      if (lineCount > 400) {
        violations.push({ file: relFile, lines: lineCount });
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── CQ-INV-5: No Function Over 80 Lines ───────────────────────
  it.fails('CQ-INV-5: No function or method exceeds 80 lines', () => {
    const srcFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; name: string; lines: number; startLine: number }> = [];

    // Matches function/method declarations and arrow functions
    const funcPattern = /^(\s*)((?:export\s+)?(?:async\s+)?function\s+(\w+))/;
    const methodPattern = /^(\s*)((?:export\s+)?(?:async\s+)?(?!if|else|for|while|switch|catch|try|return|new|throw|typeof|delete|void)(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{)/;
    const arrowPattern = /^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^{]+)?\s*=>\s*\{/;

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const funcMatch = lines[i].match(funcPattern);
        const methodMatch = lines[i].match(methodPattern);
        const arrowMatch = lines[i].match(arrowPattern);
        const match = funcMatch || methodMatch || arrowMatch;
        if (!match) continue;

        const funcName = (funcMatch && funcMatch[3]) || (methodMatch && methodMatch[3]) || (arrowMatch && arrowMatch[2]) || 'anonymous';

        // Count lines until closing brace at same indent level
        let braceDepth = 0;
        let started = false;
        let endLine = i;

        for (let j = i; j < lines.length; j++) {
          const opens = (lines[j].match(/{/g) || []).length;
          const closes = (lines[j].match(/}/g) || []).length;
          braceDepth += opens - closes;

          if (opens > 0) started = true;
          if (started && braceDepth <= 0) {
            endLine = j;
            break;
          }
        }

        const funcLines = endLine - i + 1;
        if (funcLines > 80) {
          violations.push({
            file: relFile,
            name: funcName,
            lines: funcLines,
            startLine: i + 1,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

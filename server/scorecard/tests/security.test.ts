/**
 * Security Invariant Tests
 */
import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { collectSrcFiles, SRC_DIR, ROOT_DIR } from './helpers';

describe('Scorecard: Security Invariants', () => {

  // ─── SEC-INV-1: No Hardcoded Secrets ─────────────────────────────
  it('SEC-INV-1: No hardcoded secrets in source code', () => {
    const srcFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; text: string }> = [];

    const secretPatterns = [
      /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{20,}['"]/i,
      /AKIA[0-9A-Z]{16}/,
      /(?:Bearer|Basic)\s+[A-Za-z0-9+/=]{20,}/,
    ];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('import ')) continue;

        for (const pattern of secretPatterns) {
          if (pattern.test(line)) {
            violations.push({
              file: relFile,
              line: i + 1,
              text: line.trim().substring(0, 100),
            });
          }
        }
      }
    }

    const gitignorePath = join(ROOT_DIR, '.gitignore');
    const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    expect(gitignore).toContain('.env');

    expect(violations).toEqual([]);
  });

  // ─── SEC-INV-2: Array-Based Subprocess Arguments ─────────────────
  it('SEC-INV-2: All spawn() calls use array arguments', () => {
    const srcFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; issue: string }> = [];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (trimmed.startsWith('import ') || trimmed.startsWith('//') ||
            trimmed.startsWith('*') || trimmed.startsWith('export type') ||
            trimmed.startsWith('export interface')) continue;

        if (/\bspawn\s*\(/.test(trimmed)) {
          if (/:\s*typeof\s+spawn/.test(trimmed) || /spawn:\s*\(/.test(trimmed)) continue;
          if (/\bspawn\s*\([^,)]+\+/.test(trimmed)) {
            violations.push({
              file: relFile,
              line: i + 1,
              issue: 'spawn() with string concatenation',
            });
          }
        }

        if (/\bexecSync\s*\(`[^`]*\$\{/.test(trimmed) || /\bexec\s*\(`[^`]*\$\{/.test(trimmed)) {
          if (/\bexecSync\s*\(`[^`]*\$\{(req|request|message|payload|params|query|body|process\.argv)/.test(trimmed)) {
            violations.push({
              file: relFile,
              line: i + 1,
              issue: 'execSync with user-controlled input interpolation',
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── SEC-INV-5: Environment Variable Containment ─────────────────
  it('SEC-INV-5: process.env reads only in allowed files', () => {
    const srcFiles = collectSrcFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; text: string }> = [];

    // Files allowed to read process.env
    const allowedPaths = [
      'app.ts',
      'index.ts',
    ];

    // Allowed path prefixes
    const allowedPrefixes = [
      'shared/provider/',
    ];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);

      // Check if file is in allowed list
      if (allowedPaths.includes(relFile)) continue;
      if (allowedPrefixes.some(prefix => relFile.startsWith(prefix))) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

        if (/process\.env\./.test(line) || /process\.env\[/.test(line)) {
          violations.push({
            file: relFile,
            line: i + 1,
            text: trimmed.substring(0, 100),
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

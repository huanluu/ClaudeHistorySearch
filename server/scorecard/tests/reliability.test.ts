/**
 * Reliability Invariant Tests
 */
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { collectSrcFiles, SRC_DIR } from './helpers';

describe('Scorecard: Reliability Invariants', () => {

  // ─── REL-INV-2: Spawned Processes Tracked and Cleaned ──────────
  it.fails('REL-INV-2: All spawn() calls are tracked and cleaned on shutdown', () => {
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

        // Check: spawn() calls must be assigned to a tracked variable
        if (/\bspawn\s*\(/.test(trimmed)) {
          if (/:\s*typeof\s+spawn/.test(trimmed) || /spawn:\s*\(/.test(trimmed)) continue;
          if (/function\s+spawn/.test(trimmed) || /return\s+spawn/.test(trimmed)) continue;

          const isAssigned = /(?:const|let|var)\s+\w+\s*=\s*.*spawn\s*\(/.test(trimmed) ||
                             /(?:this\.)?\w+\s*=\s*.*spawn\s*\(/.test(trimmed) ||
                             /return\s+.*spawn\s*\(/.test(trimmed);
          if (!isAssigned) {
            violations.push({ file: relFile, line: i + 1, issue: 'spawn() not assigned to a variable' });
          }
        }

        // Check: .unref() detaches from tracking
        if (/\.unref\s*\(\s*\)/.test(trimmed)) {
          violations.push({ file: relFile, line: i + 1, issue: 'child.unref() detaches process from tracking' });
        }

        // Check: detached: true creates orphan-capable process
        if (/detached\s*:\s*true/.test(trimmed)) {
          violations.push({ file: relFile, line: i + 1, issue: 'detached: true creates orphan-capable process' });
        }
      }
    }

    // Verify app.stop() exists for cleanup
    const appContent = readFileSync(join(SRC_DIR, 'app.ts'), 'utf-8');
    expect(appContent).toMatch(/stop\s*\(/);

    expect(violations).toEqual([]);
  });
});

/**
 * Scorecard Structural Invariant Tests
 *
 * This file contains invariants that require structural analysis (AST-like
 * checks, file existence, cross-file patterns) which ESLint rules can't
 * express. Pattern-based invariants are enforced by ESLint instead — see
 * eslint.config.js for those.
 *
 * Naming convention: 'SECTION-INV-N: Description'
 *
 * Tests marked with `it.fails()` represent known violations — they currently
 * fail the invariant but are tracked. When someone fixes the underlying issue,
 * Vitest will report "this test was expected to fail but passed" and the developer
 * removes `.failing`, permanently enforcing the invariant.
 *
 * ─── Invariants enforced by ESLint (not duplicated here) ──────────────
 *
 *   ARCH-INV-1  Layer Import Direction         → eslint.config.js Blocks 3–7
 *   CQ-INV-1    Zero `any` in Source Code      → eslint.config.js Block 8
 *   TEST-INV-1  No Type Escape Hatches         → eslint.config.js Block 9
 *   TEST-INV-3  Tests Use Public API Only      → eslint.config.js Block 1
 *   OBS-INV-1   No Console in Source Code      → eslint.config.js Block 10
 *
 * Cross-reference: Each test has a comment linking back to SCORECARD.md.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');
const TESTS_DIR = join(__dirname);
const SERVER_DIR = join(__dirname, '..');
const ROOT_DIR = join(__dirname, '..', '..');

// ─── Shared Utilities ────────────────────────────────────────────────

/**
 * Recursively collect all .ts files in a directory.
 */
function collectTsFiles(dir: string): string[] {
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

// ═══════════════════════════════════════════════════════════════════════
// ARCHITECTURE INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Architecture Invariants', () => {

  // ARCH-INV-1: Layer Import Direction → enforced by eslint.config.js Blocks 3–7

  // ─── ARCH-INV-2: Barrel Encapsulation ────────────────────────────
  // Scorecard ARCH-INV-2: Barrel Encapsulation
  // See: scorecard/SCORECARD.md § Architecture > Invariants > ARCH-INV-2
  describe('ARCH-INV-2: Barrel Encapsulation', () => {
    const modules = ['shared/provider', 'shared/infra/database', 'shared/infra/runtime', 'gateway', 'features/search', 'features/live', 'features/scheduler', 'features/admin'];

    for (const mod of modules) {
      it(`${mod}/ has an index.ts barrel file`, () => {
        const indexPath = join(SRC_DIR, mod, 'index.ts');
        expect(() => statSync(indexPath)).not.toThrow();
      });
    }
  });

  // ─── ARCH-INV-3: No Circular Dependencies ───────────────────────
  // Scorecard ARCH-INV-3: No Circular Dependencies
  // See: scorecard/SCORECARD.md § Architecture > Invariants > ARCH-INV-3
  it('ARCH-INV-3: No Circular Dependencies', () => {
    // Build import graph from all source files
    const allFiles = collectTsFiles(SRC_DIR);
    const graph = new Map<string, string[]>();

    for (const file of allFiles) {
      const relFile = relative(SRC_DIR, file);
      const imports = extractImports(file);
      const resolvedImports: string[] = [];

      for (const imp of imports) {
        // Only consider relative imports (skip node_modules)
        if (!imp.startsWith('.')) continue;
        // Resolve relative to the file's directory
        const fileDir = dirname(file);
        let resolved = join(fileDir, imp);
        // Normalize to relative from SRC_DIR
        resolved = relative(SRC_DIR, resolved);
        // Strip .js extension and handle index
        resolved = resolved.replace(/\.js$/, '');
        resolvedImports.push(resolved);
      }
      graph.set(relFile.replace(/\.ts$/, ''), resolvedImports);
    }

    // DFS cycle detection
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
        // Only follow edges that exist in the graph
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
  // Scorecard ARCH-INV-4: Composition Root Monopoly
  // See: scorecard/SCORECARD.md § Architecture > Invariants > ARCH-INV-4
  it('ARCH-INV-4: Composition Root Monopoly — no cross-module `new` outside app.ts', () => {
    const allFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; match: string }> = [];

    // Modules whose classes are cross-module (exported from barrels)
    const moduleNames = ['shared/provider', 'shared/infra/database', 'shared/infra/runtime', 'gateway', 'features/search', 'features/live', 'features/scheduler', 'features/admin'];

    // Helper to determine which module a file belongs to (2-level paths)
    function getFileModule(relFile: string): string {
      const parts = relFile.split('/');
      if (parts.length >= 2 && (parts[0] === 'shared' || parts[0] === 'features')) {
        return `${parts[0]}/${parts[1]}`;
      }
      return parts[0];
    }

    for (const file of allFiles) {
      const relFile = relative(SRC_DIR, file);
      // app.ts and index.ts are exempt (composition root / entry point)
      if (relFile === 'app.ts' || relFile === 'index.ts') continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      // Determine which module this file belongs to
      const fileModule = getFileModule(relFile);

      // Find all imports from other modules
      const crossModuleClasses = new Set<string>();
      for (const line of lines) {
        const importMatch = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          const importPath = importMatch[2];
          // Check if it's a cross-module import
          for (const mod of moduleNames) {
            if (mod !== fileModule && importPath.includes(`/${mod}/`)) {
              // Extract class names (PascalCase identifiers)
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

      // Check for `new CrossModuleClass(` usage
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

  // ─── ARCH-INV-5: Interface-Typed Module Boundaries ───────────────
  // Scorecard ARCH-INV-5: Interface-Typed Module Boundaries
  // See: scorecard/SCORECARD.md § Architecture > Invariants > ARCH-INV-5
  it.fails('ARCH-INV-5: Interface-Typed Module Boundaries', () => {
    // Check: classes exported from barrels for cross-module use should have
    // a corresponding interface. If a module exports `class Foo`, there should
    // be an `interface Foo` or a corresponding interface type elsewhere in the module.
    const allFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ module: string; className: string }> = [];
    const moduleNames = ['shared/provider', 'shared/infra/database', 'shared/infra/runtime', 'gateway', 'features/search', 'features/live', 'features/scheduler', 'features/admin'];

    for (const mod of moduleNames) {
      const barrelPath = join(SRC_DIR, mod, 'index.ts');
      if (!existsSync(barrelPath)) continue;
      const barrelContent = readFileSync(barrelPath, 'utf-8');

      // Collect all interface names in this module
      const interfaces = new Set<string>();
      const modFiles = collectTsFiles(join(SRC_DIR, mod));
      for (const f of modFiles) {
        const content = readFileSync(f, 'utf-8');
        for (const m of content.matchAll(/(?:export\s+)?interface\s+(\w+)/g)) {
          interfaces.add(m[1]);
        }
      }

      // Find class names exported from barrel (not type-only exports)
      const exportPattern = /export\s+\{([^}]+)\}/g;
      let match;
      while ((match = exportPattern.exec(barrelContent)) !== null) {
        // Skip `export type { ... }` blocks
        if (/export\s+type\s+\{/.test(match[0])) continue;

        const names = match[1].split(',')
          .map(n => n.trim())
          .filter(n => !n.startsWith('type '));

        for (const name of names) {
          const cleanName = name.split(/\s+as\s+/).pop()!.trim();
          // Check if this is a class (PascalCase, not a function/constant)
          // Verify it's actually a class in the source
          let isClass = false;
          for (const f of modFiles) {
            const content = readFileSync(f, 'utf-8');
            if (new RegExp(`export\\s+class\\s+${cleanName}\\b`).test(content)) {
              isClass = true;
              break;
            }
          }

          if (isClass) {
            // Check if there's a corresponding interface
            // Common patterns: IFoo, FooInterface, or same-name interface
            const hasInterface = interfaces.has(cleanName) ||
              interfaces.has(`I${cleanName}`) ||
              interfaces.has(`${cleanName}Interface`);
            if (!hasInterface) {
              violations.push({ module: mod, className: cleanName });
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── ARCH-INV-6: Test Existence Floor ────────────────────────────
  // Scorecard ARCH-INV-6: Test Existence Floor
  // See: scorecard/SCORECARD.md § Architecture > Invariants > ARCH-INV-6
  it.fails('ARCH-INV-6: Test Existence Floor — every source module has a test', () => {
    const srcFiles = collectTsFiles(SRC_DIR);
    const testFiles = collectTsFiles(TESTS_DIR).map(f => basename(f));
    const missingTests: string[] = [];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const base = basename(file, '.ts');

      // Skip barrel files, the entry point, and app.ts (composition root)
      if (base === 'index' || relFile === 'index.ts' || relFile === 'app.ts') continue;

      // Skip type-only files (interfaces, types)
      const content = readFileSync(file, 'utf-8');
      const hasExportedLogic = /export\s+(function|class|const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^;]*=>))/m.test(content);
      if (!hasExportedLogic) continue;

      // Check for a corresponding test file
      const expectedTestNames = [
        `${base}.test.ts`,
        `${base.charAt(0).toLowerCase()}${base.slice(1)}.test.ts`,
      ];

      // Also check for camelCase variants
      const camelBase = base.charAt(0).toLowerCase() + base.slice(1);
      expectedTestNames.push(`${camelBase}.test.ts`);

      const hasTest = expectedTestNames.some(name => testFiles.includes(name));
      if (!hasTest) {
        missingTests.push(relFile);
      }
    }

    expect(missingTests).toEqual([]);
  });

  // ─── ARCH-INV-7: No Exported Singleton Instances ────────────────
  // Prevents re-introduction of module-level singletons like:
  //   export const db = new Database(...)
  //   export const logger = createLogger(...)
  // These bypass the composition root and create hidden, shared mutable state.
  it('ARCH-INV-7: No Exported Singleton Instances', () => {
    const allFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; match: string }> = [];

    // Pattern: `export const <name> = new <Class>(`
    const singletonPattern = /^export\s+const\s+\w+\s*=\s*new\s+\w+\(/;

    for (const file of allFiles) {
      const relFile = relative(SRC_DIR, file);
      // app.ts and index.ts are exempt (composition root / entry point)
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

  // ─── ARCH-INV-8: Domain Types File Contains Only Types ────────────
  // shared/provider/types.ts must only contain interfaces and type aliases,
  // never variables, functions, or classes. This is enforced here rather than
  // ESLint to avoid no-restricted-syntax rule conflicts.
  it('ARCH-INV-8: types.ts exports only types', () => {
    const typesPath = join(SRC_DIR, 'shared/provider/types.ts');
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).not.toMatch(/^export (const|let|var|function|class|default) /m);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TESTABILITY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Testability Invariants', () => {

  // TEST-INV-1: No Type Escape Hatches → enforced by eslint.config.js Block 9
  // TEST-INV-3: Tests Use Public API Only → enforced by eslint.config.js Block 1

  // ─── TEST-INV-2: No Global State Leaks Between Tests ────────────
  // Scorecard TEST-INV-2: No Global State Leaks Between Tests
  // See: scorecard/SCORECARD.md § Testability > Invariants > TEST-INV-2
  it.fails('TEST-INV-2: No module-scope process.env mutations in tests', () => {
    const testFiles = collectTsFiles(TESTS_DIR);
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of testFiles) {
      const relFile = relative(SERVER_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Track if we're inside describe/it/beforeAll/beforeEach/afterAll/afterEach
      let insideBlock = false;
      let braceDepth = 0;
      let blockStartDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // Detect start of test blocks
        if (/^(describe|it|test|beforeAll|beforeEach|afterAll|afterEach)\s*\(/.test(trimmed)) {
          if (!insideBlock) {
            insideBlock = true;
            blockStartDepth = braceDepth;
          }
        }

        const opens = (lines[i].match(/{/g) || []).length;
        const closes = (lines[i].match(/}/g) || []).length;
        braceDepth += opens - closes;

        // If we're at module scope (before any describe block) and find process.env assignment
        if (!insideBlock && /process\.env\.\w+\s*=/.test(lines[i])) {
          violations.push({
            file: relFile,
            line: i + 1,
            text: trimmed,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// OBSERVABILITY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Observability Invariants', () => {

  // OBS-INV-1: No Console in Source Code → enforced by eslint.config.js Block 10

  // ─── OBS-INV-2: All Error Paths Log Context ───────────────────────
  // Scorecard OBS-INV-2: All Error Paths Log Context
  // See: scorecard/SCORECARD.md § Observability > Invariants > OBS-INV-2
  it.fails('OBS-INV-2: Every catch block logs or rethrows', () => {
    const srcFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!/^}\s*catch\s*(\(|{)/.test(trimmed) && !/catch\s*(\(|{)/.test(trimmed)) continue;
        if (!/catch/.test(trimmed)) continue;

        // Look ahead in the catch block body (up to 15 lines or closing brace)
        let braceDepth = 0;
        let hasLoggingOrRethrow = false;
        let hasDocumentedSuppression = false;

        for (let j = i; j < Math.min(lines.length, i + 20); j++) {
          const bodyLine = lines[j];
          braceDepth += (bodyLine.match(/{/g) || []).length;
          braceDepth -= (bodyLine.match(/}/g) || []).length;

          if (/logger\.(error|warn|info|debug)\s*\(/.test(bodyLine)) hasLoggingOrRethrow = true;
          if (/\bthrow\b/.test(bodyLine)) hasLoggingOrRethrow = true;
          if (/\/[/*].*\b(ignore|best-effort|intentional|expected|swallow)\b/i.test(bodyLine)) hasDocumentedSuppression = true;

          if (braceDepth <= 0 && j > i) break;
        }

        if (!hasLoggingOrRethrow && !hasDocumentedSuppression) {
          violations.push({ file: relFile, line: i + 1, text: trimmed });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── OBS-INV-3: Health Endpoint Reflects All Subsystems ──────────
  // Scorecard OBS-INV-3: Health Endpoint Reflects All Subsystems
  // See: scorecard/SCORECARD.md § Observability > Invariants > OBS-INV-3
  it('OBS-INV-3: Health reflects all subsystems wired in app.ts', () => {
    const appContent = readFileSync(join(SRC_DIR, 'app.ts'), 'utf-8');

    // Services created in app.ts that should be monitored
    const servicePatterns = [
      { name: 'fileWatcher', pattern: /new FileWatcher\(/ },
      { name: 'heartbeatService', pattern: /new HeartbeatService\(/ },
      { name: 'wsTransport', pattern: /new WebSocketTransport\(/ },
      { name: 'sessionRepo', pattern: /createSessionRepository\(/ },
    ];

    const services = servicePatterns
      .filter(s => s.pattern.test(appContent))
      .map(s => s.name);

    // Check DiagnosticsService sources include all services
    const diagSourcesMatch = appContent.match(/new DiagnosticsService\(\{([^}]+)\}\)/s);
    const diagSources = diagSourcesMatch ? diagSourcesMatch[1] : '';

    const missingFromDiag: string[] = [];
    for (const svc of services) {
      // Check if the service is passed to DiagnosticsService or has a getter in the config
      if (!diagSources.includes(svc) && !diagSources.includes(`get${svc.charAt(0).toUpperCase()}${svc.slice(1)}`)) {
        // Also check for proxy getters like getActiveSessionCount, getWsClientCount
        const hasGetter = diagSources.includes(`getActiveSessionCount`) && svc === 'wsTransport' ||
                          diagSources.includes(`getWsClientCount`) && svc === 'wsTransport';
        if (!hasGetter) {
          missingFromDiag.push(svc);
        }
      }
    }

    // Also check for hardcoded placeholder values
    const hasHardcodedZero = /getActiveSessionCount:\s*\(\)\s*=>\s*0/.test(appContent);
    if (hasHardcodedZero) {
      missingFromDiag.push('activeSessionCount (hardcoded to 0)');
    }

    expect(missingFromDiag).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECURITY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Security Invariants', () => {

  // ─── SEC-INV-1: No Hardcoded Secrets ─────────────────────────────
  // Scorecard SEC-INV-1: No Hardcoded Secrets
  // See: scorecard/SCORECARD.md § Security > Invariants > SEC-INV-1
  it('SEC-INV-1: No hardcoded secrets in source code', () => {
    const srcFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; text: string }> = [];

    // Patterns that indicate hardcoded secrets
    const secretPatterns = [
      // API keys (sk-xxx, key-xxx, or long hex strings assigned to key/token/secret vars)
      /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{20,}['"]/i,
      // AWS keys
      /AKIA[0-9A-Z]{16}/,
      // Generic long secrets in string assignments
      /(?:Bearer|Basic)\s+[A-Za-z0-9+/=]{20,}/,
    ];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments and imports
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

    // Also verify .gitignore covers sensitive files
    const gitignorePath = join(ROOT_DIR, '.gitignore');
    const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    expect(gitignore).toContain('.env');

    expect(violations).toEqual([]);
  });

  // ─── SEC-INV-2: Array-Based Subprocess Arguments ─────────────────
  // Scorecard SEC-INV-2: Array-Based Subprocess Arguments
  // See: scorecard/SCORECARD.md § Security > Invariants > SEC-INV-2
  it('SEC-INV-2: All spawn() calls use array arguments', () => {
    const srcFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; issue: string }> = [];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip imports, comments, and type definitions
        if (trimmed.startsWith('import ') || trimmed.startsWith('//') ||
            trimmed.startsWith('*') || trimmed.startsWith('export type') ||
            trimmed.startsWith('export interface')) continue;

        // Check spawn() calls have array as second argument
        // spawn('cmd', [...]) is safe; spawn('cmd ' + arg) is not
        if (/\bspawn\s*\(/.test(trimmed)) {
          // Verify it's not just a type definition
          if (!/:\s*typeof\s+spawn/.test(trimmed) && !/spawn:\s*\(/.test(trimmed)) {
            // The second arg should be an array literal or variable
            // This is a heuristic: if spawn is followed by string concatenation, it's bad
            if (/\bspawn\s*\([^,)]+\+/.test(trimmed)) {
              violations.push({
                file: relFile,
                line: i + 1,
                issue: 'spawn() with string concatenation',
              });
            }
          }
        }

        // Check exec/execSync calls don't interpolate user input
        // execSync with template literals containing variables from user input is unsafe
        if (/\bexecSync\s*\(`[^`]*\$\{/.test(trimmed) || /\bexec\s*\(`[^`]*\$\{/.test(trimmed)) {
          // Allow if the interpolated value is clearly not user input
          // (e.g., hardcoded system commands)
          if (!/\bexecSync\s*\(`[^`]*\$\{process\.argv/.test(trimmed) &&
              !/\bexecSync\s*\(`[^`]*\$\{(req|request|message|payload|params|query|body)/.test(trimmed)) {
            // Likely safe — hardcoded string interpolation
          } else {
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

  // ─── SEC-INV-3: Auth on All Non-Public Endpoints ──────────────────
  // Scorecard SEC-INV-3: Auth on All Non-Public Endpoints
  // See: scorecard/SCORECARD.md § Security > Invariants > SEC-INV-3
  it('SEC-INV-3: All non-public routes are behind auth middleware', () => {
    // Auth middleware is applied globally in app.ts via transport.use(authMiddleware).
    // Public endpoints must be declared in an explicit allowlist checked by the middleware.
    const middlewarePath = join(SRC_DIR, 'shared', 'provider', 'auth', 'middleware.ts');
    const middlewareContent = readFileSync(middlewarePath, 'utf-8');

    // The middleware should define a public paths allowlist
    const hasPublicPaths = /public.*path|skip.*auth|exempt|allowlist/i.test(middlewareContent);

    // route files should NOT have their own conditional auth checks (auth should be global)
    const routeFiles = [
      join(SRC_DIR, 'features', 'search', 'routes.ts'),
      join(SRC_DIR, 'features', 'scheduler', 'routes.ts'),
      join(SRC_DIR, 'features', 'admin', 'routes.ts'),
    ];
    const routesContent = routeFiles.map(f => existsSync(f) ? readFileSync(f, 'utf-8') : '').join('\n');
    const perRouteAuthChecks = routesContent.match(/if\s*\(.*auth.*\)/gi) || [];

    // Expect: centralized public paths list exists, no per-route auth checks
    expect(hasPublicPaths).toBe(true);
    expect(perRouteAuthChecks).toEqual([]);
  });

  // ─── SEC-INV-4: Path Traversal Protection ─────────────────────────
  // Scorecard SEC-INV-4: Path Traversal Protection
  // See: scorecard/SCORECARD.md § Security > Invariants > SEC-INV-4
  it.fails('SEC-INV-4: User-supplied paths validated before filesystem use', () => {
    // Files that handle user input and may touch the filesystem
    const handlerFiles = [
      join(SRC_DIR, 'features', 'search', 'routes.ts'),
      join(SRC_DIR, 'features', 'scheduler', 'routes.ts'),
      join(SRC_DIR, 'features', 'admin', 'routes.ts'),
      join(SRC_DIR, 'features', 'live', 'WebSocketTransport.ts'),
    ];

    const violations: Array<{ file: string; line: number; issue: string }> = [];

    for (const file of handlerFiles) {
      if (!existsSync(file)) continue;
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Check if the file imports WorkingDirValidator
      const hasValidator = /WorkingDirValidator/.test(content);

      // Find lines where req.params or req.query values flow into path operations
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect user-controlled path variables (e.g., workingDir from WS messages)
        if (/\b(workingDir|cwd|directory|path)\b.*=.*\b(req\.|message\.|payload\.)/.test(line)) {
          // Check if validation happens within 10 lines
          const context = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
          if (!/validat|WorkingDirValidator|sanitize|allowedDir/i.test(context)) {
            violations.push({ file: relFile, line: i + 1, issue: 'user path not validated' });
          }
        }
      }

      // If the file handles paths but doesn't import a validator, that's suspicious
      if (/workingDir|cwd/.test(content) && !hasValidator) {
        violations.push({ file: relFile, line: 0, issue: 'handles paths but no WorkingDirValidator import' });
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PRIVACY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Privacy Invariants', () => {

  // ─── PRIV-INV-3: Session Data Requires Authentication ─────────────
  // Scorecard PRIV-INV-3: Session Data Requires Authentication
  // See: scorecard/SCORECARD.md § Privacy > Invariants > PRIV-INV-3
  it('PRIV-INV-3: Session endpoints are behind auth middleware', () => {
    // Auth is applied globally in app.ts, but we verify that session-data
    // endpoints aren't in any bypass/skip list
    const appContent = readFileSync(join(SRC_DIR, 'app.ts'), 'utf-8');

    // Verify auth middleware is wired
    expect(appContent).toMatch(/authMiddleware/);

    // Session-serving endpoints that MUST require auth
    const sessionEndpoints = ['/sessions', '/search'];
    const middlewarePath = join(SRC_DIR, 'shared', 'provider', 'auth', 'middleware.ts');
    const middlewareContent = readFileSync(middlewarePath, 'utf-8');

    // These endpoints must NOT appear in any skip/public path list
    const violations: string[] = [];
    for (const endpoint of sessionEndpoints) {
      // Check if it's in a public/skip list (various patterns)
      if (new RegExp(`['"\`]${endpoint.replace('/', '\\/')}['"\`].*(?:public|skip|exempt|bypass)`, 'i').test(middlewareContent) ||
          new RegExp(`(?:public|skip|exempt|bypass).*['"\`]${endpoint.replace('/', '\\/')}['"\`]`, 'i').test(middlewareContent)) {
        violations.push(`${endpoint} appears in auth bypass list`);
      }
    }

    // Also check: when auth is enabled (hasApiKey returns true), the middleware
    // must actually block unauthenticated requests (not just log)
    expect(middlewareContent).toMatch(/401|Unauthorized|forbidden/i);

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PERFORMANCE INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Performance Invariants', () => {

  // ─── PERF-INV-1: No Synchronous I/O in Request Handlers ─────────
  // Scorecard PERF-INV-1: No Synchronous I/O in Request Handlers
  // See: scorecard/SCORECARD.md § Performance > Invariants > PERF-INV-1
  it('PERF-INV-1: No sync I/O in request handlers', () => {
    // Check route files and WebSocketTransport.ts handler functions for sync I/O
    const handlerFiles = [
      join(SRC_DIR, 'features', 'search', 'routes.ts'),
      join(SRC_DIR, 'features', 'scheduler', 'routes.ts'),
      join(SRC_DIR, 'features', 'admin', 'routes.ts'),
      join(SRC_DIR, 'features', 'live', 'WebSocketTransport.ts'),
    ];

    const syncPatterns = [
      /readFileSync\(/,
      /writeFileSync\(/,
      /appendFileSync\(/,
      /existsSync\(/,
      /statSync\(/,
      /readdirSync\(/,
      /execSync\(/,
    ];

    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of handlerFiles) {
      if (!existsSync(file)) continue;
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Track whether we're inside a request handler
      // Heuristic: lines after `router.get/post/...` or inside handler functions
      let inHandler = false;
      let handlerBraceDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Detect handler start (Express routes or WS message handlers)
        if (/router\.(get|post|put|delete|patch)\s*\(/.test(trimmed) ||
            /\.on\s*\(\s*['"]message['"]/.test(trimmed) ||
            /onMessage\s*[:=]/.test(trimmed)) {
          inHandler = true;
          handlerBraceDepth = 0;
        }

        if (inHandler) {
          const opens = (line.match(/{/g) || []).length;
          const closes = (line.match(/}/g) || []).length;
          handlerBraceDepth += opens - closes;

          for (const pattern of syncPatterns) {
            if (pattern.test(trimmed)) {
              // Allow module-level readFileSync for static content loading
              // Check if this is inside a function/handler, not at top level
              violations.push({
                file: relFile,
                line: i + 1,
                text: trimmed.substring(0, 100),
              });
            }
          }

          if (handlerBraceDepth <= 0) {
            inHandler = false;
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── PERF-INV-2: Database Queries Use Indexes ──────────────────────
  // Scorecard PERF-INV-2: Database Queries Use Indexes
  // See: scorecard/SCORECARD.md § Performance > Invariants > PERF-INV-2
  it('PERF-INV-2: No unindexed queries — all SELECT use indexed columns or FTS', () => {
    const dbFiles = collectTsFiles(join(SRC_DIR, 'shared', 'database'));
    const violations: Array<{ file: string; line: number; query: string }> = [];

    // Patterns for queries that should use indexes
    const dangerousPatterns = [
      // LIKE without FTS (full table scans)
      /LIKE\s+[^%].*%/i,
      // SELECT * without WHERE or LIMIT on main tables
      /SELECT\s+\*\s+FROM\s+(?:sessions|messages)\s*$/im,
    ];

    // Acceptable patterns (FTS, prepared with params, have WHERE or LIMIT)
    const safePatterns = [
      /messages_fts/,
      /WHERE/i,
      /LIMIT/i,
      /ORDER BY.*(?:last_active|timestamp|rank)/i,
    ];

    for (const file of dbFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/SELECT/i.test(line)) continue;

        // Gather the full query (may span multiple lines)
        let query = '';
        for (let j = i; j < Math.min(lines.length, i + 10); j++) {
          query += lines[j] + ' ';
          if (/[`'"];/.test(lines[j]) || /\)\s*[,;]/.test(lines[j])) break;
        }

        for (const pattern of dangerousPatterns) {
          if (pattern.test(query)) {
            // Check if any safe pattern also matches
            const isSafe = safePatterns.some(sp => sp.test(query));
            if (!isSafe) {
              violations.push({
                file: relFile,
                line: i + 1,
                query: query.trim().substring(0, 120),
              });
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── PERF-INV-3: No Unbounded In-Memory Collections ─────────────
  // Scorecard PERF-INV-3: No Unbounded In-Memory Collections
  // See: scorecard/SCORECARD.md § Performance > Invariants > PERF-INV-3
  it.fails('PERF-INV-3: No unbounded in-memory collections', () => {
    // Check long-lived Map/Set fields in classes for capacity limits
    const srcFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; className: string; field: string }> = [];

    // Known bounded collections (already have capacity limits)
    const knownBounded = new Set([
      'ErrorRingBuffer',  // Has explicit capacity in constructor
    ]);

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');

      // Find classes with Map or Set fields
      const classMatch = content.match(/class\s+(\w+)/g);
      if (!classMatch) continue;

      for (const cls of classMatch) {
        const className = cls.replace('class ', '');
        if (knownBounded.has(className)) continue;

        // Look for Map/Set/Array fields
        const fieldPatterns = [
          /private\s+\w+\s*[:=]\s*new\s+(Map|Set)\b/,
          /private\s+\w+\s*:\s*(Map|Set)<[^>]+>\s*=\s*new\s+(Map|Set)/,
          /\w+\s*=\s*new\s+Map\b/,
          /\w+\s*=\s*new\s+Set\b/,
        ];

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          for (const pattern of fieldPatterns) {
            if (pattern.test(lines[i])) {
              // Check if there's a capacity limit nearby (within 50 lines)
              const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 50)).join('\n');
              const hasLimit = /capacity|limit|max|\.delete\(|\.clear\(|splice\(/i.test(context) &&
                               /if\s*\(.*\.(size|length)\s*[>>=]/.test(context);

              if (!hasLimit) {
                const fieldMatch = lines[i].match(/(?:private\s+)?(\w+)\s*[:=]/);
                if (fieldMatch) {
                  violations.push({
                    file: relFile,
                    className,
                    field: fieldMatch[1],
                  });
                }
              }
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RELIABILITY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Reliability Invariants', () => {

  // ─── REL-INV-1: No Unhandled Promise Rejections ──────────────────
  // Scorecard REL-INV-1: No Unhandled Promise Rejections
  // See: scorecard/SCORECARD.md § Reliability > Invariants > REL-INV-1
  it('REL-INV-1: Unhandled rejection handler exists in index.ts', () => {
    const indexContent = readFileSync(join(SRC_DIR, 'index.ts'), 'utf-8');
    expect(indexContent).toMatch(/process\.on\s*\(\s*['"]unhandledRejection['"]/);
  });

  // ─── REL-INV-2: Spawned Processes Tracked and Cleaned ──────────
  // Scorecard REL-INV-2: Spawned Processes Tracked and Cleaned
  // See: scorecard/SCORECARD.md § Reliability > Invariants > REL-INV-2
  it.fails('REL-INV-2: All spawn() calls are tracked and cleaned on shutdown', () => {
    const srcFiles = collectTsFiles(SRC_DIR);
    const violations: Array<{ file: string; line: number; issue: string }> = [];

    for (const file of srcFiles) {
      const relFile = relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // Skip imports, comments, type definitions
        if (trimmed.startsWith('import ') || trimmed.startsWith('//') ||
            trimmed.startsWith('*') || trimmed.startsWith('export type') ||
            trimmed.startsWith('export interface')) continue;

        // Check 1: spawn() calls must be assigned to a tracked variable
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

        // Check 2: .unref() on child processes detaches them from tracking —
        // an unref'd child can outlive the server, becoming an orphan process
        if (/\.unref\s*\(\s*\)/.test(trimmed)) {
          violations.push({ file: relFile, line: i + 1, issue: 'child.unref() detaches process from tracking' });
        }

        // Check 3: detached: true creates a process that survives parent death
        if (/detached\s*:\s*true/.test(trimmed)) {
          violations.push({ file: relFile, line: i + 1, issue: 'detached: true creates orphan-capable process' });
        }
      }
    }

    // Also check that app.stop() exists and handles cleanup
    const appContent = readFileSync(join(SRC_DIR, 'app.ts'), 'utf-8');
    expect(appContent).toMatch(/stop\s*\(/);

    expect(violations).toEqual([]);
  });

  // ─── REL-INV-3: Signal Handlers Trigger Graceful Shutdown ────────
  // Scorecard REL-INV-3: Signal Handlers Trigger Graceful Shutdown
  // See: scorecard/SCORECARD.md § Reliability > Invariants > REL-INV-3
  it('REL-INV-3: SIGINT and SIGTERM handlers registered in index.ts', () => {
    const indexContent = readFileSync(join(SRC_DIR, 'index.ts'), 'utf-8');
    expect(indexContent).toMatch(/process\.on\s*\(\s*['"]SIGINT['"]/);
    expect(indexContent).toMatch(/process\.on\s*\(\s*['"]SIGTERM['"]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// OPERABILITY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Operability Invariants', () => {

  // ─── OPS-INV-1: Server Auto-Restarts on Crash ───────────────────
  // Scorecard OPS-INV-1: Server Auto-Restarts on Crash
  // See: scorecard/SCORECARD.md § Operability > Invariants > OPS-INV-1
  it('OPS-INV-1: launchd plist has KeepAlive.SuccessfulExit: false', () => {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.claude-history-server.plist');

    // Test that the plist file exists
    expect(existsSync(plistPath)).toBe(true);

    const content = readFileSync(plistPath, 'utf-8');

    // Verify KeepAlive section with SuccessfulExit: false
    // In Apple plist XML, this looks like:
    // <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/>
    expect(content).toContain('<key>KeepAlive</key>');
    expect(content).toContain('<key>SuccessfulExit</key>');
    expect(content).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
  });

  // ─── OPS-INV-2: Log Rotation Prevents Unbounded Growth ──────────
  // Scorecard OPS-INV-2: Log Rotation Prevents Unbounded Growth
  // See: scorecard/SCORECARD.md § Operability > Invariants > OPS-INV-2
  it('OPS-INV-2: Logger implements log rotation', () => {
    const loggerPath = join(SRC_DIR, 'shared', 'provider', 'logger', 'logger.ts');
    const content = readFileSync(loggerPath, 'utf-8');

    // Verify rotation logic exists
    expect(content).toMatch(/MAX_LOG_SIZE/);
    expect(content).toMatch(/renameSync\(/);
    expect(content).toMatch(/statSync\(/);
    // The pattern: check file size → rename if too big
    expect(content).toMatch(/stat\.size\s*>\s*MAX_LOG_SIZE/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CODE QUALITY INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Code Quality Invariants', () => {

  // CQ-INV-1: Zero `any` in Source Code → enforced by eslint.config.js Block 8

  // ─── CQ-INV-2: No Dead Public Exports ───────────────────────────
  // Scorecard CQ-INV-2: No Dead Public Exports
  // See: scorecard/SCORECARD.md § Code Quality > Invariants > CQ-INV-2
  it.fails('CQ-INV-2: No dead barrel exports — every export has a consumer', () => {
    const modules = ['shared/provider', 'shared/infra/database', 'shared/infra/runtime', 'gateway', 'features/search', 'features/live', 'features/scheduler', 'features/admin'];
    const deadExports: Array<{ module: string; exportName: string }> = [];

    // Collect all consumer files grouped by module
    const allSrcFiles = collectTsFiles(SRC_DIR);
    const allTestFiles = collectTsFiles(TESTS_DIR);

    for (const mod of modules) {
      const barrelPath = join(SRC_DIR, mod, 'index.ts');
      if (!existsSync(barrelPath)) continue;

      const barrelContent = readFileSync(barrelPath, 'utf-8');
      const modDir = join(SRC_DIR, mod);

      // Build consumer content: all files OUTSIDE this module + test files
      // (internal module files don't count as barrel consumers)
      const consumerContent = [...allSrcFiles, ...allTestFiles]
        .filter(f => {
          const rel = relative(SRC_DIR, f);
          // Exclude files inside this module (they use internal imports)
          if (f.startsWith(modDir + '/')) return false;
          // Exclude barrel files
          if (basename(f) === 'index.ts' && dirname(f).startsWith(SRC_DIR)) return false;
          return true;
        })
        .map(f => readFileSync(f, 'utf-8'))
        .join('\n');

      // Extract exported names from barrel
      const reExportPattern = /export\s+\{([^}]+)\}/g;
      let match;
      while ((match = reExportPattern.exec(barrelContent)) !== null) {
        // Skip `export type { ... }` blocks entirely
        if (/export\s+type\s+\{/.test(match[0])) continue;

        const names = match[1].split(',')
          .map(n => n.trim())
          .filter(n => n && !n.startsWith('type '));

        for (const name of names) {
          const cleanName = name.split(/\s+as\s+/).pop()!.trim();

          // Check if this name appears in any consumer file's import statements
          // Use word boundary to avoid false positives
          const importPattern = new RegExp(`\\b${cleanName}\\b`);
          if (!importPattern.test(consumerContent)) {
            deadExports.push({ module: mod, exportName: cleanName });
          }
        }
      }

      // Also check `export function` and `export const` directly in barrels
      const directExportPattern = /export\s+(?:function|const)\s+(\w+)/g;
      let directMatch;
      while ((directMatch = directExportPattern.exec(barrelContent)) !== null) {
        const name = directMatch[1];
        const importPattern = new RegExp(`\\b${name}\\b`);
        if (!importPattern.test(consumerContent)) {
          deadExports.push({ module: mod, exportName: name });
        }
      }
    }

    expect(deadExports).toEqual([]);
  });

  // ─── CQ-INV-3: No .js Extensions in Imports ────────────────────────
  // Scorecard CQ-INV-3: No .js Extensions in Imports
  // See: scorecard/SCORECARD.md § Code Quality > Invariants > CQ-INV-3
  it('CQ-INV-3: No .js extensions in TypeScript imports', () => {
    const allFiles = [...collectTsFiles(SRC_DIR), ...collectTsFiles(TESTS_DIR)];
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of allFiles) {
      const relFile = relative(SERVER_DIR, file);
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Skip comments
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
});

// ═══════════════════════════════════════════════════════════════════════
// AGENT ERGONOMICS INVARIANTS
// ═══════════════════════════════════════════════════════════════════════

describe('Scorecard: Agent Ergonomics Invariants', () => {

  // ─── AE-INV-1: CLAUDE.md as Navigable Map ───────────────────────
  // Scorecard AE-INV-1: CLAUDE.md as Navigable Map
  // See: scorecard/SCORECARD.md § Agent Ergonomics > Invariants > AE-INV-1
  it.fails('AE-INV-1: CLAUDE.md is under 150 lines and links to docs/', () => {
    const claudeMdPath = join(ROOT_DIR, 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);

    const content = readFileSync(claudeMdPath, 'utf-8');
    const lineCount = content.split('\n').length;

    // Must be under 150 lines
    expect(lineCount).toBeLessThanOrEqual(150);

    // Must contain links to docs/ directory
    expect(content).toMatch(/docs\//);
  });

  // ─── AE-INV-2: Adding-Features Guide Exists ─────────────────────
  // Scorecard AE-INV-2: Adding-Features Guide Exists
  // See: scorecard/SCORECARD.md § Agent Ergonomics > Invariants > AE-INV-2
  it.fails('AE-INV-2: docs/adding-features.md exists', () => {
    const guidePaths = [
      join(ROOT_DIR, 'docs', 'adding-features.md'),
      join(SERVER_DIR, 'docs', 'adding-features.md'),
    ];

    const exists = guidePaths.some(p => existsSync(p));
    expect(exists).toBe(true);
  });

  // ─── AE-INV-3: Agent Can Collect Diagnostic Data ────────────────
  // Scorecard AE-INV-3: Agent Can Collect Diagnostic Data
  // See: scorecard/SCORECARD.md § Agent Ergonomics > Invariants > AE-INV-3
  it('AE-INV-3: CLAUDE.md documents diagnostic commands', () => {
    // Check both root and server CLAUDE.md
    const rootClaudeMd = readFileSync(join(ROOT_DIR, 'CLAUDE.md'), 'utf-8');
    const serverClaudeMd = existsSync(join(SERVER_DIR, 'CLAUDE.md'))
      ? readFileSync(join(SERVER_DIR, 'CLAUDE.md'), 'utf-8')
      : '';
    const combined = rootClaudeMd + '\n' + serverClaudeMd;

    // Must document key diagnostic commands
    expect(combined).toMatch(/npm test/);
    expect(combined).toMatch(/health/i);
    expect(combined).toMatch(/claude-history-server\.(log|err)/);
    expect(combined).toMatch(/launchctl/);
  });
});

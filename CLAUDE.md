# CLAUDE.md

> Rules for AI agents working on this codebase. Be literal. Follow numbered steps. When ambiguous, ask.

## Product Vision

### What We're Building

A personal AI work assistant for a solo engineer at Microsoft. The assistant runs locally on a Mac, connects to work systems (Azure DevOps, MS Graph, GitHub), and helps with daily work: triaging bugs, reviewing PRs, preparing for meetings, and prioritizing the day.

This started as a Claude Code session search tool and is evolving into a personal assistant — scoped to one person's work life, not a general-purpose AI gateway. Inspired by NanoClaw's simplicity (small codebase, skills over features) with work-system integrations.

### Constraints

| Constraint | Implication |
|------------|-------------|
| Solo engineer, side project | Keep the codebase small. Prefer skills/config over new code. Question every addition |
| Corporate environment | Be cautious with dependencies — **always flag new npm/Swift packages and ask permission before adding** |
| Available tools | Claude CLI, Copilot CLI, Azure CLI, WorkIQ MCP (ADO + MS Graph access) |
| Primary UI | Mac menu bar app (chat + dashboard). Web UI for admin/config only. iOS app exists but secondary |

### Interaction Model (Target — Not Yet Built)

The Mac menu bar app will be the **only channel** — chat interface and dashboard in one:

| Mode | When | Example | Status |
|------|------|---------|--------|
| **Chat** | Ad-hoc questions and commands | "What's the status on work item 4521?" | Partially exists (live sessions) |
| **Proactive push** | Background agent surfaces something | "PR #89 has new comments" | Not yet built |
| **Structured views** | Scheduled briefings | Morning dashboard: calendar, PRs, priorities | Not yet built |
| **Background agentic** | Long-running tasks | "Investigate this bug" → notifies when done | Partially exists (HeartbeatService) |

### Architecture Direction

- **Simplicity first**: Small codebase, minimal dependencies, workflows defined as config/prompts not code
- **Multi-CLI runtime**: Abstract over Claude CLI and Copilot CLI. Run both for LLM council when needed (Copilot gives access to GPT, Gemini)
- **Workflow system**: Each use case (day briefing, PR review, work item triage) is a workflow with its own prompt template, tool config, and persistent memory
- **What we're NOT building**: Not multi-user. Not a multi-channel gateway. Not a plugin framework

## Project Overview

Personal AI work assistant with local search, live sessions, and autonomous workflows.
- **TypeScript server** (`server/`): Agent orchestration, search indexing (SQLite FTS5), REST API, WebSocket → see `server/CLAUDE.md` for all server conventions
- **Mac app** (`ClaudeHistorySearchMac/`): SwiftUI menu bar app — primary user interface (chat + dashboard)
- **iOS app** (`ClaudeHistorySearch/`): SwiftUI client for iPhone/iPad (secondary, limited by security constraints)
- **Shared package** (`Shared/`): Swift package with shared models, services, and view models

## Engineering Principles

1. **Clarity over cleverness** — Write code that's maintainable, not impressive
2. **Explicit over implicit** — No magic. Dependencies are injected, behavior is obvious
3. **Composition over inheritance** — Small units that combine (this project uses constructor injection throughout)
4. **Fail fast, fail loud** — Surface errors at the source with actionable messages
5. **Delete code** — Less code = fewer bugs. Question every addition
6. **Verify, don't assume** — Run `npm test`, `swift test`, `npm run lint`. Prove it works

## Quick Reference

```bash
# Server — see server/CLAUDE.md for full commands, launchd management, and worktree testing
cd server && npm test              # Vitest tests
cd server && npm run lint          # ESLint with architecture enforcement

# Swift
cd Shared && swift test            # Swift package tests

# iOS/Mac
# Open ClaudeHistorySearch.xcodeproj → scheme ClaudeHistorySearch (iOS) or ClaudeHistorySearchMac (Mac)
```

## Architecture

The server uses a **feature-first** architecture with a shared linear dependency chain, enforced by ESLint. See `server/CLAUDE.md` for full details.

```
shared/provider → shared/database → shared/runtime
         ↓               ↓               ↓
    features/search, features/live, features/scheduler, features/admin
                              ↓
                           app.ts (composition root)
```

Features import from `shared/` but never from each other. Cross-feature wiring happens in `app.ts`.

### Shared Package (`Shared/Sources/ClaudeHistoryShared/`)

| Component | Purpose |
|-----------|---------|
| `Models/` | Shared data models (Session, Message, SearchResult) |
| `Services/` | APIClient, WebSocketClient, ServerDiscovery (injectable URLSession for testing) |
| `ViewModels/` | Session state management for live/historical modes |
| `Views/` | SwiftUI views for session list, detail, and message display |

### Key Details

- Server runs on port **3847**, advertises via Bonjour as `_claudehistory._tcp`
- iOS/Mac apps auto-discover server via Bonjour, cache last-known URL
- Database: `~/.claude-history-server/search.db`
- Session source: `~/.claude/projects/**/*.jsonl`

## Code Conventions

### Swift (Shared + Apps)

- `@MainActor` for UI-binding classes (ViewModels, APIClient)
- Models are `Codable` + `Sendable` for thread-safe async usage
- Constructor injection for testability (e.g., `APIClient(session: URLSession)`)
- One primary type per file, filename matches type name

### Naming (All Languages)

| Type | Convention | Example |
|------|------------|---------|
| Types/Classes | `UpperCamelCase` | `SessionExecutor`, `APIClient` |
| Functions/Variables | `lowerCamelCase` | `fetchSessions()`, `sessionRepo` |
| Constants | `UPPER_SNAKE_CASE` | `PROJECTS_DIR`, `DB_PATH` |
| Test methods (TS) | `descriptive string` | `'returns empty array for no results'` |
| Test methods (Swift) | `test_{unit}_{behavior}` | `testAPIClient_sendsAuthHeader` |

### Functions

- Do one thing — name describes **what**, not how
- Max 3-4 parameters — beyond that, use a config/options object
- Avoid boolean parameters — they obscure intent at call sites

```
// Bad — what do true, false mean?
build(scheme, true, false)

// Good — intent is obvious
build(scheme, configuration: .release, clean: true)
```

### Comments

- Explain **why**, not what. Delete comments that restate code
- TODO format: `// TODO: [context] description`
- No commented-out code in committed files

## Feature Development Workflow

### Before Writing Code

1. **Read existing code first** — Understand what's there before proposing changes
2. **Check if already solved** — Can you extend existing code rather than create new?
3. **Identify failure modes** — Invalid inputs, missing dependencies, network/IO failures, concurrency issues, resource exhaustion
4. **Classify work**:
   - **A. Core flow**: Happy path + direct error cases → implement
   - **B. Edge cases**: Unusual but valid → implement after core is solid
   - **C. Out of scope**: Document as TODO, don't implement

### Implementation Order

1. Write failing test for core happy path
2. Implement minimum code to pass
3. Write failing tests for error cases
4. Implement error handling
5. Refactor if needed (tests stay green)
6. Add edge case tests only after core is solid

### Before Submitting

- [ ] `npm test` passes (server) and `swift test` passes (Shared)
- [ ] `npm run lint` passes — architecture invariants hold
- [ ] No commented-out code, no uncontextualized TODOs
- [ ] Error messages are actionable (include what failed + relevant context)
- [ ] No secrets, credentials, or hardcoded environment-specific values
- [ ] New code follows the layered architecture — imports flow in the correct direction

## Testing Standards

### Principles

- Tests are isolated: no shared state, no execution order dependencies
- One behavior per test — if a test name needs "and", split it
- Test behavior, not implementation — tests should survive refactors
- Fast tests get run; slow tests get skipped

### Before Writing a Test

1. Check if the **behavior** is already tested (not just the code path — multiple tests can cover the same lines testing different behaviors)
2. Reuse existing mocks — create a new mock only if no existing one fits
3. Reuse existing fixtures — create new test data only if existing fixtures don't cover the scenario

### Swift Tests (XCTest)

Tests live in `Shared/Tests/ClaudeHistorySharedTests/`.

- **MockURLProtocol**: Shared mock for URLSession — intercepts network, verifies requests
- **Naming**: `test{Unit}_{condition}_{expected}` (e.g., `testAPIClient_invalidJSON_returnsNil`)
- **Async**: Use `async/await` with XCTest

For server test conventions, see `server/CLAUDE.md`.

### What to Test vs. Skip

| Test | Don't Test |
|------|------------|
| Public interface behavior | Private implementation details |
| Error handling paths | Framework/language behavior |
| State transitions | Trivial getters/setters |
| Business logic | Third-party library internals |

## Error Handling

**Errors are API — design them like success paths.** Error types, messages, and propagation deserve the same care as the happy path. They are a first-class part of the interface.

### Rules

1. Define domain-specific error types per module — not generic strings or raw exceptions
2. Include context: what failed, with what inputs (IDs, paths, values)
3. Map external errors at boundaries — don't leak implementation details through APIs
4. Fail at the source — don't pass invalid state hoping someone handles it later
5. Callers must be able to distinguish error types programmatically — not by parsing message strings

### Error Checklist

- [ ] Message helps diagnose the problem, not just report it
- [ ] Includes relevant context (IDs, paths, values)
- [ ] Caller can distinguish error types programmatically
- [ ] Transient vs permanent failures are distinguishable

## Debugging Process

1. **Reproduce reliably** — Can you trigger it consistently?
2. **Isolate** — What's the smallest input that fails?
3. **Read the actual error** — Full stack trace, full log output
4. **Hypothesis** — One specific guess about the cause
5. **Test it** — Add a failing test, add logging, inspect state
6. **Fix and verify** — Change one thing, confirm it's fixed
7. **Regression test** — Ensure it can't silently break again

**Don't**: Change multiple things at once. Don't assume without evidence. Don't fix symptoms instead of root causes.

## Git Hygiene

- **Solo project — never create pull requests.** Merge worktree branches directly into main
- **Never commit or merge to `main` without the user explicitly asking you to.** This is enforced by a hook — commits on main will be blocked unless the user has instructed you to commit
- One logical change per commit
- Present tense, imperative mood: "Add caching" not "Added caching"
- First line ≤50 chars, blank line, then details if needed
- Feature branches: `feature/{description}`, fix branches: `fix/{description}`
- `main` is always deployable — the launchd agent runs from it

## Code Review Gate — CRITICAL

**EVERY commit MUST go through `/agent-code-review`.** No exceptions, no shortcuts, no "it's just a config change."

A PreToolUse hook (`.claude/hooks/check-code-review.sh`) blocks `git commit` unless staged changes have been reviewed. The hook checks for a `.code-reviewed` marker file containing a shasum of the reviewed diff.

**The ONLY way to create the `.code-reviewed` marker is by running `/agent-code-review`.** This skill:
1. Checks for staged changes
2. Spawns a review subagent to find bugs, security issues, and architecture violations
3. Fixes critical findings automatically
4. Writes the `.code-reviewed` marker with the correct hash

**Rules:**
- **Before EVERY commit**: Run `/agent-code-review`. Period.
- **If the hook blocks your commit**: You forgot to run `/agent-code-review`. Run it now.
- **If you re-stage files after review** (e.g., fixing a critical finding): Run `/agent-code-review` again — the marker hash must match the current staged diff.
- **NEVER manually create the `.code-reviewed` file.** Never `echo hash > .code-reviewed`. Never `shasum > .code-reviewed`. The skill must do it.
- **NEVER skip the hook** with `--no-verify`.

## Worktree Discipline

- Only edit files in the worktree branch, never in main directly — avoids merge conflicts
- Never regenerate API keys or do other destructive actions during testing without asking
- For testing the server from a worktree, see `server/CLAUDE.md`

## Refactoring Rules

- **When**: Before adding a feature (make the change easy, then make the easy change), or when you touch code that's hard to understand
- **When NOT**: While debugging, without test coverage, or unrelated to the current task
- **How**: Ensure tests pass → make one structural change → run tests → repeat
- Never change behavior and structure in the same step

## Dependencies

Before adding a new dependency:
1. Can we solve this in <100 lines ourselves?
2. Is it actively maintained? What's the transitive cost?
3. What's the license? What if it disappears tomorrow?
4. Wrap third-party APIs behind interfaces we control (this project already does this — e.g., `better-sqlite3` behind repository interfaces)
5. Pin versions explicitly. Update deliberately, not automatically

## Token Efficiency

- Never re-read files you just wrote or edited — you know the contents
- Never re-run commands to "verify" unless the outcome was genuinely uncertain
- Don't echo back large blocks of code or file contents unless asked
- Batch related edits into single operations — don't make 5 edits when 1 handles it
- Skip confirmations like "I'll now proceed to..." — just do it
- Plan before acting — if a task needs 1 tool call, don't use 3

## When Uncertain

1. **Check existing patterns** — How does the codebase already solve similar problems?
2. **Ask** — Ambiguity is expensive. Clarify before implementing
3. **Smallest change** — Prefer minimal diff that solves the problem
4. **Reversibility** — Prefer changes that are easy to undo
5. **Prove it** — Run the code. Pass the tests. Don't guess

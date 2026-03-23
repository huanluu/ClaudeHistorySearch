# Fix Issue

End-to-end implementation of a GitHub issue: read → plan → design review → implement → test → code review → commit. Invoked via `/fix-issue <number>` or `/fix-issue #<number>`.

This skill is designed to work in any context — main conversation, subagent, or worktree. It uses `/copilot` for design review and code review (no Claude subagent spawning), making it fully subagent-safe.

## Arguments

- `<number>` — GitHub issue number (required). Accepts `#70` or `70`.

## Steps

### Phase 1: Understand

1. **Parse the issue number** from the arguments. Strip any `#` prefix.

2. **Read the issue** — Fetch the full issue body:
   ```bash
   gh issue view <number> --json title,body,labels -q '"\(.title)\n\n\(.body)"'
   ```
   Extract: title, problem description, acceptance criteria, references to specific files/lines.

3. **Identify scope** — Based on the issue's referenced files, determine what's affected:
   - Server only (`server/src/`) → will need `npm test`, `npm run lint`
   - Swift only (`Shared/`, `ClaudeHistorySearch/`, `ClaudeHistorySearchMac/`) → will need `swift test`
   - Both → will need both test suites
   - Note which specific files the issue references — read them to understand the current state.

4. **Read referenced files** — Read every file mentioned in the issue body. Also read `CLAUDE.md` and (if server changes) `server/CLAUDE.md` for conventions. Do this in parallel.

### Phase 2: Plan

5. **Create a plan file** at `~/.claude/plans/issue-<number>.md`:

   ```markdown
   # Issue #<number>: <title>

   ## Goal
   <1-2 sentence summary of what needs to change and why>

   ## Acceptance Criteria
   <copy from the issue — these are your definition of done>

   ## Steps

   ### Tests first
   - [ ] Write failing test for <core behavior>
   - [ ] Write failing test for <error case>
   - [ ] (list each test)

   ### Implementation
   - [ ] <specific file change with rationale>
   - [ ] <specific file change>
   - [ ] (list each change)

   ### Verification
   - [ ] npm test / swift test passes
   - [ ] npm run lint passes (if server changes)
   - [ ] Each acceptance criterion checked off

   ## Files to modify
   - `path/to/file.ts` — <what changes>
   - `path/to/file.swift` — <what changes>
   ```

   Each step must be concrete and checkable — not vague descriptions. Include the specific test names, file paths, and what changes in each file.

6. **Design review via Copilot** — Invoke the `/design-review-agent` skill to review the plan. This will send the plan + codebase context to Copilot (GPT) for cross-model architectural review.

   - If verdict is **Revise**: update the plan to address blocking findings, then re-run `/design-review-agent`. Repeat until **Approve**.
   - If verdict is **Approve**: proceed to implementation.
   - Maximum 3 review cycles. If still not approved after 3, stop and report the blocking findings — do not proceed with a rejected plan.

### Phase 3: Implement

7. **Implement with TDD** — Follow the plan steps in order:

   a. **Write failing tests first.** Run the test suite to confirm they fail for the right reason.
   b. **Implement the minimum code** to make tests pass.
   c. **Run the full test suite:**
      - Server changes: `cd server && npm test`
      - Swift changes: `cd Shared && swift test`
      - Server lint: `cd server && npm run lint`
   d. **Mark each step `[x]`** in the plan file as you complete it.

   If tests fail unexpectedly, diagnose and fix before moving on. If you get stuck after 3 attempts on the same step, stop and report what's blocking.

8. **Verify acceptance criteria** — Go through each acceptance criterion from the issue. Classify each one:
   - **Verified by unit/contract test**: confirm the test exists and passes → mark `[x]`
   - **Verified by grep/scan**: run the check now → mark `[x]`
   - **Needs integration test (live server)**: flag as `[ ] (needs /qa)` — write the integration test if it doesn't exist, but don't run it (server may not be current)
   - **Needs manual verification**: flag as `[ ] (manual)` — cannot be automated

### Phase 4: Review & Commit

9. **Stage changes** — Add the modified files:
   ```bash
   git add <list of changed files explicitly — never use git add -A>
   ```
   Do NOT stage unrelated files, `.env`, credentials, or the plan file.

10. **Code review via Copilot** — Invoke the `/agent-code-review` skill to review staged changes. This sends the diff to Copilot (GPT) for cross-model code review, then writes the `.code-reviewed` marker.

    - If critical findings: fix them, re-stage, re-run `/agent-code-review`.
    - Maximum 3 review cycles. If still failing after 3, stop and report.

11. **Commit** — Create a descriptive commit:
    ```bash
    git commit -m "$(cat <<'EOF'
    <imperative mood summary, ≤50 chars>

    <body: what changed and why, referencing issue #number>

    Fixes #<number>

    Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
    Reviewed-By: GitHub Copilot (GPT-5.4)
    EOF
    )"
    ```

### Phase 5: Report & Persist

12. **Post a completion comment on the GitHub issue** — This is the permanent record. Use `gh issue comment`:

    ```bash
    gh issue comment <number> --body "$(cat <<'COMMENT_EOF'
    ## Implementation Report

    **Status:** DONE | BLOCKED | NEEDS_MANUAL_VERIFICATION
    **Commit:** `<hash>` on branch `<branch>`
    **Implemented by:** Claude Opus 4.6 | **Reviewed by:** GitHub Copilot (GPT-5.4)

    ### Changes
    | File | What changed |
    |------|-------------|
    | `path/to/file` | <description> |

    ### Key Decisions
    - <non-obvious choice and why — e.g., "Used healthy|degraded not unhealthy because /health never returns it (caught by Copilot design review)">
    - <any tradeoffs made>

    ### Design Review Findings (Copilot GPT-5.4)
    - **Cycle <N>:** <verdict>
    - <blocking findings that were addressed, if any>
    - <warnings noted>

    ### Code Review Findings (Copilot GPT-5.4)
    - **Cycle <N>:** <verdict>
    - <critical findings fixed>
    - <warnings noted>

    ### Acceptance Criteria
    - [x] <criterion> — verified by <unit test name / grep / scan>
    - [ ] <criterion> — **needs /qa**: covered by integration test `<test name>`
    - [ ] <criterion> — **manual**: <reason it can't be automated>

    ### Tests (unit + contract only)
    - npm test: PASS/FAIL (<count> tests)
    - swift test: PASS/FAIL (<count> tests) *(if applicable)*
    - npm run lint: PASS/FAIL *(if applicable)*

    ### Next Step
    Run `/qa <number>` to deploy, run integration tests, and verify remaining AC.
    COMMENT_EOF
    )"
    ```

    **Closing rules:**
    - **Never close the issue from `/fix-issue`.** Implementation is done, but `/qa` hasn't verified yet.
    - The issue stays open until `/qa` signs off (or the user closes it manually).
    - If status is BLOCKED: label it:
      ```bash
      gh issue edit <number> --add-label "blocked"
      ```

13. **Return a brief result to the caller** — Keep this short since the full report is on the issue:

    ```
    ## Result
    **Issue:** #<number> — <title>
    **Status:** DONE | BLOCKED
    **Commit:** <hash>
    **Comment:** posted to issue
    ```

## Error Handling

- **Copilot unavailable:** If `copilot` binary is not found or auth fails, fall back to self-review (review the diff yourself using the same criteria from the skills). Note in the report: "Reviewed by Claude (Copilot unavailable)".
- **Tests won't pass after 3 attempts:** Stop. Report what's failing and what you tried. Status: BLOCKED.
- **Design review won't approve after 3 cycles:** Stop. Report the blocking findings. Status: BLOCKED.
- **Issue is unclear or has contradictory AC:** Stop. Report what's ambiguous. Status: BLOCKED.

## Important Rules

- **Follow CLAUDE.md conventions.** Read it. Follow it. Especially: ports-and-adapters architecture, effectless features, constructor injection.
- **One logical change per commit.** Don't bundle unrelated changes.
- **Never modify files outside the issue's scope.** No drive-by refactors, no "while I'm here" improvements.
- **Mark plan steps as you go.** This survives context compaction.
- **Stage files explicitly by name.** Never `git add -A` or `git add .`.

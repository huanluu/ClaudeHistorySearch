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

8. **Verify acceptance criteria** — Go through each acceptance criterion from the issue. For each one:
   - If it's testable via automated tests: confirm the test exists and passes
   - If it's a grep/scan check: run the grep and confirm the result
   - If it's manual-only: note it as "requires manual verification" in the report

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

### Phase 5: Report

12. **Return a structured result** — Summarize what happened:

    ```
    ## Result

    **Issue:** #<number> — <title>
    **Status:** DONE | BLOCKED | NEEDS_MANUAL_VERIFICATION
    **Branch:** <current branch name>
    **Commit:** <commit hash>

    ### Changes
    - <file>: <what changed>

    ### Tests
    - npm test: PASS/FAIL
    - swift test: PASS/FAIL (if applicable)
    - npm run lint: PASS/FAIL (if applicable)

    ### Acceptance Criteria
    - [x] <criterion> — verified by <test name / grep / manual>
    - [ ] <criterion> — requires manual verification: <reason>

    ### Review
    - Design review: Approved (cycle N)
    - Code review: Passed (cycle N)
    - Critical findings fixed: <count>
    - Warnings noted: <list>
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

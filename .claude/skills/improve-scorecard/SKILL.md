# Improve Scorecard

Fix one or more failing scorecard invariants, following the full plan → design review → implement → code review → verify → snapshot pipeline. Invoked via `/improve-scorecard` with an optional invariant ID argument (e.g., `/improve-scorecard CQ-INV-5`).

## Steps

1. **Read current scorecard state** — Find the latest snapshot:
   ```bash
   ls -1 server/scorecard/history/*.json | sed 's/\.json$//' | sort | tail -1 | sed 's/$/.json/'
   ```
   **Why not plain `sort`?** The `-N` suffix (e.g., `2026-03-09-2.json`) sorts *before* `2026-03-09.json` because `-` (ASCII 45) < `.` (ASCII 46). Stripping `.json` before sorting fixes this: `2026-03-09` < `2026-03-09-2`.

   Read that file. Also read `server/scorecard/SCORECARD.md` for invariant definitions and `server/scorecard/CLAUDE.md` for procedures.

2. **Pick the target invariant** — If the user specified an invariant ID (e.g., `CQ-INV-5`), use that. Otherwise, analyze the failing invariants and pick the one with the highest ROI — consider:
   - How many violations remain (fewer = closer to fixed)
   - Whether fixing it would also reduce violations in other invariants
   - Complexity of the fix (prefer quick wins)

   Present the choice to the user and confirm before proceeding. Show:
   - The invariant ID and description
   - Current violations (from the snapshot)
   - Brief assessment of what's needed to fix it

3. **Analyze violations** — Read the relevant scorecard test file(s) to understand exactly what's checked. Then read each violating source file to understand the current state. Use subagents for parallel reading if there are many files.

4. **Write a plan** — Create a plan file at `~/.claude/plans/fix-<invariant-id>.md` with:
   - Goal (one sentence)
   - List of specific changes needed, with checkboxes
   - Implementation order
   - Post-fix steps (promote `it.fails()`, verify, snapshot)
   - Risks or overlap with existing code

   Keep the plan minimal — only what's needed to fix the invariant, no scope creep.

5. **Run `/design-review-agent`** — Invoke the design review skill to validate the plan. If it comes back with blocking findings, revise the plan and re-run. Repeat until approved.

6. **Implement the fix** — Follow the plan step by step:
   - For each change, read the target file first, then edit
   - After each logical group of changes, run `npm test` to verify nothing broke
   - Mark plan steps `[x]` as completed
   - Keep changes minimal — fix the invariant, don't refactor beyond what's needed
   - If the invariant involves adding tests (CQ-INV-6), write focused tests that cover behavior, not implementation
   - If the invariant involves extracting code (CQ-INV-4, CQ-INV-5), preserve behavior exactly — refactoring rules apply

7. **Promote the invariant** — Once all violations are resolved:
   - Run `npm test` — if the `it.fails()` test reports "expected to fail but passed", it's fixed
   - Change `it.fails(` to `it(` in the relevant `scorecard/tests/*.test.ts` file
   - Run `npm test` again to confirm all tests still pass
   - Run `npm run lint` to verify no lint regressions

8. **Run `/agent-code-review`** — Stage all changed files and invoke the code review skill. Fix any critical findings, re-stage, and re-run if needed.

9. **Commit** — Commit with a descriptive message following project conventions:
   ```
   Fix <INVARIANT-ID>: <brief description>

   <details of what changed>
   ```
   Do NOT push unless the user asks.

10. **Generate scorecard snapshot** — Run the scorecard tests to collect the full current state:
    ```bash
    cd server && npx vitest run scorecard/tests/
    ```
    Then collect violation details for all still-failing invariants (use the same scripts from previous snapshot generation). Create a new snapshot at `server/scorecard/history/YYYY-MM-DD.json` (append `-N` suffix if a file for today already exists). Include:
    - All 18 invariant statuses with violation details
    - Summary with passing count and pass rate
    - Delta section noting what changed since the previous snapshot
    - Test execution stats

11. **Stage, review, and commit the snapshot** — Run `/agent-code-review` on the snapshot, then commit it separately from the fix.

12. **Report** — Summarize to the user:
    - Which invariant was fixed
    - What changed (files added/modified, tests added)
    - New scorecard score (X/18, Y%)
    - Remaining failing invariants with brief notes

## Guardrails

- **One invariant at a time** — Don't try to fix multiple invariants in one run unless they're trivially related (e.g., CQ-INV-4 and CQ-INV-5 in the same file).
- **No scope creep** — If fixing an invariant reveals other issues, note them but don't fix them. Stay focused.
- **No new invariant violations** — After every change, verify no passing invariant has regressed.
- **Preserve behavior** — Refactoring for invariant compliance must not change runtime behavior. If behavior changes are needed, that's a separate task.
- **Respect the pipeline** — Every fix goes through: plan → design review → implement → code review → commit. No shortcuts.

# Scorecard Agent Procedures

> Numbered steps for AI agents working with the scorecard system.
> For invariant definitions and rationale, see `SCORECARD.md`.
> For design principles, see `docs/invariants.md`.

## Fixing an Invariant

When a known violation is resolved and an `it.fails()` test starts passing:

1. Run `npm test` — Vitest will report "this test was expected to fail but passed"
2. Open the relevant test file in `scorecard/tests/`
3. Change `it.fails(` to `it(` for that test
4. Run `npm test` again — confirm all tests pass
5. Update `scorecard/baseline.json`: change the invariant's `"status"` from `"fail"` to `"pass"`, update `summary.passing` count and `passRate`
6. Commit the test file and baseline.json together

## Adding a New Invariant

1. Choose an ID following the pattern: `{SECTION}-INV-{N}` (e.g., `ARCH-INV-9`)
2. Add the definition to `scorecard/SCORECARD.md` under the appropriate section:
   - Description (what it checks)
   - Fail condition
   - `Enforced by` reference to the test file
3. Add the test to the appropriate `scorecard/tests/*.test.ts` file
   - If the invariant currently fails, use `it.fails(` — do NOT skip it
4. Add an entry to `scorecard/baseline.json` with initial status
5. Run `npm test` and `npm run lint` to verify
6. Commit all files together

## Archiving a Baseline

Before making significant changes to the scorecard:

1. Copy `scorecard/baseline.json` to `scorecard/history/YYYY-MM-DD.json`
2. Make your changes
3. Update `scorecard/baseline.json` with new state
4. Commit the archive, updated baseline, and changes together

## File Layout

```
scorecard/
  SCORECARD.md              # Invariant definitions (stable docs)
  CLAUDE.md                 # This file (agent procedures)
  baseline.json             # Current pass/fail state
  history/                  # Archived baselines
    2026-02-16.json         # Initial baseline
  tests/
    helpers.ts              # Shared utilities
    architecture.test.ts    # ARCH-INV-* tests
    code-quality.test.ts    # CQ-INV-* tests
    security.test.ts        # SEC-INV-* tests
    reliability.test.ts     # REL-INV-* tests
```

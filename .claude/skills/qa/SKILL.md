# QA

Deploy fresh code, run all tests including integration, and optionally verify specific issues. Invoked via `/qa` or `/qa <issue-numbers>`.

## Two Modes

1. **`/qa <issue-numbers>`** — Deploy, run full test suite, verify AC for the specified issues, sign off if all pass. This is the verification gate between "code is written" and "issue is closed."
2. **`/qa`** (no arguments) — Deploy and run full test suite only. No issue verification, no sign-off. Use as a general health check.

## Arguments

- `<issue-numbers>`: deploy + full test suite + verify and sign off specific issues (e.g., `/qa 70 71`)
- No arguments: deploy + full test suite only (no issue verification)

## Steps

### Phase 1: Deploy

1. **Deploy the server** — Restart the launchd agent so it picks up the latest code:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.claude-history-server
   ```

2. **Wait and verify health:**
   ```bash
   sleep 3
   curl -s http://localhost:3847/health
   ```
   If health check fails, check logs (`tail -20 /tmp/claude-history-server.err`) and stop.

3. **Build the Mac app** — always build. A healthy system means everything compiles:
   ```bash
   PROJECT_DIR=$(git rev-parse --show-toplevel)
   xcodebuild -project "$PROJECT_DIR/ClaudeHistorySearch.xcodeproj" \
     -scheme ClaudeHistorySearchMac \
     -configuration Release \
     -derivedDataPath "$PROJECT_DIR/build" \
     -destination 'platform=macOS' \
     build 2>&1 | tail -5
   ```
   If the build fails, this is a **QA failure**. Report the errors and do not sign off on any issues. The system is not healthy if the app doesn't compile.

### Phase 2: Full Test Suite

4. **Run server tests:**
   ```bash
   cd server && npm test
   ```
   Record: pass/fail, test count.

5. **Run server lint:**
   ```bash
   cd server && npm run lint
   ```

6. **Run Swift unit + contract tests:**
   ```bash
   cd Shared && swift test
   ```
   Record: pass/fail, test count, skipped count.

7. **Run Swift integration tests** — this is the key difference from `/fix-issue`:
   ```bash
   cd Shared && RUN_LIVE_INTEGRATION=1 swift test --filter Integration
   ```
   Record: pass/fail, test count. If any integration test fails, this is a **real failure** (server is freshly deployed), not a skip.

### Phase 3: Verify Issues (only if issue numbers provided)

**If no issue numbers were passed:** skip Phase 3 entirely. Report test results only.

**If issue numbers were passed:** verify each one.

8. **Read each specified issue:**
   ```bash
   gh issue view <number> --json title,body,comments
   ```

9. **For each issue, check acceptance criteria:**
   - Read the issue body to get the AC list
   - Read the implementation report comment to see what was verified
   - Check if integration tests cover any remaining unchecked AC
   - For each AC:
     - **Verified by unit/contract test**: already checked by `/fix-issue`
     - **Verified by integration test**: check if a matching integration test passed in Phase 2
     - **Requires manual verification**: flag it — `/qa` can't help here
     - **Verified by grep/scan**: run the check now

10. **Update each issue with a QA report comment:**
    ```bash
    gh issue comment <number> --body "$(cat <<'COMMENT_EOF'
    ## QA Verification Report

    **Server:** deployed and healthy
    **Mac app build:** PASS/FAIL/SKIPPED

    ### Test Results
    - npm test: PASS (<count> tests)
    - npm run lint: PASS
    - swift test (unit + contract): PASS (<count> tests)
    - swift test (integration): PASS (<count> tests)

    ### Acceptance Criteria Verification
    - [x] <criterion> — verified by integration test: <test name>
    - [x] <criterion> — verified by unit test (from /fix-issue)
    - [ ] <criterion> — requires manual verification: <reason>

    ### Verdict
    **SIGN OFF** — all automatable AC verified
    or
    **PARTIAL** — N AC require manual verification (listed above)
    COMMENT_EOF
    )"
    ```

11. **Close issues that are fully verified:**
    - If ALL AC are checked (no manual items remaining): `gh issue close <number>`
    - If some AC need manual verification: leave open, the QA report documents what's left

### Phase 4: Report

12. **Summary to caller:**

    If issue numbers were provided:
    ```
    ## QA Results

    ### Deploy
    - Server: healthy
    - Mac app: PASS/FAIL/SKIPPED

    ### Tests
    - npm test: PASS/FAIL
    - swift test: PASS/FAIL
    - integration: PASS/FAIL

    ### Issues
    - #<N>: SIGNED OFF / PARTIAL (N manual items) / FAILED
    ```

    If no issue numbers (health check mode):
    ```
    ## QA Results

    ### Deploy
    - Server: healthy
    - Mac app: PASS/FAIL/SKIPPED

    ### Tests
    - npm test: PASS/FAIL (<count>)
    - swift test: PASS/FAIL (<count>)
    - integration: PASS/FAIL (<count>)
    ```

## Important Rules

- **Integration test failures after fresh deploy are real failures** — don't skip, investigate.
- **Don't close issues with unchecked AC.** If manual verification is needed, say so explicitly.
- **Run integration tests with `RUN_LIVE_INTEGRATION=1`** — this is the env var gate that separates dev from QA.
- **Mac app build failure = QA failure.** The system is not healthy if any target doesn't compile. Never skip the build.

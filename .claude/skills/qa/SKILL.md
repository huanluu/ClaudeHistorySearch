# QA

Deploy fresh code, run all tests including integration, and verify open issues. Invoked via `/qa` or `/qa <issue-numbers>`.

This is the verification gate between "code is written" and "issue is closed." It deploys, runs the full test suite (including live integration tests), and checks whether open issues can be signed off.

## Arguments

- No arguments: deploy + full test suite + verify all open issues with implementation reports
- `<issue-numbers>`: deploy + full test suite + verify specific issues (e.g., `/qa 70 71`)

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

3. **Build the Mac app** (optional — only if Swift source files changed):
   ```bash
   PROJECT_DIR=$(git rev-parse --show-toplevel)
   xcodebuild -project "$PROJECT_DIR/ClaudeHistorySearch.xcodeproj" \
     -scheme ClaudeHistorySearchMac \
     -configuration Release \
     -derivedDataPath "$PROJECT_DIR/build" \
     -destination 'platform=macOS' \
     build 2>&1 | tail -5
   ```
   If the build fails:
   - **Server-only changes** (no files in `Shared/`, `ClaudeHistorySearch/`, `ClaudeHistorySearchMac/`): continue with test verification — the app build is irrelevant.
   - **Swift/Shared changes**: the build failure is a **real QA failure**. Report it and do not sign off.

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

### Phase 3: Verify Issues

8. **Find open issues with implementation reports** — either the specified issues or all open issues:
   ```bash
   # Specific issues (preferred — pass issue numbers from arguments):
   gh issue view <number> --json title,body,comments

   # All open issues with implementation reports (filter for "## Implementation Report" marker):
   gh issue list --state open --json number,title,comments \
     -q '[.[] | select(.comments[]?.body | test("## Implementation Report"))] | .[].number'
   ```
   Only process issues that have a comment containing `## Implementation Report` — this is the marker `/fix-issue` posts. Do not process issues with only discussion comments.

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

## Important Rules

- **Integration test failures after fresh deploy are real failures** — don't skip, investigate.
- **Don't close issues with unchecked AC.** If manual verification is needed, say so explicitly.
- **Run integration tests with `RUN_LIVE_INTEGRATION=1`** — this is the env var gate that separates dev from QA.
- **The Mac app build is optional.** Server-only changes don't need the app to build. Report build status but don't block QA on it.

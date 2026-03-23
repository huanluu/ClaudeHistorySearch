# Agent Code Review

Use this skill to review staged changes before committing. Invoked via `/agent-code-review`.

This skill delegates the actual review to **GitHub Copilot CLI (GPT)** via the `/copilot` skill for a cross-model second opinion, then handles findings and writes the `.code-reviewed` marker. No Claude subagent is spawned — this skill works in any context including inside subagents.

## Steps

1. **Resolve the target repo** — Find the git root from the current directory:
   ```bash
   TARGET=$(git rev-parse --show-toplevel)
   echo "Review target: $TARGET"
   ```
   Use `git -C "$TARGET"` for **all** git commands in subsequent steps.

2. **Check for staged changes** — Run `git -C "$TARGET" diff --cached --stat`. If nothing is staged, tell the user and stop.

3. **Send the diff to Copilot for review** — Use the `/copilot` skill in review mode. Invoke it as:

   ```
   /copilot review focus on bugs, security, architecture violations (ports-and-adapters: features must be effectless, no direct I/O), error handling gaps, and naming clarity. Do NOT flag style preferences, missing comments, or feature suggestions. For each finding use severity levels: critical (must fix), warning (should fix), nit (optional).
   ```

   The `/copilot` skill handles all the mechanics: binary detection, prompt construction, diff generation, temp file management, timeout (5 min), model selection (GPT-5.4), error handling, and output presentation.

   **Important:** The `/copilot review` skill generates the diff from the current branch vs base branch. If you need to review only **staged** changes specifically, construct the prompt manually instead:

   ```bash
   TARGET=$(git rev-parse --show-toplevel)
   DIFF=$(git -C "$TARGET" diff --cached)
   LINES=$(echo "$DIFF" | wc -l | tr -d ' ')
   echo "Staged diff: $LINES lines"
   ```

   If the diff is >5000 lines, warn the user that Copilot may truncate.

   Then run `/copilot` in consult mode with the staged diff:

   ```
   /copilot You are a senior code reviewer. Review this staged git diff.

   Focus on: Bugs (logic errors, off-by-one, null/undefined, race conditions), Security (injection, XSS, hardcoded secrets, unsafe deserialization), Architecture (violations of ports-and-adapters layered architecture — features must be effectless, no direct I/O in features), Error handling (missing error cases, swallowed errors, unclear messages), Naming & clarity (misleading names, confusing control flow).

   Do NOT flag: style preferences, missing comments on clear code, feature suggestions beyond what's changed.

   For each finding: Severity (critical/warning/nit), File and line, What, Why, Fix (concrete).

   If the code looks good, say so — don't invent findings.

   THE STAGED DIFF:
   {paste the staged diff here}
   ```

4. **Evaluate findings** — Read Copilot's response.
   - **Critical findings**: Fix them immediately, then re-stage the fixed files with `git -C "$TARGET" add <file>`. After fixing, re-run the review on the updated diff to verify fixes (repeat step 3).
   - **Warnings**: Fix if straightforward (< 5 min each). Otherwise note them for the user.
   - **Nits**: Skip — do not fix nits.

5. **Stamp the review** — After all critical fixes are staged and verified, write the marker:
   ```bash
   TARGET=$(git rev-parse --show-toplevel)
   HASH=$(git -C "$TARGET" diff --cached | shasum | awk '{print $1}')
   echo "$HASH" > "$TARGET/.code-reviewed"
   echo "Review marker written: $TARGET/.code-reviewed (hash: $HASH)"
   ```

6. **Report** — Present the full Copilot review output, then summarize:
   - What was reviewed (files, line count)
   - What was fixed (critical findings resolved)
   - What was skipped (warnings noted for user)
   - Confirm the review marker is written
   - State the review model: "Reviewed by GPT via Copilot CLI"

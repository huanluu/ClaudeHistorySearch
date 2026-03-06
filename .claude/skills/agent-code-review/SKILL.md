# Agent Code Review

Use this skill to review staged changes before committing. Invoked via `/agent-code-review`.

## Steps

1. **Resolve the target repo** — Find the git root from the current directory:
   ```bash
   TARGET=$(git rev-parse --show-toplevel)
   echo "Review target: $TARGET"
   ```
   Use `git -C "$TARGET"` for **all** git commands in subsequent steps.

2. **Check for staged changes** — Run `git -C "$TARGET" diff --cached --stat`. If nothing is staged, tell the user and stop.

3. **Spawn a review subagent** — Use the Agent tool with `subagent_type: "general-purpose"` and `model: "opus"` to review the staged diff. The subagent prompt should be:

   > You are a senior code reviewer. Review the following staged git diff for this project.
   >
   > Focus on:
   > - **Bugs**: Logic errors, off-by-one, null/undefined access, race conditions
   > - **Security**: Injection, XSS, hardcoded secrets, unsafe deserialization
   > - **Architecture**: Violations of the project's layered architecture (see CLAUDE.md)
   > - **Error handling**: Missing error cases, swallowed errors, unclear error messages
   > - **Naming & clarity**: Misleading names, confusing control flow
   >
   > Do NOT flag:
   > - Style preferences (formatting, bracket placement)
   > - Missing comments or docs on clear code
   > - Suggestions to add features beyond what's being changed
   >
   > For each finding, output:
   > - **Severity**: `critical` (must fix), `warning` (should fix), `nit` (optional)
   > - **File and line**: Where the issue is
   > - **What**: The problem
   > - **Why**: Why it matters
   > - **Fix**: Suggested fix (concrete, not vague)
   >
   > If the code looks good, say so — don't invent findings.
   >
   > Here is the staged diff:
   > ```
   > {paste the output of `git -C "$TARGET" diff --cached` here}
   > ```

4. **Evaluate findings** — Read the subagent's response.
   - **Critical findings**: Fix them immediately, then re-stage the fixed files with `git -C "$TARGET" add <file>`.
   - **Warnings**: Fix if straightforward (< 5 min each). Otherwise note them for the user.
   - **Nits**: Skip — do not fix nits.

5. **Stamp the review** — After all fixes are staged, run:
   ```bash
   TARGET=$(git rev-parse --show-toplevel)
   HASH=$(git -C "$TARGET" diff --cached | shasum | awk '{print $1}')
   echo "$HASH" > "$TARGET/.code-reviewed"
   echo "Review marker written: $TARGET/.code-reviewed (hash: $HASH)"
   ```

6. **Report** — Summarize what was reviewed, what was fixed, and confirm the review marker is written. If there were warnings you skipped, list them so the user can decide.

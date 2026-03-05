# Agent Code Review

Use this skill to review staged changes before committing. Invoked via `/agent-code-review`.

## Steps

1. **Check for staged changes** — Run `git diff --cached --stat`. If nothing is staged, tell the user and stop.

2. **Spawn a review subagent** — Use the Agent tool with `subagent_type: "general-purpose"` and `model: "opus"` to review the staged diff. The subagent prompt should be:

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
   > {paste the output of `git diff --cached` here}
   > ```

3. **Evaluate findings** — Read the subagent's response.
   - **Critical findings**: Fix them immediately, then re-stage the fixed files with `git add <file>`.
   - **Warnings**: Fix if straightforward (< 5 min each). Otherwise note them for the user.
   - **Nits**: Skip — do not fix nits.

4. **Stamp the review** — After all fixes are staged, run:
   ```bash
   git diff --cached | shasum | awk '{print $1}' > "$(git rev-parse --show-toplevel)/.code-reviewed"
   ```
   This writes a content-addressed hash of the final staged diff. The pre-commit hook will verify this hash matches before allowing the commit.

5. **Report** — Summarize what was reviewed, what was fixed, and confirm the review marker is written. If there were warnings you skipped, list them so the user can decide.

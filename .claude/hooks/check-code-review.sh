#!/bin/bash
# Blocks git commit unless staged changes have been code-reviewed.
# The review marker (.code-reviewed) contains a shasum of the reviewed diff.
# Used as a Claude Code PreToolUse hook on Bash commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git commit commands
if ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Resolve git root from CWD (works in both main repo and worktrees)
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

MARKER="$REPO_ROOT/.code-reviewed"

# Check marker exists
if [ ! -f "$MARKER" ]; then
  echo "Code review required before committing." >&2
  echo "Run /agent-code-review to review staged changes." >&2
  exit 2
fi

# Check marker matches current staged diff
CURRENT_HASH=$(git diff --cached | shasum | awk '{print $1}')
STORED_HASH=$(cat "$MARKER")

if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
  echo "Staged changes have changed since the last code review." >&2
  echo "Run /agent-code-review again to review the current changes." >&2
  exit 2
fi

# Review matches — allow commit, clean up marker
rm -f "$MARKER"
exit 0

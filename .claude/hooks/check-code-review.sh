#!/bin/bash
# Blocks git commit unless staged changes have been code-reviewed.
# Used as a Claude Code PreToolUse hook on Bash commands.
#
# Uses CLAUDE_PROJECT_DIR (not CWD) to locate the .code-reviewed marker,
# so it works even when Bash CWD has drifted to another repo.
# See: https://github.com/huanluu/ClaudeHistorySearch/issues/62

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept actual git commit commands — require it to appear as a
# command (at start or after a shell operator), not as a substring in
# echo, grep, or similar. Avoids false matches that consume the marker.
if ! echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit\b'; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$REPO" ] && exit 0
MARKER="$REPO/.code-reviewed"

if [ ! -f "$MARKER" ]; then
  echo "Code review required before committing." >&2
  echo "Run /agent-code-review to review staged changes." >&2
  exit 2
fi

STORED_HASH=$(cat "$MARKER")
CURRENT_HASH=$(git -C "$REPO" diff --cached | shasum | awk '{print $1}')

if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
  echo "Staged changes have changed since the last code review." >&2
  echo "Run /agent-code-review again to review the current changes." >&2
  exit 2
fi

# Review matches — allow commit, clean up marker
rm -f "$MARKER"
exit 0

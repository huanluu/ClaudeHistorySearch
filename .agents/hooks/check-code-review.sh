#!/bin/bash
# Blocks git commit unless staged changes have been code-reviewed.
# Used as a Copilot preToolUse hook on Bash commands.
#
# Uses the git toplevel to locate the .code-reviewed marker, so it works
# even when Bash CWD has drifted to another repo.
# See: https://github.com/huanluu/ClaudeHistorySearch/issues/62

INPUT=$(cat)
COMMAND_FILE=$(mktemp /tmp/copilot-hook-command-XXXXXXXX)
CWD_FILE=$(mktemp /tmp/copilot-hook-cwd-XXXXXXXX)
printf '%s' "$INPUT" | COMMAND_FILE="$COMMAND_FILE" CWD_FILE="$CWD_FILE" python3 -c '
import json
import os
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = payload.get("tool_input")
if isinstance(tool_input, dict):
    command = tool_input.get("command")
    if command is not None:
        open(os.environ["COMMAND_FILE"], "w", encoding="utf-8").write(str(command))
        open(os.environ["CWD_FILE"], "w", encoding="utf-8").write(str(payload.get("cwd", "")))
        sys.exit(0)

tool_args = payload.get("toolArgs") or payload.get("tool_input") or {}
if isinstance(tool_args, str):
    try:
        tool_args = json.loads(tool_args)
    except Exception:
        tool_args = {}
if isinstance(tool_args, dict):
    open(os.environ["COMMAND_FILE"], "w", encoding="utf-8").write(str(tool_args.get("command", "")))
    open(os.environ["CWD_FILE"], "w", encoding="utf-8").write(str(payload.get("cwd", "")))
'
COMMAND=$(cat "$COMMAND_FILE")
HOOK_CWD=$(cat "$CWD_FILE")
rm -f "$COMMAND_FILE" "$CWD_FILE"

deny() {
  REASON="$1" python3 - <<'PY'
import json
import os

print(json.dumps({
    "permissionDecision": "deny",
    "permissionDecisionReason": os.environ.get("REASON", "Blocked by hook.")
}))
PY
  exit 0
}

# Only intercept actual git commit commands — require it to appear as a
# command (at start or after a shell operator), not as a substring in
# echo, grep, or similar. Avoids false matches that consume the marker.
if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)git([[:space:]]+-[[:alnum:]-]+([=[:space:]][^[:space:];&|]+)?)*[[:space:]]+commit\b'; then
  exit 0
fi

# Use git toplevel (works in worktrees) with hook payload cwd as fallback.
REPO="$(git -C "${HOOK_CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -z "$REPO" ] && exit 0
MARKER="$REPO/.code-reviewed"

if [ ! -f "$MARKER" ]; then
  deny "Code review required before committing. Run /agent-code-review to review staged changes."
fi

STORED_HASH=$(cat "$MARKER")
CURRENT_HASH=$(git -C "$REPO" diff --cached | shasum | awk '{print $1}')

if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
  deny "Staged changes have changed since the last code review. Run /agent-code-review again to review the current changes."
fi

# Review matches — allow commit, clean up marker
rm -f "$MARKER"
exit 0

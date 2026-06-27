#!/bin/bash
# Runs ESLint, server tests, and (conditionally) Swift tests before git commit.
# Used as a Copilot preToolUse hook on Bash commands.

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

# Only intercept actual git commit commands (not substrings in echo/grep/etc.)
if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)git([[:space:]]+-[[:alnum:]-]+([=[:space:]][^[:space:];&|]+)?)*[[:space:]]+commit\b'; then
  exit 0
fi

# Use git toplevel (works in worktrees) with hook payload cwd as fallback.
REPO="$(git -C "${HOOK_CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO" || exit 0

# In worktrees, symlink node_modules from the main repo to avoid reinstalling
if [ ! -d server/node_modules ]; then
  MAIN_REPO=$(dirname "$(git rev-parse --git-common-dir)")
  if [ -d "$MAIN_REPO/server/node_modules" ]; then
    ln -s "$MAIN_REPO/server/node_modules" server/node_modules
  fi
fi

# --- TypeScript typecheck ---
TC_OUTPUT=$(cd server && npm run typecheck 2>&1)
if [ $? -ne 0 ]; then
  deny "TypeScript typecheck failed — fix type errors before committing:\n$TC_OUTPUT"
fi

# --- ESLint ---
LINT_OUTPUT=$(cd server && npm run lint 2>&1)
if [ $? -ne 0 ]; then
  deny "ESLint failed — fix lint errors before committing:\n$LINT_OUTPUT"
fi

# --- Server tests ---
TEST_OUTPUT=$(cd server && npm test 2>&1)
if [ $? -ne 0 ]; then
  deny "Server tests failed — fix failing tests before committing:\n$TEST_OUTPUT"
fi

# --- Swift tests (always — runs in <1s with mocked Keychain) ---
SWIFT_OUTPUT=$(cd Shared && swift test 2>&1)
if [ $? -ne 0 ]; then
  deny "Swift tests failed — fix failing tests before committing:\n$SWIFT_OUTPUT"
fi

# --- App builds (only if Swift/app files are staged) ---
STAGED=$(git diff --cached --name-only)

# Mac app: triggers on Shared/, ClaudeHistorySearch/, or ClaudeHistorySearchMac/
if echo "$STAGED" | grep -qE '^(Shared/|ClaudeHistorySearch/|ClaudeHistorySearchMac/)'; then
  MAC_OUTPUT=$(xcodebuild -project ClaudeHistorySearch.xcodeproj \
    -scheme ClaudeHistorySearchMac \
    -configuration Release \
    -derivedDataPath build \
    -destination 'platform=macOS' \
    build 2>&1)
  if [ $? -ne 0 ]; then
    deny "Mac app build failed — fix build errors before committing:\n$(echo "$MAC_OUTPUT" | grep "error:")"
  fi
fi

# iOS app: triggers on Shared/ or ClaudeHistorySearch/ (not ClaudeHistorySearchMac/)
if echo "$STAGED" | grep -qE '^(Shared/|ClaudeHistorySearch/)'; then
  IOS_OUTPUT=$(xcodebuild -project ClaudeHistorySearch.xcodeproj \
    -scheme ClaudeHistorySearch \
    -configuration Release \
    -derivedDataPath build \
    -destination 'generic/platform=iOS Simulator' \
    build 2>&1)
  if [ $? -ne 0 ]; then
    deny "iOS app build failed — fix build errors before committing:\n$(echo "$IOS_OUTPUT" | grep "error:")"
  fi
fi

exit 0

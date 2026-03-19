#!/bin/bash
# Runs ESLint, server tests, and (conditionally) Swift tests before git commit.
# Used as a Claude Code PreToolUse hook on Bash commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept actual git commit commands (not substrings in echo/grep/etc.)
if ! echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit\b'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

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
  echo "TypeScript typecheck failed — fix type errors before committing:" >&2
  echo "$TC_OUTPUT" >&2
  exit 2
fi

# --- ESLint ---
LINT_OUTPUT=$(cd server && npm run lint 2>&1)
if [ $? -ne 0 ]; then
  echo "ESLint failed — fix lint errors before committing:" >&2
  echo "$LINT_OUTPUT" >&2
  exit 2
fi

# --- Server tests ---
TEST_OUTPUT=$(cd server && npm test 2>&1)
if [ $? -ne 0 ]; then
  echo "Server tests failed — fix failing tests before committing:" >&2
  echo "$TEST_OUTPUT" >&2
  exit 2
fi

# --- Swift tests (always — runs in <1s with mocked Keychain) ---
SWIFT_OUTPUT=$(cd Shared && swift test 2>&1)
if [ $? -ne 0 ]; then
  echo "Swift tests failed — fix failing tests before committing:" >&2
  echo "$SWIFT_OUTPUT" >&2
  exit 2
fi

exit 0

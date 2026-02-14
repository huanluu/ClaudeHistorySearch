#!/bin/bash
# Runs ESLint, server tests, and (conditionally) Swift tests before git commit.
# Used as a Claude Code PreToolUse hook on Bash commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git commit commands
if ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

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

# --- Swift tests (only if .swift files are staged) ---
if git diff --cached --name-only | grep -q '\.swift$'; then
  SWIFT_OUTPUT=$(cd Shared && swift test 2>&1)
  if [ $? -ne 0 ]; then
    echo "Swift tests failed — fix failing tests before committing:" >&2
    echo "$SWIFT_OUTPUT" >&2
    exit 2
  fi
fi

exit 0

#!/bin/bash
# Runs ESLint and tests before git commit.
# Used as a Claude Code PreToolUse hook on Bash commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git commit commands
if ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Run checks from the server directory
cd "$CLAUDE_PROJECT_DIR/server" || exit 0

# --- ESLint ---
LINT_OUTPUT=$(npm run lint 2>&1)
if [ $? -ne 0 ]; then
  echo "ESLint failed — fix lint errors before committing:" >&2
  echo "$LINT_OUTPUT" >&2
  exit 2
fi

# --- Tests ---
TEST_OUTPUT=$(npm test 2>&1)
if [ $? -ne 0 ]; then
  echo "Tests failed — fix failing tests before committing:" >&2
  echo "$TEST_OUTPUT" >&2
  exit 2
fi

exit 0

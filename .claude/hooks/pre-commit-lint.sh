#!/bin/bash
# Runs ESLint before git commit to enforce import boundary rules.
# Used as a Claude Code PreToolUse hook on Bash commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept git commit commands
if ! echo "$COMMAND" | grep -q 'git commit'; then
  exit 0
fi

# Run lint from the server directory
cd "$CLAUDE_PROJECT_DIR/server" || exit 0

OUTPUT=$(npm run lint 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "ESLint failed — fix lint errors before committing:" >&2
  echo "$OUTPUT" >&2
  exit 2
fi

exit 0

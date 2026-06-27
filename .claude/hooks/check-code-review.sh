#!/bin/bash
INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
OUTPUT=$(printf '%s' "$INPUT" | bash "$PROJECT_DIR/.agents/hooks/check-code-review.sh")
STATUS=$?

if printf '%s' "$OUTPUT" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
  printf '%s\n' "$OUTPUT" >&2
  exit 2
fi

if [ "$STATUS" -ne 0 ]; then
  printf '%s\n' "$OUTPUT" >&2
  exit 2
fi

exit 0

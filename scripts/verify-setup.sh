#!/bin/bash
# Verify Claude History Search setup (launchd + login items)
# Run this after network changes or restarts to ensure everything works
#
# Usage:
#   ./verify-setup.sh              # Interactive mode with colored output
#   ./verify-setup.sh --headless   # Automated mode (for LaunchAgent) with notifications
#   ./verify-setup.sh --test-keepalive  # Test server auto-restart

# --- Mode Detection ---
HEADLESS=false
TEST_KEEPALIVE=false

for arg in "$@"; do
    case $arg in
        --headless) HEADLESS=true ;;
        --test-keepalive) TEST_KEEPALIVE=true ;;
    esac
done

# --- Configuration ---
LOG_FILE="$HOME/.claude-history-server/verification.log"
INITIAL_DELAY=60      # Wait 60s before first check (headless only)
RETRY_DELAY=60        # Wait 60s between retries (headless only)
MAX_RETRIES=3         # Retry up to 3 times (headless only)

# Colors (only used in interactive mode)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# --- Helper Functions ---
log() {
    if [ "$HEADLESS" = true ]; then
        mkdir -p "$(dirname "$LOG_FILE")"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    fi
}

output() {
    if [ "$HEADLESS" = false ]; then
        echo -e "$1"
    fi
}

# --- Run All Verification Checks ---
# Returns: sets PASS, FAIL, FAILURES globals
run_checks() {
    PASS=0
    FAIL=0
    FAILURES=()

    check() {
        local name="$1"
        local result="$2"
        if [ "$result" = "true" ]; then
            output "  ${GREEN}✓${NC} $name"
            log "PASS: $name"
            ((PASS++))
        else
            output "  ${RED}✗${NC} $name"
            log "FAIL: $name"
            FAILURES+=("$name")
            ((FAIL++))
        fi
    }

    output ""
    output "=== Claude History Search Setup Verification ==="
    output ""

    # --- Server launchd ---
    output "Server (launchd):"

    # Check plist exists
    PLIST="$HOME/Library/LaunchAgents/com.claude-history-server.plist"
    check "Plist exists" "$([ -f "$PLIST" ] && echo true || echo false)"

    # Check plist is valid
    if [ -f "$PLIST" ]; then
        check "Plist is valid XML" "$(plutil -lint "$PLIST" >/dev/null 2>&1 && echo true || echo false)"
    fi

    # Check launchd loaded
    LAUNCHD_STATUS=$(launchctl list 2>/dev/null | grep "com.claude-history-server" || echo "")
    check "launchd job loaded" "$([ -n "$LAUNCHD_STATUS" ] && echo true || echo false)"

    # Check launchd running (has PID)
    if [ -n "$LAUNCHD_STATUS" ]; then
        PID=$(echo "$LAUNCHD_STATUS" | awk '{print $1}')
        check "launchd job running (PID: $PID)" "$([ "$PID" != "-" ] && echo true || echo false)"
    fi

    # Check server responds
    HEALTH=$(curl -s --max-time 5 http://localhost:3847/health 2>/dev/null || echo "")
    check "Server responds on :3847" "$(echo "$HEALTH" | grep -q '"status":"ok"' && echo true || echo false)"

    # Check server binds to all interfaces (service name is "msfw-control" for port 3847)
    # Use full path because /usr/sbin may not be in LaunchAgent PATH
    BIND=$(/usr/sbin/lsof -i :3847 2>/dev/null | grep -q "TCP \*:" && echo true || echo false)
    check "Server binds to 0.0.0.0 (all interfaces)" "$BIND"

    output ""

    # --- Mac App Login Item ---
    output "Mac App (Login Item):"

    # Check app exists
    APP_PATH="/Applications/ClaudeHistorySearchMac.app"
    check "App exists in /Applications" "$([ -d "$APP_PATH" ] && echo true || echo false)"

    # Check bundle ID
    if [ -d "$APP_PATH" ]; then
        BUNDLE_ID=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo "")
        check "Bundle ID is set ($BUNDLE_ID)" "$([ -n "$BUNDLE_ID" ] && echo true || echo false)"
    fi

    # Check login item registered
    LOGIN_ITEMS=$(osascript -e 'tell application "System Events" to get the name of every login item' 2>/dev/null || echo "")
    check "Registered as Login Item" "$(echo "$LOGIN_ITEMS" | grep -q "ClaudeHistorySearchMac" && echo true || echo false)"

    # Note: Removed sfltool dumpbtm check - it requires admin password which is
    # disruptive for automated runs. The Login Item check above is sufficient.

    output ""
}

# --- KeepAlive Test (interactive only) ---
run_keepalive_test() {
    output "KeepAlive test (killing server to verify auto-restart):"

    OLD_PID=$(launchctl list | grep "com.claude-history-server" | awk '{print $1}')
    if [ "$OLD_PID" != "-" ] && [ -n "$OLD_PID" ]; then
        output "  Killing server (PID $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 3

        NEW_STATUS=$(launchctl list 2>/dev/null | grep "com.claude-history-server" || echo "")
        NEW_PID=$(echo "$NEW_STATUS" | awk '{print $1}')

        if [ "$NEW_PID" != "-" ] && [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$OLD_PID" ]; then
            check "Server auto-restarted (new PID: $NEW_PID)" "true"
        else
            check "Server auto-restarted" "false"
        fi

        # Verify it responds after restart
        sleep 1
        HEALTH=$(curl -s --max-time 5 http://localhost:3847/health 2>/dev/null || echo "")
        check "Server healthy after restart" "$(echo "$HEALTH" | grep -q '"status":"ok"' && echo true || echo false)"
    else
        output "  ${YELLOW}⚠${NC} Skipped: server not running"
    fi
    output ""
}

# --- Main Execution ---

if [ "$HEADLESS" = true ]; then
    # Headless mode: initial delay + retry loop
    log "Waiting ${INITIAL_DELAY}s for server to start..."
    sleep "$INITIAL_DELAY"

    for attempt in $(seq 1 $MAX_RETRIES); do
        log "Starting verification (attempt $attempt/$MAX_RETRIES)..."
        run_checks

        if [ $FAIL -eq 0 ]; then
            # Success!
            log "VERIFICATION PASSED: All $PASS checks successful"
            osascript -e "display notification \"All $PASS checks passed\" with title \"Claude History: Ready\""
            exit 0
        fi

        if [ $attempt -lt $MAX_RETRIES ]; then
            FAIL_MSG=$(printf '%s\n' "${FAILURES[@]}" | head -3 | tr '\n' '; ' | sed 's/; $//')
            log "Attempt $attempt failed ($FAIL issues: $FAIL_MSG). Retrying in ${RETRY_DELAY}s..."
            sleep "$RETRY_DELAY"
        fi
    done

    # All retries exhausted - send failure notification
    log "VERIFICATION FAILED after $MAX_RETRIES attempts: $FAIL issue(s)"
    FAIL_MSG=$(printf '%s\n' "${FAILURES[@]}" | head -3 | tr '\n' '; ' | sed 's/; $//')
    log "Issues: $FAIL_MSG"
    osascript -e "display notification \"$FAIL_MSG\" with title \"Claude History Verification Failed\" sound name \"Basso\""
    exit 1

else
    # Interactive mode: run once
    run_checks

    if [ "$TEST_KEEPALIVE" = true ]; then
        run_keepalive_test
    fi

    # Summary
    output "=== Summary ==="
    output "  ${GREEN}Passed: $PASS${NC}"
    if [ $FAIL -gt 0 ]; then
        output "  ${RED}Failed: $FAIL${NC}"
        exit 1
    else
        output "  Failed: 0"
        output ""
        output "All checks passed! ✅"
        exit 0
    fi
fi

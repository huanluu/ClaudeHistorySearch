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
DELAY_SECONDS=15

# Colors (only used in interactive mode)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0
FAILURES=()

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

# --- Headless Mode: Wait for server startup ---
if [ "$HEADLESS" = true ]; then
    log "Waiting ${DELAY_SECONDS}s for server to start..."
    sleep "$DELAY_SECONDS"
    log "Starting verification..."
fi

# --- Interactive Header ---
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
BIND=$(lsof -i :3847 2>/dev/null | grep -q "TCP \*:" && echo true || echo false)
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

# Check BTM registration
BTM_ENTRY=$(sfltool dumpbtm 2>/dev/null | grep -A5 "ClaudeHistorySearchMac" | grep "Disposition" || echo "")
check "BTM entry enabled" "$(echo "$BTM_ENTRY" | grep -q "enabled" && echo true || echo false)"

output ""

# --- KeepAlive Test (optional, interactive only) ---
if [ "$TEST_KEEPALIVE" = true ] && [ "$HEADLESS" = false ]; then
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
fi

# --- Summary & Notifications ---
if [ $FAIL -gt 0 ]; then
    # Failure
    output "=== Summary ==="
    output "  ${GREEN}Passed: $PASS${NC}"
    output "  ${RED}Failed: $FAIL${NC}"

    log "VERIFICATION FAILED: $FAIL issue(s)"

    if [ "$HEADLESS" = true ]; then
        FAIL_MSG=$(printf '%s\n' "${FAILURES[@]}" | head -3 | tr '\n' '; ' | sed 's/; $//')
        log "Issues: $FAIL_MSG"
        osascript -e "display notification \"$FAIL_MSG\" with title \"Claude History Verification Failed\" sound name \"Basso\""
    fi

    exit 1
else
    # Success
    output "=== Summary ==="
    output "  ${GREEN}Passed: $PASS${NC}"
    output "  Failed: 0"
    output ""
    output "All checks passed! ✅"

    log "VERIFICATION PASSED: All $PASS checks successful"

    if [ "$HEADLESS" = true ]; then
        osascript -e "display notification \"All $PASS checks passed\" with title \"Claude History: Ready\""
    fi

    exit 0
fi

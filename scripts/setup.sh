#!/bin/bash
# One-step setup for Claude History Search
# Usage: ./scripts/setup.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$REPO_DIR/server"
PLIST_NAME="com.claude-history-server"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

step() { echo -e "\n${BOLD}[$1/6]${NC} $2"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo -e "${BOLD}Claude History Search — Setup${NC}"

# --- Preflight ---
step 1 "Checking prerequisites"

command -v node >/dev/null 2>&1 || fail "Node.js not found. Install with: brew install node"
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VERSION" -ge 18 ] || fail "Node.js 18+ required (found v$NODE_VERSION)"
ok "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || fail "npm not found"
ok "npm $(npm -v)"

if command -v claude >/dev/null 2>&1; then
  ok "Claude CLI found"
else
  warn "Claude CLI not found — live sessions won't work"
fi

command -v xcodebuild >/dev/null 2>&1 || fail "Xcode not found. Install from the Mac App Store"
ok "Xcode $(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}')"

# --- Install dependencies ---
step 2 "Installing server dependencies"

cd "$SERVER_DIR"
npm install --loglevel=warn
ok "Dependencies installed"

# --- Generate API key (if not already configured) ---
step 3 "Configuring API key"

CONFIG_FILE="$HOME/.claude-history-server/config.json"
if [ -f "$CONFIG_FILE" ] && grep -q '"apiKeyHash"' "$CONFIG_FILE" 2>/dev/null; then
  ok "API key already configured"
  echo -e "  Key file: ${BOLD}~/.claude-history-server/.api-key${NC}"
else
  npm run key:generate --silent
  ok "API key generated"
  echo -e "  Key file: ${BOLD}~/.claude-history-server/.api-key${NC}"
fi

# --- Install launchd service ---
step 4 "Installing launchd service"

# Stop existing service if loaded
if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
  if launchctl unload "$PLIST_PATH" 2>/dev/null; then
    ok "Stopped existing service"
  else
    warn "Could not unload existing service — may need to restart manually"
  fi
fi

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which npm)</string>
        <string>start</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(dirname "$(which node)"):/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>$SERVER_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/claude-history-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/claude-history-server.err</string>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"
ok "Service installed and started"

# --- Build and install Mac app ---
step 5 "Building Mac menu bar app (Release)"

APP_NAME="ClaudeHistorySearchMac"
BUILD_DIR="$REPO_DIR/build"
APP_SRC="$BUILD_DIR/Build/Products/Release/$APP_NAME.app"

echo "  Building... (this may take a minute)"
rm -rf "$APP_SRC"
BUILD_LOG=$(mktemp /tmp/xcodebuild-XXXXXXXX.log)
if xcodebuild -project "$REPO_DIR/ClaudeHistorySearch.xcodeproj" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$BUILD_DIR" \
  -destination 'platform=macOS' \
  build >"$BUILD_LOG" 2>&1; then
  ok "Build succeeded"
else
  echo "  Build log: $BUILD_LOG"
  tail -20 "$BUILD_LOG"
  fail "Xcode build failed. See log above or run xcodebuild manually"
fi
rm -f "$BUILD_LOG"

# Kill running instance, install to /Applications, relaunch
pkill -x "$APP_NAME" 2>/dev/null || true
sleep 1
TMP_APP=$(mktemp -d)/ClaudeHistorySearchMac.app
cp -R "$APP_SRC" "$TMP_APP" || fail "Failed to copy app bundle"
rm -rf "/Applications/$APP_NAME.app"
mv "$TMP_APP" "/Applications/$APP_NAME.app"
ok "Installed to /Applications/$APP_NAME.app"

open "/Applications/$APP_NAME.app"
ok "App launched — look for the menu bar icon"

# --- Verify ---
step 6 "Verifying"

sleep 2
if curl -s --max-time 5 http://localhost:3847/health | grep -qE '"status":"(healthy|degraded)"'; then
  ok "Server is running on port 3847"
else
  warn "Server not responding yet — check: tail -f /tmp/claude-history-server.err"
fi

if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  ok "Mac app is running"
else
  warn "Mac app not detected — check if it launched"
fi

# --- Done ---
echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "  Server:   http://localhost:3847"
echo "  Mac app:  /Applications/$APP_NAME.app"
echo "  Logs:     tail -f /tmp/claude-history-server.log"
echo "  API key:  cat ~/.claude-history-server/.api-key"
echo ""
echo "  Enter the API key in the Mac app's settings to connect."
echo ""

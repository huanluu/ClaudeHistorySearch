# Deploy

Deploy the server and/or Mac menu bar app. Invoked via `/deploy`.

## What It Does

1. **Reload the server** — Restart the launchd agent so it picks up the latest code from main
2. **Build and deploy the Mac app** — Archive a release build, copy to /Applications, and relaunch

## Steps

### Step 1: Reload the Server

```bash
# Restart the launchd agent (runs from main branch)
launchctl kickstart -k gui/$(id -u)/com.claude-history-server
```

Verify it's running:
```bash
sleep 1
curl -s http://localhost:3847/health | head -c 200
```

If the health check fails, check logs:
```bash
tail -20 /tmp/claude-history-server.err
```

### Step 2: Build Mac App (Release)

Build the Mac target in Release configuration using a local build directory to avoid DerivedData sprawl:

```bash
PROJECT_DIR=$(git rev-parse --show-toplevel)
xcodebuild -project "$PROJECT_DIR/ClaudeHistorySearch.xcodeproj" \
  -scheme ClaudeHistorySearchMac \
  -configuration Release \
  -derivedDataPath "$PROJECT_DIR/build" \
  -destination 'platform=macOS' \
  build
```

If the build fails, show the error output and stop.

### Step 3: Deploy Mac App

Kill the running app, copy the new build to /Applications, and relaunch:

```bash
PROJECT_DIR=$(git rev-parse --show-toplevel)
APP_SRC="$PROJECT_DIR/build/Build/Products/Release/ClaudeHistorySearchMac.app"

# Kill running instance
pkill -x ClaudeHistorySearchMac 2>/dev/null
sleep 1

# Copy to /Applications (overwrite existing)
rm -rf /Applications/ClaudeHistorySearchMac.app
cp -R "$APP_SRC" /Applications/ClaudeHistorySearchMac.app

# Relaunch
open /Applications/ClaudeHistorySearchMac.app
```

### Step 4: Verify

Report the results:
- Server: health check response
- Mac app: whether the build succeeded and the app was relaunched

## Notes

- The server runs from **main** via launchd — make sure changes are committed and on main before deploying
- The Mac app is built from the **current working tree** (including uncommitted changes) — this allows testing before committing
- The `build/` directory is gitignored and reused across deploys

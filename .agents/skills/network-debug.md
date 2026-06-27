# Network Debugging Guide

Use this skill when diagnosing iOS/Mac app connectivity issues with the Claude History server.

## Quick Diagnosis Commands

```bash
# Check server is running and binding correctly
curl http://localhost:3847/health
/usr/sbin/lsof -i :3847

# Get Mac's current IP
ipconfig getifaddr en0

# Check if Bonjour is advertising
dns-sd -B _claudehistory._tcp local.

# Test connectivity from specific URL
curl http://<ip-or-hostname>:3847/health
```

## Connection Matrix

| iPhone State | Can reach Mac? | Hostname (.local) works? | Solution |
|--------------|----------------|--------------------------|----------|
| USB connected to Mac | ✅ Always | ✅ Yes | Everything works |
| Same WiFi (home) | ✅ Yes | ✅ Yes | Auto-discovery works |
| Same WiFi (corpnet) | ✅ Yes | ❌ mDNS blocked | Use IP address |
| Different network (cellular) | ❌ No route | ❌ No | Must be on same network |

## USB Creates Full Network Bridge

When iPhone is connected to Mac via USB:
- macOS creates a virtual network interface
- Creates a **routable path** between iPhone ↔ Mac
- iPhone can reach Mac's IP addresses (including private 10.x.x.x)
- Both IP and hostname work over this tunnel
- Works regardless of WiFi/cellular state on either device

This is why the app works during Xcode deployment but may fail after unplugging.

## Corporate Network (Corpnet) Issues

### Symptoms
- Bonjour auto-discovery fails ("Searching..." forever)
- Hostname `.local` doesn't resolve
- Direct IP connection works fine

### Root Cause
Corporate networks typically block:
- **mDNS (multicast DNS)** on port 5353 - used for `.local` hostname resolution
- **Bonjour service discovery** - used for finding `_claudehistory._tcp` services

They usually allow:
- Direct TCP connections to IP addresses
- Standard ports like HTTP

### Solution
1. Use direct IP address instead of hostname:
   ```
   http://10.12.82.175:3847
   ```
2. The app caches the URL, so you only enter it once
3. If IP changes (rare on corpnet DHCP), update in Settings → Manual Connection

## mDNS vs DNS

| Feature | mDNS (.local) | Regular DNS |
|---------|---------------|-------------|
| Resolution | Multicast query on local network | DNS server lookup |
| Works on corpnet | ❌ Usually blocked | ✅ Yes |
| Works over USB | ✅ Yes | N/A |
| Works on home WiFi | ✅ Yes | ✅ Yes |

## Server-Side Issues

### "spawn claude ENOENT" Error
The server can't find the `claude` CLI.

**Cause:** LaunchAgent PATH doesn't include `~/.local/bin`

**Fix:** Add to `~/Library/LaunchAgents/com.claude-history-server.plist`:
```xml
<key>PATH</key>
<string>/Users/huanlu/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
```

Then reload:
```bash
launchctl bootout gui/$(id -u)/com.claude-history-server
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.claude-history-server.plist
```

### Server Not Binding to All Interfaces
Check with:
```bash
/usr/sbin/lsof -i :3847
```

Should show `TCP *:msfw-control` (the `*` means all interfaces).

## iOS App Settings

### Manual Connection
Settings → Manual Connection → Enter URL → Connect

The URL is cached in UserDefaults and persists across app launches.

### Verifying Connection
On app launch, `ServerDiscovery.verifyAndConnect()`:
1. Checks if cached URL responds to `/health`
2. If yes → uses cached URL
3. If no → tries Bonjour discovery
4. Falls back to showing "No server found"

## Debugging Checklist

1. **Is the server running?**
   ```bash
   curl http://localhost:3847/health
   ```

2. **Is it binding to all interfaces?**
   ```bash
   /usr/sbin/lsof -i :3847 | grep "TCP \*:"
   ```

3. **What's the Mac's IP?**
   ```bash
   ipconfig getifaddr en0
   ```

4. **Can iPhone reach the server?**
   - Open Safari on iPhone
   - Go to `http://<mac-ip>:3847/health`
   - Should see `{"status":"ok"...}`

5. **Is it a Bonjour issue?**
   - If Safari works but app doesn't auto-discover → Bonjour blocked
   - Use manual IP connection in Settings

6. **USB connected?**
   - If it works with USB but not without → network isolation issue
   - Both devices must be on same network (or USB connected)

# Node Binary Path Management

## Status: ⏸️ Paused (Blocked)

## Problem

Different projects need **specific Node binaries** (not just versions):
- `/Volumes/Office/Office2/...` → Office devshell Node at exact path
- `~/Developer/...` → Homebrew Node at `/opt/homebrew/bin/node`

This matters because:
- Office build system expects the devshell Node binary
- macOS firewall rules are **per-binary** (different binary = needs separate approval)
- Native modules are compiled against specific binaries

## Solution: direnv with PATH manipulation

### Why direnv (not fnm/nvm)?

| Tool | Issue |
|------|-------|
| **fnm/nvm** | Install their own Node binaries - can't point to arbitrary paths like Office's devshell |
| **direnv** | Modifies PATH per-directory using your **existing** binaries exactly as-is |

### How it works

When you `cd` into a directory, direnv automatically:
1. Looks for `.envrc` in current or parent directories
2. Modifies your PATH to prepend the specified Node binary path
3. Reverts PATH when you leave the directory

```fish
cd ~/Developer/ClaudeHistorySearch
node --version  # → v25.x (Homebrew)
which node      # → /opt/homebrew/bin/node

cd /Volumes/Office/Office2/src/some-project
node --version  # → v24.x (Office devshell)
which node      # → /Volumes/Office/Office2/builds/devmain/npm/.devshell/.../bin/node
```

---

## Implementation Plan

### Step 1: Install direnv
```fish
brew install direnv
```

### Step 2: Configure fish shell
**File:** `~/.config/fish/config.fish`

Add at the end:
```fish
# direnv - auto-switch PATH per directory
direnv hook fish | source
```

### Step 3: Create `.envrc` for Office projects
**File:** `/Volumes/Office/Office2/.envrc`
```bash
# Use Office devshell Node
PATH_add /Volumes/Office/Office2/builds/devmain/npm/.devshell/node.js-24.darwin.24.12.0/bin
```

Then allow it:
```fish
cd /Volumes/Office/Office2
direnv allow
```

### Step 4: Create `.envrc` for personal projects
**File:** `/Users/huanlu/Developer/.envrc`
```bash
# Use Homebrew Node for all ~/Developer projects
PATH_add /opt/homebrew/bin
```

Then allow it:
```fish
cd ~/Developer
direnv allow
```

---

## Progress

- [x] Identified direnv as the right tool
- [x] Planned fish shell configuration
- [x] Planned `.envrc` file locations and content
- [ ] **BLOCKED:** Install direnv via Homebrew

---

## Blocker

**Xcode Command Line Tools are outdated**

```
Error: Your Command Line Tools are too outdated.
Update them from Software Update in System Settings.
```

Homebrew can't build direnv from source without updated CLI tools.

### Resolution

Run these commands, then retry:
```fish
sudo rm -rf /Library/Developer/CommandLineTools
sudo xcode-select --install
```

After CLI tools are updated:
```fish
brew install direnv
```

---

## Verification (after unblocked)

```fish
# Reload fish config
source ~/.config/fish/config.fish

# Verify auto-switching:
cd ~/Developer/ClaudeHistorySearch
which node      # Should show /opt/homebrew/bin/node
node --version  # Should show v25.x

cd /Volumes/Office/Office2
which node      # Should show Office devshell path
node --version  # Should show v24.x
```

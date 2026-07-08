# Assistant Adapter (`shared/infra/assistant/`)

## Why

The assistant feature needs a real LLM backend that can hold multi-turn conversations, call tools, and access external services (calendar, ADO, MS Graph) via MCP servers. This adapter bridges the feature's `AssistantBackend` port to the GitHub Copilot SDK, which spawns the Copilot runtime as a persistent subprocess.

## What

| File | Purpose |
|------|---------|
| `CopilotAssistantBackend.ts` | Adapter implementing `AssistantBackend` via `@github/copilot-sdk`. One Copilot session per conversation, reused across turns |
| `cronMcpTools.ts` | Copilot custom tools exposing cron management (create/list/delete/run jobs). Passed to the SDK as session tools |

## How

### Session Lifecycle

1. First message for a `conversationId` → `CopilotClient.createSession()` creates a Copilot session
2. Each subsequent message → sent to the existing `CopilotSession`
3. SDK manages full conversation context internally (no manual history tracking)
4. Sessions persist across client disconnects; destroyed on abort or explicit cleanup

### MCP Server Integration

The SDK session config accepts:
- **Custom tools** (`tools: Tool[]`): Tools defined in code, e.g. cron management
- **Stdio MCP servers** (`mcpServers`): External MCP servers like Work IQ (`{ command, args, env }`)

Tools and MCP servers are wired in `app.ts` and passed to the backend constructor. The SDK connects to them and exposes their tools to the assistant.

### Permission Mode

**Always provide `onPermissionRequest: approveAll` for the headless assistant session.**

The SDK subprocess runs headless with no interactive terminal. Without an approval handler, MCP/tool calls can trigger permission prompts that have no UI to approve, causing the tool call to hang or fail silently.

This is safe because: the server is a local-only, single-user system behind API key auth. The assistant's tool access is already scoped by the `tools` array.

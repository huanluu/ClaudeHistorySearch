# Assistant Adapter (`shared/infra/assistant/`)

## Why

The assistant feature needs a real LLM backend that can hold multi-turn conversations, call tools, and access external services (calendar, ADO, MS Graph) via MCP servers. This adapter bridges the feature's `AssistantBackend` port to the Claude Agent SDK, which spawns Claude CLI as a persistent subprocess.

## What

| File | Purpose |
|------|---------|
| `SdkAssistantBackend.ts` | Adapter implementing `AssistantBackend` via `@anthropic-ai/claude-agent-sdk` streaming input mode. One persistent subprocess per conversation, reused across turns |
| `translateSdkEvent.ts` | Stateful translator from SDK message types to `AssistantEvent` (the feature's domain type). Handles mid-stream `assistant` messages, turn boundaries, and session ID tracking |
| `cronMcpTools.ts` | In-process MCP server exposing cron management tools (create/list/delete jobs). Created via `createSdkMcpServer()` and passed to the SDK |

## How

### Session Lifecycle

1. First message for a `conversationId` → `createSession()` spawns a new SDK subprocess via `query()`
2. Each subsequent message → pushed to the session's async generator channel
3. SDK manages full conversation context internally (no manual history tracking)
4. Sessions persist across client disconnects; destroyed on abort or explicit cleanup

### MCP Server Integration

The SDK's `query()` accepts `mcpServers: Record<string, McpServerConfig>` which can be:
- **In-process** (`McpSdkServerConfigWithInstance`): Tools defined in code, e.g., cron management
- **Stdio** (`McpStdioServerConfig`): External MCP servers like Work IQ (`{ command, args, env }`)

MCP servers are wired in `app.ts` and passed to the backend constructor. The SDK connects to them and exposes their tools to the assistant.

### Permission Mode

**Always use `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true`.**

The SDK subprocess runs headless with no interactive terminal. Without bypass mode, MCP tool calls (e.g., `mcp__work-iq__ask_work_iq`) trigger permission prompts that have no UI to approve them, causing the tool call to hang or fail silently. The generic `allowedTools: ['Mcp']` only approves the built-in Mcp routing tool, not individual MCP server tools which use `mcp__<server>__<tool>` naming.

This is safe because: the server is a local-only, single-user system behind API key auth. The assistant's tool access is already scoped by the `tools` array.

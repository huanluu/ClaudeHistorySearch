# Architecture Review

## Summary
This system uses a local client-server architecture to index and search Claude CLI sessions. A TypeScript server handles indexing, full-text search, and live sessions, while iOS/macOS SwiftUI apps consume REST and WebSocket APIs using a shared Swift package.

## GPT-5.2-Codex Findings
### Strengths
- Clear separation: server (indexing/search/live) + SwiftUI clients + shared Swift package.
- Hybrid REST + WebSocket flow matches historical vs. live sessions.
- Shared package reduces iOS/Mac duplication; Bonjour discovery improves UX.

### Risks
- Optional API key means unauthenticated access by default.
- WebSocket auth via query param can leak via logs/proxies.
- JSONL schema changes could break indexing; watcher reliability depends on periodic reindex.

### Recommendations
- Enforce API key by default; move WS auth to headers or an auth message.
- Use shared, typed API contracts (OpenAPI/Swift Codable models).
- Add structured logs/metrics for indexing and live sessions.

## Gemini-3-Pro Findings
### Strengths
- Streaming JSONL parsing + SQLite FTS5 for efficient indexing/search.
- Shared Swift package is a strong modular boundary.
- Bonjour discovery enables low-friction setup.

### Risks
- Tight coupling to Claude JSONL format.
- AppleScript terminal integration can be fragile (permissions, terminal app changes).
- Node runtime dependency complicates distribution.

### Recommendations
- Package server as a standalone binary to simplify deployment.
- Add schema validation for JSONL ingestion.
- Use WebSocket for push updates when new sessions are indexed.

## Synthesized Recommendations
1. **Security**: Make API key mandatory by default and avoid query-parameter auth for WebSockets.
2. **Robust ingestion**: Add schema validation and graceful handling for JSONL format changes.
3. **Distribution/UX**: Consider a packaged server binary and push-based WS updates for freshness.
4. **Contracts & observability**: Formalize API schemas and add structured logging/metrics.

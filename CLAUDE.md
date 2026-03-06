# ClaudeScope — DevTools for Claude API & Claude Code

## Project Structure
```
packages/
  proxy/    — Core proxy server (HTTP proxy + REST API + WebSocket + SQLite)
  sdk/      — Lightweight SDK wrapper for Anthropic client
  ui/       — React SPA dashboard (Vite + Tailwind + Recharts)
```

## Build
```bash
pnpm build                    # Build all packages (UI → SDK → Proxy)
pnpm --filter @claude-scope/proxy build   # Build proxy only
pnpm --filter @claude-scope/ui build      # Build UI only
pnpm --filter @claude-scope/sdk build     # Build SDK only
```

## Test
```bash
pnpm test                     # Run full integration test suite (51 tests)
# Or directly:
node packages/proxy/test/integration.test.mjs
```

The integration tests cover: server startup, API ingest, session listing, trace retrieval, stats calculation, export (JSON/MD/HTML), config get/set, proxy forwarding, API key sanitization, WebSocket, UI serving, CORS, and data clearing.

## Run
```bash
node packages/proxy/dist/cli.js              # Start with auto-open browser
node packages/proxy/dist/cli.js --no-open    # Start without browser
node packages/proxy/dist/cli.js --port 3200  # Custom port
node packages/proxy/dist/cli.js --proxy http://host:port  # Explicit HTTP proxy
node packages/proxy/dist/cli.js --no-proxy   # Disable proxy (ignore env vars)
```

## Key Architecture Decisions
- Proxy and UI communicate only via REST + WebSocket (no direct imports)
- SQLite via sql.js (pure WASM, no native deps) for portability
- API keys sanitized to `sk-ant***xxxx` format before storage
- SSE chunks reassembled into complete response for storage
- Session auto-split after 5 minutes of inactivity
- HTTP proxy support: auto-detect from HTTPS_PROXY env, or manual --proxy/--no-proxy
- CONNECT tunnel for HTTPS targets through HTTP proxy (TLS preserved end-to-end)
- Supports both API key (x-api-key) and OAuth/Bearer token (Claude Max) authentication

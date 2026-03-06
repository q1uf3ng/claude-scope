import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { ServerConfig } from './types.js'
import { initDb } from './db.js'
import { initWebSocket } from './ws.js'
import { createProxyHandler } from './proxy.js'
import { handleApiRoute } from './api.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function serveStatic(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath)) return false

  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return false

    const ext = extname(filePath)
    const mime = MIME_TYPES[ext] || 'application/octet-stream'
    const content = readFileSync(filePath)

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
    })
    res.end(content)
    return true
  } catch {
    return false
  }
}

export async function startServer(config: ServerConfig): Promise<void> {
  // Initialize database
  await initDb(config.dbPath)

  // Create proxy handler
  const proxyHandler = createProxyHandler(config.target, config.proxy)

  // Resolve UI static dir
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  // UI dist should be copied or symlinked into the proxy package at build time
  const uiDistDir = join(__dirname, '..', 'ui-dist')

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/'
    const path = url.split('?')[0]

    try {
      // 1. API routes take priority
      if (path.startsWith('/api/')) {
        const handled = await handleApiRoute(req, res, path)
        if (handled) return
      }

      // 2. Proxy: forward /v1/* to Anthropic
      if (path.startsWith('/v1/')) {
        await proxyHandler(req, res)
        return
      }

      // 3. Serve static UI files
      if (existsSync(uiDistDir)) {
        // Try exact file
        const filePath = join(uiDistDir, path === '/' ? 'index.html' : path)
        if (serveStatic(res, filePath)) return

        // SPA fallback: serve index.html for non-file paths
        if (!extname(path)) {
          const indexPath = join(uiDistDir, 'index.html')
          if (serveStatic(res, indexPath)) return
        }
      }

      // 4. Fallback: simple status page
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html>
<html>
<head><title>ClaudeScope</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0d1117; color: #e6edf3;
    display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .container { text-align: center; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  p { color: #8b949e; }
  code { background: #161b22; padding: 2px 8px; border-radius: 4px; font-size: 0.9rem; }
  .status { color: #3fb950; }
</style>
</head>
<body>
<div class="container">
  <h1>ClaudeScope</h1>
  <p class="status">Proxy is running</p>
  <p>Set your Anthropic SDK base URL to:</p>
  <p><code>http://localhost:${config.port}</code></p>
  <p style="margin-top: 2rem; font-size: 0.85rem;">
    UI not built yet. Run <code>pnpm build</code> in the project root.
  </p>
</div>
</body>
</html>`)
    } catch (err) {
      console.error('[ClaudeScope] Server error:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    }
  })

  // Initialize WebSocket
  initWebSocket(server)

  // Start listening
  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.port} is already in use. Try: npx claude-scope --port ${config.port + 1}`))
      } else {
        reject(err)
      }
    })
    server.listen(config.port, config.host, () => {
      resolve()
    })
  })

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           ClaudeScope is running             ║
  ╠══════════════════════════════════════════════╣
  ║  Dashboard:  http://localhost:${String(config.port).padEnd(5)}          ║
  ║  Proxy API:  http://localhost:${String(config.port).padEnd(5)}/v1       ║
  ║  WebSocket:  ws://localhost:${String(config.port).padEnd(5)}/ws        ║
  ╠══════════════════════════════════════════════╣
  ║  Set ANTHROPIC_BASE_URL to:                  ║
  ║  http://localhost:${String(config.port).padEnd(5)}                     ║
  ╚══════════════════════════════════════════════╝
`)
}

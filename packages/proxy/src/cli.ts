#!/usr/bin/env node

import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ServerConfig } from './types.js'
import { startServer } from './server.js'

function parseArgs(args: string[]): Partial<ServerConfig> & { command?: string } {
  const config: Partial<ServerConfig> & { command?: string } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--port' || arg === '-p') {
      config.port = parseInt(args[++i], 10)
    } else if (arg === '--host') {
      config.host = args[++i]
    } else if (arg === '--no-open') {
      config.autoOpen = false
    } else if (arg === '--target') {
      config.target = args[++i]
    } else if (arg === '--proxy') {
      config.proxy = args[++i]
    } else if (arg === '--no-proxy') {
      config.proxy = ''  // empty string = disable proxy
    } else if (arg === '--db') {
      config.dbPath = args[++i]
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg === '--version' || arg === '-v') {
      console.log('claude-scope v0.1.0')
      process.exit(0)
    } else if (!arg.startsWith('-')) {
      config.command = arg
    }
  }

  return config
}

function printHelp(): void {
  console.log(`
  ClaudeScope — DevTools for Claude API & Claude Code

  Usage:
    claude-scope                  Start proxy + dashboard
    claude-scope sessions         List all sessions
    claude-scope clear            Clear all trace data
    claude-scope export <id>      Export session (--format json|md|html)

  Options:
    --port, -p <port>   Port number (default: 3100)
    --host <host>       Host to bind (default: localhost)
    --no-open           Don't auto-open browser
    --target <url>      Anthropic API target (default: https://api.anthropic.com)
    --proxy <url>       HTTP proxy for outbound requests (auto-detected from env)
    --no-proxy          Disable proxy (ignore HTTPS_PROXY env var)
    --db <path>         Database path (default: ~/.claude-scope/traces.db)
    --help, -h          Show help
    --version, -v       Show version

  Environment Variables:
    HTTPS_PROXY / HTTP_PROXY    Auto-detected for outbound proxy
    NO_PROXY                    Hosts to bypass proxy (comma-separated)
    CLAUDE_SCOPE_DEBUG          Enable debug logging (set to 1)
`)
}

async function main(): Promise<void> {
  // Check Node.js version
  const nodeVersion = parseInt(process.versions.node.split('.')[0], 10)
  if (nodeVersion < 18) {
    console.error(`Error: Node.js 18+ required (current: ${process.versions.node})`)
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))

  const config: ServerConfig = {
    port: args.port || 3100,
    host: args.host || 'localhost',
    target: args.target || 'https://api.anthropic.com',
    dbPath: args.dbPath || join(homedir(), '.claude-scope', 'traces.db'),
    autoOpen: args.autoOpen !== false,
    budgetDaily: null,
    proxy: args.proxy !== undefined ? args.proxy : null,  // null = auto-detect from env
  }

  if (args.command === 'clear') {
    const { initDb, clearAllData } = await import('./db.js')
    await initDb(config.dbPath)
    clearAllData()
    console.log('All trace data cleared.')
    process.exit(0)
  }

  if (args.command === 'sessions') {
    const { initDb, getSessions } = await import('./db.js')
    await initDb(config.dbPath)
    const sessions = getSessions()
    if (sessions.length === 0) {
      console.log('No sessions found.')
    } else {
      console.log(`\n  Sessions (${sessions.length}):\n`)
      for (const s of sessions) {
        const date = new Date(s.started_at).toLocaleString()
        console.log(`  ${s.id.slice(0, 8)}  ${date}  ${s.span_count} calls  ${s.models_used.join(', ') || 'n/a'}`)
      }
      console.log()
    }
    process.exit(0)
  }

  // Export command: claude-scope export <session-id> --format json|md|html
  if (args.command === 'export') {
    const sessionId = process.argv.find((a, i) => i > 2 && !a.startsWith('-') && a !== 'export')
    if (!sessionId) {
      console.error('Usage: claude-scope export <session-id> [--format json|md|html]')
      process.exit(1)
    }

    const formatIdx = process.argv.indexOf('--format')
    const format = formatIdx !== -1 ? process.argv[formatIdx + 1] || 'json' : 'json'

    const { initDb } = await import('./db.js')
    await initDb(config.dbPath)

    const { exportJSON, exportMarkdown, exportHTML } = await import('./export.js')

    let output: string
    let filename: string
    switch (format) {
      case 'md':
      case 'markdown':
        output = exportMarkdown(sessionId)
        filename = `claude-scope-${sessionId.slice(0, 8)}.md`
        break
      case 'html':
        output = exportHTML(sessionId)
        filename = `claude-scope-${sessionId.slice(0, 8)}.html`
        break
      default:
        output = exportJSON(sessionId)
        filename = `claude-scope-${sessionId.slice(0, 8)}.json`
    }

    const { writeFileSync } = await import('node:fs')
    writeFileSync(filename, output)
    console.log(`Exported to ${filename}`)
    process.exit(0)
  }

  // Default: start server
  try {
    await startServer(config)

    if (config.autoOpen) {
      try {
        const open = (await import('open')).default
        await open(`http://localhost:${config.port}`)
      } catch {
        // Non-critical: browser might not open in headless environments
      }
    }
  } catch (err) {
    console.error(`\n  Error: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

main()

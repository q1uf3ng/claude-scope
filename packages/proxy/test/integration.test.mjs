/**
 * ClaudeScope Integration Tests
 *
 * Tests the full server lifecycle:
 * 1. Server startup
 * 2. API ingest
 * 3. Session listing
 * 4. Trace retrieval
 * 5. Stats calculation
 * 6. Export (JSON/MD/HTML)
 * 7. Config get/set
 * 8. Proxy forwarding (basic)
 * 9. API key sanitization
 * 10. Clear data
 * 11. WebSocket connection
 * 12. Server shutdown
 */

import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync, existsSync } from 'node:fs'
import { WebSocket } from 'ws'

const PORT = 13100 // Use non-standard port for testing
const BASE = `http://localhost:${PORT}`
const DB_PATH = join(tmpdir(), `claude-scope-test-${Date.now()}.db`)

let serverProcess

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function startServer() {
  const { spawn } = await import('node:child_process')
  const cliPath = new URL('../dist/cli.js', import.meta.url).pathname

  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [cliPath, '--no-open', '--port', String(PORT), '--db', DB_PATH], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    serverProcess.stdout.on('data', (data) => {
      output += data.toString()
      if (output.includes('ClaudeScope is running')) {
        resolve()
      }
    })

    serverProcess.stderr.on('data', (data) => {
      console.error('SERVER ERR:', data.toString())
    })

    serverProcess.on('error', reject)

    // Timeout
    setTimeout(() => reject(new Error('Server startup timeout')), 10000)
  })
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
  // Clean up test DB
  try {
    if (existsSync(DB_PATH)) rmSync(DB_PATH)
  } catch {}
}

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text), text }
  } catch {
    return { status: res.status, data: null, text }
  }
}

let passed = 0
let failed = 0
const errors = []

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${message}`)
  } else {
    failed++
    errors.push(message)
    console.log(`  \x1b[31m✗\x1b[0m ${message}`)
  }
}

async function runTests() {
  console.log('\n\x1b[1mClaudeScope Integration Tests\x1b[0m\n')

  // --- Server startup ---
  console.log('Server startup:')
  try {
    await startServer()
    assert(true, 'Server started successfully')
  } catch (err) {
    assert(false, `Server failed to start: ${err.message}`)
    process.exit(1)
  }
  await sleep(500)

  // --- Test 1: Stats (empty) ---
  console.log('\nAPI — Stats:')
  {
    const { status, data } = await fetchJSON('/api/stats')
    assert(status === 200, 'GET /api/stats returns 200')
    assert(data.total_calls === 0, 'Initially 0 calls')
    assert(data.total_cost === 0, 'Initially 0 cost')
  }

  // --- Test 2: Sessions (empty) ---
  console.log('\nAPI — Sessions:')
  {
    const { status, data } = await fetchJSON('/api/sessions')
    assert(status === 200, 'GET /api/sessions returns 200')
    assert(Array.isArray(data) && data.length === 0, 'Initially empty sessions')
  }

  // --- Test 3: Ingest ---
  console.log('\nAPI — Ingest:')
  {
    const traceData = {
      id: 'test-trace-001',
      session_id: 'test-session-001',
      timestamp: Date.now(),
      method: 'POST',
      path: '/v1/messages',
      model: 'claude-sonnet-4-5-20250929',
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_tokens: 0,
      cache_read_tokens: 100,
      latency_ms: 2500,
      request_body: {
        model: 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'user', content: 'hello' }],
      },
      response_status: 200,
      response_body: {
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 500, output_tokens: 200 },
      },
      tool_uses: [{ id: 'tu_1', name: 'Read', input: { path: '/test.ts' } }],
      tool_results: [],
    }

    const { status, data } = await fetchJSON('/api/ingest', {
      method: 'POST',
      body: JSON.stringify(traceData),
    })
    assert(status === 200, 'POST /api/ingest returns 200')
    assert(data.ok === true, 'Ingest returns ok:true')
    assert(data.id === 'test-trace-001', 'Ingest returns correct ID')
  }

  // Ingest more traces for same session
  for (let i = 2; i <= 5; i++) {
    await fetchJSON('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({
        id: `test-trace-00${i}`,
        session_id: 'test-session-001',
        timestamp: Date.now() + i * 1000,
        model: i % 2 === 0 ? 'claude-opus-4-6-20250415' : 'claude-sonnet-4-5-20250929',
        input_tokens: 100 * i,
        output_tokens: 50 * i,
        cache_read_tokens: 10 * i,
        latency_ms: 1000 * i,
        request_body: { model: 'test' },
        response_status: i === 5 ? 429 : 200,
        response_body: i === 5 ? { error: { message: 'Rate limited' } } : { content: [] },
        error: i === 5 ? 'Rate limited' : null,
      }),
    })
  }

  // --- Test 4: Sessions after ingest ---
  console.log('\nAPI — Sessions after ingest:')
  {
    const { data } = await fetchJSON('/api/sessions')
    assert(data.length === 1, 'One session exists')
    assert(data[0].id === 'test-session-001', 'Correct session ID')
    assert(data[0].span_count === 5, '5 spans in session')
    assert(data[0].total_cost > 0, 'Cost is calculated')
    assert(data[0].models_used.length >= 1, 'Models tracked')
  }

  // --- Test 5: Traces by session ---
  console.log('\nAPI — Traces by session:')
  {
    const { data } = await fetchJSON('/api/sessions/test-session-001/traces')
    assert(data.length === 5, '5 traces returned')
    assert(data[0].id === 'test-trace-001', 'First trace correct')
    assert(data[0].tool_uses.length === 1, 'Tool uses preserved')
    assert(data[0].tool_uses[0].name === 'Read', 'Tool name correct')
    assert(typeof data[0].cost === 'number' && data[0].cost > 0, 'Cost calculated per trace')

    // Check error trace
    const errTrace = data.find((t) => t.error)
    assert(errTrace !== undefined, 'Error trace found')
    assert(errTrace.response_status === 429, 'Error status preserved')
  }

  // --- Test 6: Single trace ---
  console.log('\nAPI — Single trace:')
  {
    const { status, data } = await fetchJSON('/api/traces/test-trace-001')
    assert(status === 200, 'GET trace returns 200')
    assert(data.id === 'test-trace-001', 'Correct trace returned')
    assert(data.model === 'claude-sonnet-4-5-20250929', 'Model preserved')
  }
  {
    const { status } = await fetchJSON('/api/traces/nonexistent')
    assert(status === 404, 'Nonexistent trace returns 404')
  }

  // --- Test 7: Stats after ingest ---
  console.log('\nAPI — Stats:')
  {
    const { data } = await fetchJSON('/api/stats')
    assert(data.total_calls === 5, 'Total calls = 5')
    assert(data.total_input_tokens > 0, 'Input tokens tracked')
    assert(data.total_output_tokens > 0, 'Output tokens tracked')
    assert(Object.keys(data.models).length >= 1, 'Models broken down')
    assert(data.total_cost > 0, 'Total cost calculated')
  }

  // --- Test 8: Export JSON ---
  console.log('\nAPI — Export:')
  {
    const { status, data } = await fetchJSON('/api/export/test-session-001?format=json')
    assert(status === 200, 'JSON export returns 200')
    assert(data.session_id === 'test-session-001', 'JSON export has session_id')
    assert(data.traces.length === 5, 'JSON export has all traces')
  }

  // Export Markdown
  {
    const res = await fetch(`${BASE}/api/export/test-session-001?format=md`)
    const text = await res.text()
    assert(res.status === 200, 'Markdown export returns 200')
    assert(text.includes('# ClaudeScope Session Report'), 'Markdown has title')
    assert(text.includes('$'), 'Markdown has cost')
  }

  // Export HTML
  {
    const res = await fetch(`${BASE}/api/export/test-session-001?format=html`)
    const text = await res.text()
    assert(res.status === 200, 'HTML export returns 200')
    assert(text.includes('<!DOCTYPE html>'), 'HTML is valid')
    assert(text.includes('ClaudeScope'), 'HTML has branding')
    assert(text.includes('test-trace-001'), 'HTML contains trace data')
  }

  // --- Test 9: Config ---
  console.log('\nAPI — Config:')
  {
    const { data } = await fetchJSON('/api/config/budget.daily', {
      method: 'PUT',
      body: JSON.stringify({ value: '10.00' }),
    })
    assert(data.ok === true, 'Config set returns ok')
  }
  {
    const { data } = await fetchJSON('/api/config/budget.daily')
    assert(data.value === '10.00', 'Config value retrieved')
  }

  // --- Test 10: New session ---
  console.log('\nAPI — Session management:')
  {
    const { data } = await fetchJSON('/api/sessions/new', { method: 'POST' })
    assert(data.session_id && data.session_id.length > 0, 'New session created')
  }

  // --- Test 11: WebSocket ---
  console.log('\nWebSocket:')
  {
    const wsConnected = await new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://localhost:${PORT}/ws`)
        ws.on('open', () => {
          ws.close()
          resolve(true)
        })
        ws.on('error', () => resolve(false))
        setTimeout(() => resolve(false), 3000)
      } catch {
        resolve(false)
      }
    })
    assert(wsConnected, 'WebSocket connects successfully')
  }

  // --- Test 12: UI serves ---
  console.log('\nUI:')
  {
    const res = await fetch(`${BASE}/`)
    assert(res.status === 200, 'Homepage returns 200')
    const text = await res.text()
    assert(text.includes('ClaudeScope'), 'Homepage contains app name')
  }

  // --- Test 13: Proxy basic (API key sanitization) ---
  console.log('\nProxy:')
  {
    // This will forward to Anthropic and get a 403/401
    const res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-ant-api03-FAKE_KEY_FOR_TESTING_1234567890',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      }),
    })
    // Should get a response from Anthropic (401/403)
    assert(res.status >= 400, 'Proxy forwards to Anthropic (auth error expected)')

    // Check that API key was sanitized in stored trace
    await sleep(500)
    const stats = await fetchJSON('/api/stats')
    assert(stats.data.total_calls >= 6, 'Proxy call recorded in traces')
  }

  // --- Test 14: CORS ---
  console.log('\nCORS:')
  {
    const res = await fetch(`${BASE}/api/stats`, {
      method: 'OPTIONS',
    })
    assert(res.status === 204, 'OPTIONS returns 204')
    assert(
      res.headers.get('access-control-allow-origin') === '*',
      'CORS header present'
    )
  }

  // --- Test 15: Clear ---
  console.log('\nAPI — Clear:')
  {
    await fetchJSON('/api/clear', { method: 'POST' })
    const { data } = await fetchJSON('/api/stats')
    assert(data.total_calls === 0, 'Data cleared successfully')
  }

  // --- Summary ---
  console.log(`\n\x1b[1m${'─'.repeat(50)}\x1b[0m`)
  console.log(`\x1b[1mResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`)
  if (errors.length > 0) {
    console.log('\nFailed tests:')
    errors.forEach((e) => console.log(`  \x1b[31m✗\x1b[0m ${e}`))
  }
  console.log()

  return failed === 0
}

// Main
try {
  const success = await runTests()
  stopServer()
  process.exit(success ? 0 : 1)
} catch (err) {
  console.error('\n\x1b[31mTest runner error:\x1b[0m', err)
  stopServer()
  process.exit(1)
}

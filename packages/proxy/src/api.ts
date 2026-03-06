import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  getSessions,
  getTracesBySession,
  getTrace,
  getStats,
  getDailyCosts,
  clearAllData,
  setConfig,
  getConfig,
  insertTrace,
  ensureSession,
} from './db.js'
import { calculateCost } from './pricing.js'
import { forceNewSession, getCurrentSessionId } from './session-manager.js'
import type { TraceRecord } from './types.js'
import { randomUUID } from 'node:crypto'
import { sanitizeHeaders } from './sanitize.js'
import { exportJSON, exportMarkdown, exportHTML } from './export.js'

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string
): Promise<boolean> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    })
    res.end()
    return true
  }

  // GET /api/sessions — list sessions
  if (path === '/api/sessions' && req.method === 'GET') {
    const sessions = getSessions()
    // Calculate costs for each session
    const enriched = sessions.map((s) => {
      let totalCost = 0
      for (const model of s.models_used) {
        // Approximate: divide tokens equally among models (refined in detail view)
        totalCost += calculateCost(
          model,
          s.total_input_tokens / s.models_used.length,
          s.total_output_tokens / s.models_used.length,
          s.total_cache_creation_tokens / s.models_used.length,
          s.total_cache_read_tokens / s.models_used.length
        )
      }
      if (s.models_used.length === 0 && s.total_input_tokens > 0) {
        totalCost = calculateCost('unknown', s.total_input_tokens, s.total_output_tokens, s.total_cache_creation_tokens, s.total_cache_read_tokens)
      }
      return { ...s, total_cost: totalCost }
    })
    json(res, enriched)
    return true
  }

  // GET /api/sessions/:id/traces — get traces for a session
  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/traces$/)
  if (sessionMatch && req.method === 'GET') {
    const traces = getTracesBySession(sessionMatch[1])
    const enriched = traces.map((t, index) => ({
      ...t,
      index,
      cost: t.model
        ? calculateCost(t.model, t.input_tokens, t.output_tokens, t.cache_creation_tokens, t.cache_read_tokens)
        : 0,
    }))
    json(res, enriched)
    return true
  }

  // GET /api/traces/:id — get single trace
  const traceMatch = path.match(/^\/api\/traces\/([^/]+)$/)
  if (traceMatch && req.method === 'GET') {
    const trace = getTrace(traceMatch[1])
    if (!trace) {
      json(res, { error: 'Not found' }, 404)
    } else {
      json(res, {
        ...trace,
        cost: trace.model
          ? calculateCost(trace.model, trace.input_tokens, trace.output_tokens, trace.cache_creation_tokens, trace.cache_read_tokens)
          : 0,
      })
    }
    return true
  }

  // GET /api/stats — global stats
  if (path === '/api/stats' && req.method === 'GET') {
    const stats = getStats()
    let totalCost = 0
    for (const [model, count] of Object.entries(stats.models)) {
      // This is approximate; for exact cost per call we'd need to iterate all traces
      totalCost += calculateCost(
        model,
        stats.total_input_tokens * (count / stats.total_calls),
        stats.total_output_tokens * (count / stats.total_calls),
        stats.total_cache_creation_tokens * (count / stats.total_calls),
        stats.total_cache_read_tokens * (count / stats.total_calls)
      )
    }

    json(res, {
      ...stats,
      total_cost: totalCost,
      current_session_id: getCurrentSessionId(),
    })
    return true
  }

  // GET /api/stats/daily — daily costs
  if (path === '/api/stats/daily' && req.method === 'GET') {
    const daily = getDailyCosts()
    json(res, daily)
    return true
  }

  // POST /api/sessions/new — force new session
  if (path === '/api/sessions/new' && req.method === 'POST') {
    const id = forceNewSession()
    json(res, { session_id: id })
    return true
  }

  // POST /api/ingest — SDK ingest endpoint
  if (path === '/api/ingest' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const data = JSON.parse(body) as Partial<TraceRecord>

      const trace: TraceRecord = {
        id: data.id || randomUUID(),
        session_id: data.session_id || getCurrentSessionId() || randomUUID(),
        timestamp: data.timestamp || Date.now(),
        method: data.method || 'POST',
        path: data.path || '/v1/messages',
        request_headers: sanitizeHeaders((data.request_headers || {}) as Record<string, string>),
        request_body: data.request_body || {},
        response_status: data.response_status || 200,
        response_headers: data.response_headers || {},
        response_body: data.response_body || {},
        model: data.model || null,
        input_tokens: data.input_tokens || 0,
        output_tokens: data.output_tokens || 0,
        cache_creation_tokens: data.cache_creation_tokens || 0,
        cache_read_tokens: data.cache_read_tokens || 0,
        latency_ms: data.latency_ms || 0,
        tool_uses: data.tool_uses || [],
        tool_results: data.tool_results || [],
        error: data.error || null,
        is_streaming: data.is_streaming || false,
      }

      ensureSession(trace.session_id, trace.timestamp)
      insertTrace(trace)

      json(res, { ok: true, id: trace.id })
    } catch (err) {
      console.error('[ClaudeScope] Ingest error:', err)
      json(res, { error: 'Invalid ingest data', detail: String(err) }, 400)
    }
    return true
  }

  // POST /api/clear — clear all data
  if (path === '/api/clear' && req.method === 'POST') {
    clearAllData()
    json(res, { ok: true })
    return true
  }

  // GET /api/config/:key
  const configGetMatch = path.match(/^\/api\/config\/([^/]+)$/)
  if (configGetMatch && req.method === 'GET') {
    const value = getConfig(configGetMatch[1])
    json(res, { key: configGetMatch[1], value })
    return true
  }

  // PUT /api/config/:key
  if (configGetMatch && req.method === 'PUT') {
    const body = await readBody(req)
    const { value } = JSON.parse(body)
    setConfig(configGetMatch[1], String(value))
    json(res, { ok: true })
    return true
  }

  // GET /api/export/:sessionId?format=json|md|html
  const exportMatch = path.match(/^\/api\/export\/([^/]+)$/)
  if (exportMatch && req.method === 'GET') {
    const sid = exportMatch[1]
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const format = url.searchParams.get('format') || 'json'

    switch (format) {
      case 'md':
      case 'markdown': {
        const md = exportMarkdown(sid)
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="claude-scope-${sid.slice(0, 8)}.md"`,
        })
        res.end(md)
        return true
      }
      case 'html': {
        const html = exportHTML(sid)
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Disposition': `attachment; filename="claude-scope-${sid.slice(0, 8)}.html"`,
        })
        res.end(html)
        return true
      }
      default: {
        const jsonData = exportJSON(sid)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="claude-scope-${sid.slice(0, 8)}.json"`,
        })
        res.end(jsonData)
        return true
      }
    }
  }

  return false
}

// @ts-ignore - sql.js has no type declarations
import initSqlJs from 'sql.js'
type Database = any
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TraceRecord, Session } from './types.js'
import { calculateCost } from './pricing.js'

let db: Database | null = null
let dbPath: string = ''

const SCHEMA = `
CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_headers TEXT NOT NULL,
  request_body TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_headers TEXT DEFAULT '{}',
  response_body TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  tool_uses TEXT DEFAULT '[]',
  tool_results TEXT DEFAULT '[]',
  error TEXT,
  is_streaming INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id);
CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces(timestamp);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export async function initDb(path: string): Promise<void> {
  dbPath = path
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const SQL = await initSqlJs()

  if (existsSync(path)) {
    const buffer = readFileSync(path)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(SCHEMA)
  saveDb()
}

function saveDb(): void {
  if (!db || !dbPath) return
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(dbPath, buffer)
}

function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function insertTrace(trace: TraceRecord): void {
  const d = getDb()
  d.run(
    `INSERT OR REPLACE INTO traces (id, session_id, timestamp, method, path,
      request_headers, request_body, response_status, response_headers, response_body,
      model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
      latency_ms, tool_uses, tool_results, error, is_streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trace.id,
      trace.session_id,
      trace.timestamp,
      trace.method,
      trace.path,
      JSON.stringify(trace.request_headers),
      JSON.stringify(trace.request_body),
      trace.response_status,
      JSON.stringify(trace.response_headers),
      JSON.stringify(trace.response_body),
      trace.model,
      trace.input_tokens,
      trace.output_tokens,
      trace.cache_creation_tokens,
      trace.cache_read_tokens,
      trace.latency_ms,
      JSON.stringify(trace.tool_uses),
      JSON.stringify(trace.tool_results),
      trace.error,
      trace.is_streaming ? 1 : 0,
    ]
  )
  saveDb()
}

export function ensureSession(sessionId: string, timestamp: number): void {
  const d = getDb()
  const existing = d.exec('SELECT id FROM sessions WHERE id = ?', [sessionId])
  if (existing.length === 0 || existing[0].values.length === 0) {
    d.run('INSERT INTO sessions (id, started_at) VALUES (?, ?)', [sessionId, timestamp])
    saveDb()
  }
}

export function updateSessionEnd(sessionId: string, timestamp: number): void {
  const d = getDb()
  d.run('UPDATE sessions SET ended_at = ? WHERE id = ?', [timestamp, sessionId])
  saveDb()
}

export function getSessions(limit = 50, offset = 0): Session[] {
  const d = getDb()
  const results = d.exec(
    `SELECT
      s.id,
      s.started_at,
      s.ended_at,
      COUNT(t.id) as span_count,
      COALESCE(SUM(t.input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(t.output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(t.cache_creation_tokens), 0) as total_cache_creation_tokens,
      COALESCE(SUM(t.cache_read_tokens), 0) as total_cache_read_tokens,
      GROUP_CONCAT(DISTINCT t.model) as models_used
    FROM sessions s
    LEFT JOIN traces t ON t.session_id = s.id
    GROUP BY s.id
    ORDER BY s.started_at DESC
    LIMIT ? OFFSET ?`,
    [limit, offset]
  )

  if (results.length === 0) return []

  return results[0].values.map((row: any[]) => ({
    id: row[0] as string,
    started_at: row[1] as number,
    ended_at: row[2] as number | null,
    span_count: row[3] as number,
    total_input_tokens: row[4] as number,
    total_output_tokens: row[5] as number,
    total_cache_creation_tokens: row[6] as number,
    total_cache_read_tokens: row[7] as number,
    total_cost: 0, // calculated at API layer
    models_used: row[8] ? (row[8] as string).split(',').filter(Boolean) : [],
  }))
}

export function getTracesBySession(sessionId: string): TraceRecord[] {
  const d = getDb()
  const results = d.exec(
    `SELECT * FROM traces WHERE session_id = ? ORDER BY timestamp ASC`,
    [sessionId]
  )

  if (results.length === 0) return []

  const cols = results[0].columns
  return results[0].values.map((row: any[]) => {
    const obj: Record<string, unknown> = {}
    cols.forEach((col: string, i: number) => {
      obj[col] = row[i]
    })
    return {
      id: obj.id as string,
      session_id: obj.session_id as string,
      timestamp: obj.timestamp as number,
      method: obj.method as string,
      path: obj.path as string,
      request_headers: JSON.parse(obj.request_headers as string),
      request_body: JSON.parse(obj.request_body as string),
      response_status: obj.response_status as number,
      response_headers: JSON.parse((obj.response_headers as string) || '{}'),
      response_body: JSON.parse(obj.response_body as string),
      model: obj.model as string | null,
      input_tokens: obj.input_tokens as number,
      output_tokens: obj.output_tokens as number,
      cache_creation_tokens: obj.cache_creation_tokens as number,
      cache_read_tokens: obj.cache_read_tokens as number,
      latency_ms: obj.latency_ms as number,
      tool_uses: JSON.parse(obj.tool_uses as string),
      tool_results: JSON.parse(obj.tool_results as string),
      error: obj.error as string | null,
      is_streaming: !!(obj.is_streaming as number),
    }
  })
}

export function getTrace(id: string): TraceRecord | null {
  const d = getDb()
  const results = d.exec('SELECT * FROM traces WHERE id = ?', [id])
  if (results.length === 0 || results[0].values.length === 0) return null

  const cols = results[0].columns
  const row = results[0].values[0]
  const obj: Record<string, unknown> = {}
  cols.forEach((col: string, i: number) => {
    obj[col] = row[i]
  })

  return {
    id: obj.id as string,
    session_id: obj.session_id as string,
    timestamp: obj.timestamp as number,
    method: obj.method as string,
    path: obj.path as string,
    request_headers: JSON.parse(obj.request_headers as string),
    request_body: JSON.parse(obj.request_body as string),
    response_status: obj.response_status as number,
    response_headers: JSON.parse((obj.response_headers as string) || '{}'),
    response_body: JSON.parse(obj.response_body as string),
    model: obj.model as string | null,
    input_tokens: obj.input_tokens as number,
    output_tokens: obj.output_tokens as number,
    cache_creation_tokens: obj.cache_creation_tokens as number,
    cache_read_tokens: obj.cache_read_tokens as number,
    latency_ms: obj.latency_ms as number,
    tool_uses: JSON.parse(obj.tool_uses as string),
    tool_results: JSON.parse(obj.tool_results as string),
    error: obj.error as string | null,
    is_streaming: !!(obj.is_streaming as number),
  }
}

export function getStats(since?: number): {
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_creation_tokens: number
  total_cache_read_tokens: number
  models: Record<string, number>
} {
  const d = getDb()
  const whereClause = since ? 'WHERE timestamp >= ?' : ''
  const params = since ? [since] : []

  const results = d.exec(
    `SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as total_cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens
    FROM traces ${whereClause}`,
    params
  )

  const modelResults = d.exec(
    `SELECT model, COUNT(*) as cnt FROM traces ${whereClause} GROUP BY model`,
    params
  )

  const models: Record<string, number> = {}
  if (modelResults.length > 0) {
    for (const row of modelResults[0].values) {
      if (row[0]) models[row[0] as string] = row[1] as number
    }
  }

  if (results.length === 0 || results[0].values.length === 0) {
    return {
      total_calls: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      models: {},
    }
  }

  const row = results[0].values[0]
  return {
    total_calls: row[0] as number,
    total_input_tokens: row[1] as number,
    total_output_tokens: row[2] as number,
    total_cache_creation_tokens: row[3] as number,
    total_cache_read_tokens: row[4] as number,
    models,
  }
}

export function getDailyCosts(days = 30): Array<{ date: string; cost: number; calls: number }> {
  const d = getDb()
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const results = d.exec(
    `SELECT
      date(timestamp / 1000, 'unixepoch', 'localtime') as day,
      model,
      SUM(input_tokens) as input_t,
      SUM(output_tokens) as output_t,
      SUM(cache_creation_tokens) as cache_c_t,
      SUM(cache_read_tokens) as cache_r_t,
      COUNT(*) as calls
    FROM traces
    WHERE timestamp >= ?
    GROUP BY day, model
    ORDER BY day ASC`,
    [since]
  )

  if (results.length === 0) return []

  const dayMap = new Map<string, { cost: number; calls: number }>()

  for (const row of results[0].values) {
    const day = row[0] as string
    const model = (row[1] as string) || 'unknown'
    const inputT = row[2] as number
    const outputT = row[3] as number
    const cacheCT = row[4] as number
    const cacheRT = row[5] as number
    const calls = row[6] as number

    const cost = calculateCost(model, inputT, outputT, cacheCT, cacheRT)

    const existing = dayMap.get(day) || { cost: 0, calls: 0 }
    existing.cost += cost
    existing.calls += calls
    dayMap.set(day, existing)
  }

  return Array.from(dayMap.entries()).map(([date, data]) => ({
    date,
    ...data,
  }))
}

export function clearAllData(): void {
  const d = getDb()
  d.run('DELETE FROM traces')
  d.run('DELETE FROM sessions')
  saveDb()
}

export function setConfig(key: string, value: string): void {
  const d = getDb()
  d.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, value])
  saveDb()
}

export function getConfig(key: string): string | null {
  const d = getDb()
  const results = d.exec('SELECT value FROM config WHERE key = ?', [key])
  if (results.length === 0 || results[0].values.length === 0) return null
  return results[0].values[0][0] as string
}

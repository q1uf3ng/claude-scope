import type { Session, TraceRecord, Stats, DailyCost } from './types'

const BASE = ''  // same origin

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE}/api/sessions`)
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`)
  return res.json()
}

export async function fetchSessionTraces(sessionId: string): Promise<TraceRecord[]> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/traces`)
  if (!res.ok) throw new Error(`Failed to fetch traces: ${res.status}`)
  return res.json()
}

export async function fetchTrace(traceId: string): Promise<TraceRecord> {
  const res = await fetch(`${BASE}/api/traces/${traceId}`)
  if (!res.ok) throw new Error(`Failed to fetch trace: ${res.status}`)
  return res.json()
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/api/stats`)
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`)
  return res.json()
}

export async function fetchDailyCosts(): Promise<DailyCost[]> {
  const res = await fetch(`${BASE}/api/stats/daily`)
  if (!res.ok) throw new Error(`Failed to fetch daily costs: ${res.status}`)
  return res.json()
}

export async function clearData(): Promise<void> {
  const res = await fetch(`${BASE}/api/clear`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to clear data: ${res.status}`)
}

export async function forceNewSession(): Promise<string> {
  const res = await fetch(`${BASE}/api/sessions/new`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`)
  const data = await res.json()
  return data.session_id
}

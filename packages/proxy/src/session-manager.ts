import { randomUUID } from 'node:crypto'
import { ensureSession, updateSessionEnd } from './db.js'

const SESSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

let currentSessionId: string | null = null
let lastActivityTimestamp = 0

export function getOrCreateSessionId(): string {
  const now = Date.now()

  if (
    !currentSessionId ||
    now - lastActivityTimestamp > SESSION_TIMEOUT_MS
  ) {
    currentSessionId = randomUUID()
    ensureSession(currentSessionId, now)
  }

  lastActivityTimestamp = now
  return currentSessionId
}

export function forceNewSession(): string {
  currentSessionId = randomUUID()
  lastActivityTimestamp = Date.now()
  ensureSession(currentSessionId, lastActivityTimestamp)
  return currentSessionId
}

export function endCurrentSession(): void {
  if (currentSessionId) {
    updateSessionEnd(currentSessionId, Date.now())
    currentSessionId = null
  }
}

export function getCurrentSessionId(): string | null {
  return currentSessionId
}

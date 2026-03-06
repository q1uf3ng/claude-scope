import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { WSEvent, Span } from './types.js'

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()
const inFlightSpans = new Map<string, Span>()

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    clients.add(ws)

    // Send all in-flight spans to newly connected client
    for (const span of inFlightSpans.values()) {
      ws.send(JSON.stringify({ type: 'span_start', span }))
    }

    ws.on('close', () => {
      clients.delete(ws)
    })

    ws.on('error', (err) => {
      console.error('[ClaudeScope] WebSocket error:', err.message)
      clients.delete(ws)
    })
  })
}

export function broadcast(event: WSEvent): void {
  const data = JSON.stringify(event)
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(data)
    }
  }
}

export function addInFlightSpan(id: string, span: Span): void {
  inFlightSpans.set(id, span)
}

export function removeInFlightSpan(id: string): void {
  inFlightSpans.delete(id)
}

export function getInFlightSpans(): Map<string, Span> {
  return inFlightSpans
}

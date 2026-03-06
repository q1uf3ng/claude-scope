import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import type { TraceRecord, ToolUse, ToolResult, Span } from './types.js'
import { insertTrace } from './db.js'
import { sanitizeHeaders } from './sanitize.js'
import { calculateCost } from './pricing.js'
import { getOrCreateSessionId } from './session-manager.js'
import { broadcast, addInFlightSpan, removeInFlightSpan } from './ws.js'

const ANTHROPIC_HOST = 'api.anthropic.com'

/** Detect HTTP/HTTPS proxy from environment variables */
function getProxyUrl(targetProtocol: string): string | null {
  const envVars = targetProtocol === 'https:'
    ? ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']
    : ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']

  for (const envVar of envVars) {
    const val = process.env[envVar]
    if (val) {
      try {
        new URL(val) // validate
        return val
      } catch { continue }
    }
  }
  return null
}

/** Check if a hostname should bypass the proxy */
function shouldBypassProxy(hostname: string): boolean {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || ''
  if (!noProxy) return false
  const list = noProxy.split(',').map(s => s.trim().toLowerCase())
  const host = hostname.toLowerCase()
  return list.some(entry => {
    if (entry === '*') return true
    if (entry.startsWith('.')) return host.endsWith(entry) || host === entry.slice(1)
    if (entry.includes('*')) {
      const pattern = entry.replace(/\*/g, '.*')
      return new RegExp(`^${pattern}$`).test(host)
    }
    return host === entry || host.endsWith(`.${entry}`)
  })
}

/**
 * Create an HTTPS CONNECT tunnel through an HTTP proxy.
 * Returns a TLS-upgraded socket connected to the target.
 */
function connectViaProxy(proxyUrlStr: string, targetHost: string, targetPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const proxyUrl = new URL(proxyUrlStr)

    const connectReq = httpRequest({
      hostname: proxyUrl.hostname,
      port: parseInt(proxyUrl.port) || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { 'Host': `${targetHost}:${targetPort}` },
    })

    connectReq.on('connect', (res, socket, _head) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT returned ${res.statusCode}`))
        return
      }

      // Upgrade the raw TCP socket to TLS
      const tlsSocket = tlsConnect({
        socket: socket,
        servername: targetHost,
        rejectUnauthorized: true,
      }, () => {
        if (process.env.CLAUDE_SCOPE_DEBUG) {
          console.log(`[DEBUG] TLS tunnel established to ${targetHost}:${targetPort}`)
        }
        resolve(tlsSocket as unknown as Socket)
      })
      tlsSocket.on('error', (err) => {
        socket.destroy()
        reject(err)
      })
    })

    connectReq.on('error', reject)

    // Timeout for CONNECT
    connectReq.setTimeout(10000, () => {
      connectReq.destroy()
      reject(new Error('Proxy CONNECT timeout'))
    })

    connectReq.end()
  })
}

/** Parse tool_use blocks from Anthropic response content */
function extractToolUses(body: unknown): ToolUse[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const content = b.content
  if (!Array.isArray(content)) return []

  return content
    .filter((block: Record<string, unknown>) => block.type === 'tool_use')
    .map((block: Record<string, unknown>) => ({
      id: block.id as string,
      name: block.name as string,
      input: block.input,
    }))
}

/** Parse tool_result blocks from Anthropic request messages */
function extractToolResults(body: unknown): ToolResult[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const messages = b.messages
  if (!Array.isArray(messages)) return []

  const results: ToolResult[] = []
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    const content = msg.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result') {
        results.push({
          tool_use_id: block.tool_use_id as string,
          content: block.content,
          is_error: block.is_error as boolean | undefined,
        })
      }
    }
  }
  return results
}

/** Reassemble SSE chunks into a complete response body */
function reassembleSSEResponse(chunks: string[]): unknown {
  let finalMessage: Record<string, unknown> | null = null
  const contentBlocks: Record<string, unknown>[] = []
  let currentTextParts: string[] = []
  let currentBlockIndex = -1
  let usage: Record<string, unknown> = {}

  // Concatenate ALL chunks first, then split by lines.
  // SSE data lines can span multiple TCP chunks, so processing
  // each chunk independently would break JSON parsing.
  const fullText = chunks.join('')
  const lines = fullText.split('\n')

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') continue

    try {
      const event = JSON.parse(data) as Record<string, unknown>
        switch (event.type) {
          case 'message_start': {
            const msg = event.message as Record<string, unknown>
            finalMessage = { ...msg }
            if (msg.usage) {
              usage = { ...(msg.usage as Record<string, unknown>) }
            }
            break
          }
          case 'content_block_start': {
            const block = event.content_block as Record<string, unknown>
            const idx = event.index as number
            currentBlockIndex = idx
            if (block.type === 'text') {
              currentTextParts = [block.text as string || '']
            }
            contentBlocks[idx] = { ...block }
            break
          }
          case 'content_block_delta': {
            const delta = event.delta as Record<string, unknown>
            if (delta.type === 'text_delta') {
              currentTextParts.push(delta.text as string)
            } else if (delta.type === 'input_json_delta') {
              const idx = event.index as number
              const block = contentBlocks[idx]
              if (block) {
                block.input = ((block.input as string) || '') + (delta.partial_json as string)
              }
            } else if (delta.type === 'thinking_delta') {
              const idx = event.index as number
              const block = contentBlocks[idx]
              if (block) {
                block.thinking = ((block.thinking as string) || '') + (delta.thinking as string)
              }
            }
            break
          }
          case 'content_block_stop': {
            const idx = event.index as number
            if (contentBlocks[idx]?.type === 'text') {
              contentBlocks[idx].text = currentTextParts.join('')
            }
            if (contentBlocks[idx]?.type === 'tool_use' && typeof contentBlocks[idx].input === 'string') {
              try {
                contentBlocks[idx].input = JSON.parse(contentBlocks[idx].input as string)
              } catch { /* keep as string */ }
            }
            currentTextParts = []
            break
          }
          case 'message_delta': {
            const delta = event.delta as Record<string, unknown>
            if (delta.stop_reason && finalMessage) {
              finalMessage.stop_reason = delta.stop_reason
            }
            if (event.usage) {
              usage = { ...usage, ...(event.usage as Record<string, unknown>) }
            }
            break
          }
        }
      } catch {
        // Skip malformed SSE lines
      }
    }

  if (finalMessage) {
    finalMessage.content = contentBlocks.filter(Boolean)
    finalMessage.usage = usage
    return finalMessage
  }

  return { raw_chunks: chunks }
}

/** Check if request is for the Anthropic Messages API */
function isMessagesApiCall(path: string): boolean {
  return path.startsWith('/v1/messages')
}

/** Create a Span object from partial trace data */
function createSpan(trace: Partial<TraceRecord>, status: Span['status']): Span {
  return {
    id: trace.id || '',
    session_id: trace.session_id || '',
    index: 0,
    timestamp: trace.timestamp || Date.now(),
    model: trace.model || null,
    input_tokens: trace.input_tokens || 0,
    output_tokens: trace.output_tokens || 0,
    cache_creation_tokens: trace.cache_creation_tokens || 0,
    cache_read_tokens: trace.cache_read_tokens || 0,
    cost: 0,
    latency_ms: trace.latency_ms || 0,
    status,
    tool_uses: trace.tool_uses || [],
    tool_results: trace.tool_results || [],
    request_body: trace.request_body || null,
    response_body: trace.response_body || null,
    error: trace.error || null,
  }
}

export function createProxyHandler(target: string, proxyConfig: string | null = null) {
  const targetUrl = new URL(target)

  // Determine proxy URL:
  // - proxyConfig = '' (empty string from --no-proxy) → disabled
  // - proxyConfig = 'http://...' (explicit --proxy) → use that
  // - proxyConfig = null → auto-detect from environment
  let proxyUrlStr: string | null = null
  if (proxyConfig === '') {
    // --no-proxy: explicitly disabled
    proxyUrlStr = null
  } else if (proxyConfig) {
    // --proxy <url>: explicit proxy URL
    proxyUrlStr = proxyConfig
  } else {
    // Auto-detect from HTTPS_PROXY / HTTP_PROXY environment
    proxyUrlStr = shouldBypassProxy(targetUrl.hostname)
      ? null
      : getProxyUrl(targetUrl.protocol)
  }

  if (proxyUrlStr) {
    console.log(`  [ClaudeScope] Using HTTP proxy: ${proxyUrlStr}`)
  }

  return async (clientReq: IncomingMessage, clientRes: ServerResponse) => {
    const startTime = Date.now()
    const traceId = randomUUID()
    const sessionId = getOrCreateSessionId()

    // Collect request body
    const bodyChunks: Buffer[] = []
    for await (const chunk of clientReq) {
      bodyChunks.push(chunk as Buffer)
    }
    const rawBody = Buffer.concat(bodyChunks)
    let requestBody: unknown = null
    try {
      requestBody = JSON.parse(rawBody.toString())
    } catch {
      requestBody = rawBody.toString()
    }

    const reqHeaders = { ...(clientReq.headers as Record<string, string>) }
    const isStreamReq = (requestBody as Record<string, unknown>)?.stream === true
    const model = (requestBody as Record<string, unknown>)?.model as string || null
    const path = clientReq.url || '/'
    const isApiCall = isMessagesApiCall(path)

    // Debug logging for request inspection
    if (process.env.CLAUDE_SCOPE_DEBUG) {
      console.log(`[DEBUG] ${clientReq.method} ${path}`)
      const safeHeaders = { ...reqHeaders }
      // Redact auth for debug output
      if (safeHeaders['authorization']) safeHeaders['authorization'] = safeHeaders['authorization'].slice(0, 20) + '...'
      if (safeHeaders['x-api-key']) safeHeaders['x-api-key'] = safeHeaders['x-api-key'].slice(0, 15) + '...'
      console.log(`[DEBUG] Headers:`, JSON.stringify(safeHeaders, null, 2))
    }

    // Extract tool_results from request (user's tool responses)
    const toolResults = isApiCall ? extractToolResults(requestBody) : []

    // Build initial span for WS broadcast
    if (isApiCall) {
      const span = createSpan(
        {
          id: traceId,
          session_id: sessionId,
          timestamp: startTime,
          model,
          request_body: requestBody,
          tool_results: toolResults,
        },
        'pending'
      )
      addInFlightSpan(traceId, span)
      broadcast({ type: 'span_start', span })
    }

    // Forward to target API
    // Filter hop-by-hop headers and accept-encoding (we need uncompressed responses for parsing)
    const SKIP_HEADERS = new Set([
      'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'te', 'trailers', 'transfer-encoding', 'upgrade',
      'accept-encoding',  // Remove so we get uncompressed responses for token/cost parsing
    ])
    const proxyReqHeaders: Record<string, string> = {}
    for (const [key, val] of Object.entries(reqHeaders)) {
      if (key === 'host') {
        proxyReqHeaders[key] = targetUrl.host
      } else if (SKIP_HEADERS.has(key)) {
        // Skip hop-by-hop headers
      } else if (val) {
        proxyReqHeaders[key] = Array.isArray(val) ? val.join(', ') : val
      }
    }
    // Always set correct content-length based on actual body
    proxyReqHeaders['content-length'] = String(rawBody.length)

    const isHTTPS = targetUrl.protocol === 'https:'
    const targetPort = targetUrl.port ? parseInt(targetUrl.port) : (isHTTPS ? 443 : 80)

    // Build request options
    const requestOptions: Record<string, unknown> = {
      hostname: targetUrl.hostname,
      port: targetPort,
      path: path,
      method: clientReq.method,
      headers: proxyReqHeaders,
    }

    const handleResponse = (proxyRes: IncomingMessage) => {
      const statusCode = proxyRes.statusCode || 500
      const resHeaders = proxyRes.headers as Record<string, string>

      // Forward response headers to client
      const fwdHeaders: Record<string, string | string[]> = {}
      for (const [key, val] of Object.entries(resHeaders)) {
        if (val) fwdHeaders[key] = val
      }

      clientRes.writeHead(statusCode, fwdHeaders)

      if (isStreamReq && isApiCall && statusCode >= 200 && statusCode < 300) {
        // SSE streaming mode
        const sseChunks: string[] = []

        proxyRes.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          sseChunks.push(text)

          // Forward chunk to client immediately
          clientRes.write(chunk)

          // Try to broadcast token updates
          if (isApiCall) {
            broadcast({
              type: 'span_chunk',
              span_id: traceId,
              chunk: text,
            })
          }
        })

        proxyRes.on('end', () => {
          clientRes.end()

          const latency = Date.now() - startTime
          const reassembled = reassembleSSEResponse(sseChunks)
          const usage = (reassembled as Record<string, unknown>)?.usage as Record<string, number> | undefined
          const toolUses = extractToolUses(reassembled)

          if (process.env.CLAUDE_SCOPE_DEBUG) {
            console.log(`[DEBUG] SSE reassembled usage for ${traceId.slice(0, 8)}:`, JSON.stringify(usage))
          }

          const trace: TraceRecord = {
            id: traceId,
            session_id: sessionId,
            timestamp: startTime,
            method: clientReq.method || 'POST',
            path,
            request_headers: sanitizeHeaders(reqHeaders),
            request_body: requestBody,
            response_status: statusCode,
            response_headers: sanitizeHeaders(resHeaders),
            response_body: reassembled,
            model,
            input_tokens: usage?.input_tokens || 0,
            output_tokens: usage?.output_tokens || 0,
            cache_creation_tokens: usage?.cache_creation_input_tokens || 0,
            cache_read_tokens: usage?.cache_read_input_tokens || 0,
            latency_ms: latency,
            tool_uses: toolUses,
            tool_results: toolResults,
            error: null,
            is_streaming: true,
          }

          insertTrace(trace)
          removeInFlightSpan(traceId)

          const cost = model
            ? calculateCost(
                model,
                trace.input_tokens,
                trace.output_tokens,
                trace.cache_creation_tokens,
                trace.cache_read_tokens
              )
            : 0

          const span = createSpan(trace, 'complete')
          span.cost = cost
          span.latency_ms = latency
          broadcast({ type: 'span_end', span })
        })
      } else {
        // Non-streaming or error response
        const resChunks: Buffer[] = []

        proxyRes.on('data', (chunk: Buffer) => {
          resChunks.push(chunk)
          clientRes.write(chunk)
        })

        proxyRes.on('end', () => {
          clientRes.end()

          const latency = Date.now() - startTime
          const resRaw = Buffer.concat(resChunks).toString()
          let responseBody: unknown = resRaw
          try {
            responseBody = JSON.parse(resRaw)
          } catch { /* keep as string */ }

          const toolUses = isApiCall ? extractToolUses(responseBody) : []
          const usage = isApiCall
            ? ((responseBody as Record<string, unknown>)?.usage as Record<string, number> | undefined)
            : undefined

          let error: string | null = null
          if (statusCode >= 400) {
            const errBody = responseBody as Record<string, unknown>
            error = (errBody?.error as Record<string, unknown>)?.message as string
              || errBody?.message as string
              || `HTTP ${statusCode}`
          }

          const trace: TraceRecord = {
            id: traceId,
            session_id: sessionId,
            timestamp: startTime,
            method: clientReq.method || 'POST',
            path,
            request_headers: sanitizeHeaders(reqHeaders),
            request_body: requestBody,
            response_status: statusCode,
            response_headers: sanitizeHeaders(resHeaders),
            response_body: responseBody,
            model,
            input_tokens: usage?.input_tokens || 0,
            output_tokens: usage?.output_tokens || 0,
            cache_creation_tokens: usage?.cache_creation_input_tokens || 0,
            cache_read_tokens: usage?.cache_read_input_tokens || 0,
            latency_ms: latency,
            tool_uses: toolUses,
            tool_results: toolResults,
            error,
            is_streaming: false,
          }

          if (isApiCall) {
            insertTrace(trace)
            removeInFlightSpan(traceId)

            const cost = model
              ? calculateCost(
                  model,
                  trace.input_tokens,
                  trace.output_tokens,
                  trace.cache_creation_tokens,
                  trace.cache_read_tokens
                )
              : 0

            const span = createSpan(trace, error ? 'error' : 'complete')
            span.cost = cost
            span.latency_ms = latency
            broadcast({ type: 'span_end', span })
          }
        })
      }
    }

    const handleError = (err: Error) => {
      console.error(`[ClaudeScope] Proxy error: ${err.message}`)

      // Fallback: return error to client
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' })
        clientRes.end(JSON.stringify({ error: { type: 'proxy_error', message: err.message } }))
      }

      if (isApiCall) {
        removeInFlightSpan(traceId)
        const span = createSpan(
          {
            id: traceId,
            session_id: sessionId,
            timestamp: startTime,
            model,
            error: err.message,
          },
          'error'
        )
        broadcast({ type: 'span_end', span })
      }
    }

    // Use CONNECT tunnel through proxy for HTTPS targets, or direct connection
    if (isHTTPS && proxyUrlStr) {
      try {
        const tunnelSocket = await connectViaProxy(proxyUrlStr, targetUrl.hostname, targetPort)
        // IMPORTANT: Use http.request (NOT https.request) because the socket is already TLS-encrypted.
        // Using https.request would attempt double TLS encryption, causing "wrong version number" errors.
        const proxyReq = httpRequest(
          {
            ...requestOptions,
            createConnection: () => tunnelSocket,
          } as Parameters<typeof httpRequest>[0],
          handleResponse
        )
        proxyReq.on('error', handleError)
        proxyReq.write(rawBody)
        proxyReq.end()
      } catch (tunnelErr) {
        console.error(`[ClaudeScope] Proxy tunnel failed: ${(tunnelErr as Error).message}, trying direct`)
        // Fallback to direct connection
        const proxyReq = httpsRequest(requestOptions as Parameters<typeof httpsRequest>[0], handleResponse)
        proxyReq.on('error', handleError)
        proxyReq.write(rawBody)
        proxyReq.end()
      }
    } else {
      // Direct connection (HTTP target, or no proxy configured)
      const reqFn = isHTTPS ? httpsRequest : httpRequest
      const proxyReq = reqFn(requestOptions as Parameters<typeof httpsRequest>[0], handleResponse)
      proxyReq.on('error', handleError)
      proxyReq.write(rawBody)
      proxyReq.end()
    }
  }
}

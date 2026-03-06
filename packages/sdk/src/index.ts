/**
 * @claude-scope/sdk — Lightweight instrumentation for Anthropic SDK
 *
 * Usage:
 *   import { trace } from '@claude-scope/sdk'
 *   import Anthropic from '@anthropic-ai/sdk'
 *   const client = trace(new Anthropic())
 */

interface TraceOptions {
  /** ClaudeScope server URL (default: http://localhost:3100) */
  endpoint?: string
  /** Session ID to group traces under */
  sessionId?: string
  /** Whether to log errors to console (default: false) */
  debug?: boolean
}

interface IngestPayload {
  id: string
  session_id?: string
  timestamp: number
  method: string
  path: string
  request_headers: Record<string, string>
  request_body: unknown
  response_status: number
  response_body: unknown
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  latency_ms: number
  tool_uses: Array<{ id: string; name: string; input: unknown }>
  tool_results: Array<{ tool_use_id: string; content: unknown; is_error?: boolean }>
  error: string | null
  is_streaming: boolean
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function extractToolUses(body: any): Array<{ id: string; name: string; input: unknown }> {
  if (!body?.content || !Array.isArray(body.content)) return []
  return body.content
    .filter((block: any) => block.type === 'tool_use')
    .map((block: any) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    }))
}

function extractToolResults(body: any): Array<{ tool_use_id: string; content: unknown; is_error?: boolean }> {
  if (!body?.messages || !Array.isArray(body.messages)) return []
  const results: Array<{ tool_use_id: string; content: unknown; is_error?: boolean }> = []
  for (const msg of body.messages) {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        results.push({
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        })
      }
    }
  }
  return results
}

async function sendToServer(
  endpoint: string,
  payload: IngestPayload,
  debug: boolean
): Promise<void> {
  try {
    // Fire and forget — don't await in production
    const res = await fetch(`${endpoint}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (debug && !res.ok) {
      console.error(`[ClaudeScope SDK] Ingest failed: ${res.status}`)
    }
  } catch (err) {
    if (debug) {
      console.error('[ClaudeScope SDK] Failed to send trace:', err)
    }
    // Silent failure — never break user code
  }
}

/**
 * Wrap an Anthropic SDK client to automatically trace all messages.create calls.
 *
 * @example
 * ```ts
 * import { trace } from '@claude-scope/sdk'
 * import Anthropic from '@anthropic-ai/sdk'
 *
 * const client = trace(new Anthropic())
 * // Use client normally — all calls are traced
 * ```
 */
export function trace<T extends object>(client: T, options?: TraceOptions): T {
  const endpoint = options?.endpoint || 'http://localhost:3100'
  const sessionId = options?.sessionId
  const debug = options?.debug || false

  return new Proxy(client, {
    get(target: any, prop: string | symbol) {
      const value = target[prop]

      // Intercept .messages property to wrap .create and .stream
      if (prop === 'messages' && value && typeof value === 'object') {
        return new Proxy(value, {
          get(msgTarget: any, msgProp: string | symbol) {
            const msgValue = msgTarget[msgProp]

            if ((msgProp === 'create' || msgProp === 'stream') && typeof msgValue === 'function') {
              return async function tracedCall(...args: any[]) {
                const startTime = Date.now()
                const traceId = generateId()
                const requestBody = args[0] || {}
                const model = requestBody.model || null
                const isStream = msgProp === 'stream' || requestBody.stream === true

                try {
                  const result = await msgValue.apply(msgTarget, args)

                  // For non-streaming responses
                  if (!isStream || (result && typeof result === 'object' && result.type === 'message')) {
                    const latency = Date.now() - startTime
                    const usage = result?.usage || {}

                    const payload: IngestPayload = {
                      id: traceId,
                      session_id: sessionId,
                      timestamp: startTime,
                      method: 'POST',
                      path: '/v1/messages',
                      request_headers: {},
                      request_body: requestBody,
                      response_status: 200,
                      response_body: result,
                      model,
                      input_tokens: usage.input_tokens || 0,
                      output_tokens: usage.output_tokens || 0,
                      cache_creation_tokens: usage.cache_creation_tokens || 0,
                      cache_read_tokens: usage.cache_read_tokens || 0,
                      latency_ms: latency,
                      tool_uses: extractToolUses(result),
                      tool_results: extractToolResults(requestBody),
                      error: null,
                      is_streaming: false,
                    }

                    // Fire and forget
                    sendToServer(endpoint, payload, debug)
                  }

                  // For streaming responses, wrap the iterator
                  if (isStream && result && typeof result[Symbol.asyncIterator] === 'function') {
                    const originalIterator = result[Symbol.asyncIterator].bind(result)
                    let finalMessage: any = null

                    const wrappedResult = new Proxy(result, {
                      get(streamTarget: any, streamProp: string | symbol) {
                        if (streamProp === Symbol.asyncIterator) {
                          return function* () {
                            // Can't easily wrap async iterator without async generator
                            // Fall back to on('end') pattern
                          }
                        }

                        // Intercept finalMessage or similar properties
                        if (streamProp === 'on' && typeof streamTarget.on === 'function') {
                          return function (event: string, handler: Function) {
                            if (event === 'finalMessage' || event === 'message') {
                              const wrappedHandler = (msg: any) => {
                                finalMessage = msg
                                const latency = Date.now() - startTime
                                const usage = msg?.usage || {}

                                const payload: IngestPayload = {
                                  id: traceId,
                                  session_id: sessionId,
                                  timestamp: startTime,
                                  method: 'POST',
                                  path: '/v1/messages',
                                  request_headers: {},
                                  request_body: requestBody,
                                  response_status: 200,
                                  response_body: msg,
                                  model,
                                  input_tokens: usage.input_tokens || 0,
                                  output_tokens: usage.output_tokens || 0,
                                  cache_creation_tokens: usage.cache_creation_tokens || 0,
                                  cache_read_tokens: usage.cache_read_tokens || 0,
                                  latency_ms: latency,
                                  tool_uses: extractToolUses(msg),
                                  tool_results: extractToolResults(requestBody),
                                  error: null,
                                  is_streaming: true,
                                }

                                sendToServer(endpoint, payload, debug)
                                return handler(msg)
                              }
                              return streamTarget.on(event, wrappedHandler)
                            }
                            return streamTarget.on(event, handler)
                          }
                        }

                        // Intercept finalMessage() method (Anthropic SDK)
                        if (streamProp === 'finalMessage' && typeof streamTarget.finalMessage === 'function') {
                          return async function () {
                            const msg = await streamTarget.finalMessage()
                            const latency = Date.now() - startTime
                            const usage = msg?.usage || {}

                            const payload: IngestPayload = {
                              id: traceId,
                              session_id: sessionId,
                              timestamp: startTime,
                              method: 'POST',
                              path: '/v1/messages',
                              request_headers: {},
                              request_body: requestBody,
                              response_status: 200,
                              response_body: msg,
                              model,
                              input_tokens: usage.input_tokens || 0,
                              output_tokens: usage.output_tokens || 0,
                              cache_creation_tokens: usage.cache_creation_tokens || 0,
                              cache_read_tokens: usage.cache_read_tokens || 0,
                              latency_ms: latency,
                              tool_uses: extractToolUses(msg),
                              tool_results: extractToolResults(requestBody),
                              error: null,
                              is_streaming: true,
                            }

                            sendToServer(endpoint, payload, debug)
                            return msg
                          }
                        }

                        return streamTarget[streamProp]
                      },
                    })

                    return wrappedResult
                  }

                  return result
                } catch (err: any) {
                  const latency = Date.now() - startTime

                  const payload: IngestPayload = {
                    id: traceId,
                    session_id: sessionId,
                    timestamp: startTime,
                    method: 'POST',
                    path: '/v1/messages',
                    request_headers: {},
                    request_body: requestBody,
                    response_status: err?.status || 500,
                    response_body: { error: err?.message || 'Unknown error' },
                    model,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_creation_tokens: 0,
                    cache_read_tokens: 0,
                    latency_ms: latency,
                    tool_uses: [],
                    tool_results: extractToolResults(requestBody),
                    error: err?.message || 'Unknown error',
                    is_streaming: isStream,
                  }

                  sendToServer(endpoint, payload, debug)

                  // Re-throw — SDK should never swallow user errors
                  throw err
                }
              }
            }

            return msgValue
          },
        })
      }

      return value
    },
  })
}

export default trace

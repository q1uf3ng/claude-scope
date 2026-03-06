/** Core data types for ClaudeScope */

export interface TraceRecord {
  id: string
  session_id: string
  timestamp: number
  method: string
  path: string
  request_headers: Record<string, string>
  request_body: unknown
  response_status: number
  response_headers: Record<string, string>
  response_body: unknown
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  latency_ms: number
  tool_uses: ToolUse[]
  tool_results: ToolResult[]
  error: string | null
  is_streaming: boolean
}

export interface ToolUse {
  id: string
  name: string
  input: unknown
}

export interface ToolResult {
  tool_use_id: string
  content: unknown
  is_error?: boolean
}

export interface Session {
  id: string
  started_at: number
  ended_at: number | null
  span_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_creation_tokens: number
  total_cache_read_tokens: number
  total_cost: number
  models_used: string[]
}

export interface Span {
  id: string
  session_id: string
  index: number
  timestamp: number
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  cost: number
  latency_ms: number
  status: 'pending' | 'streaming' | 'complete' | 'error'
  tool_uses: ToolUse[]
  tool_results: ToolResult[]
  request_body: unknown
  response_body: unknown
  error: string | null
}

export interface PricingEntry {
  input_per_million: number
  output_per_million: number
  cache_read_multiplier: number
  cache_creation_multiplier: number
}

export type PricingTable = Record<string, PricingEntry>

/** WebSocket event types */
export type WSEvent =
  | { type: 'span_start'; span: Span }
  | { type: 'span_chunk'; span_id: string; chunk: unknown; tokens?: { input: number; output: number } }
  | { type: 'span_end'; span: Span }
  | { type: 'session_start'; session: Session }
  | { type: 'session_update'; session: Session }

export interface ServerConfig {
  port: number
  host: string
  target: string
  dbPath: string
  autoOpen: boolean
  budgetDaily: number | null
  proxy: string | null  // HTTP proxy URL for forwarding (auto-detected from env or manual --proxy)
}

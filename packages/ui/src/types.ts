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
  request_body: any
  response_body: any
  error: string | null
}

export interface ToolUse {
  id: string
  name: string
  input: any
}

export interface ToolResult {
  tool_use_id: string
  content: any
  is_error?: boolean
}

export interface TraceRecord extends Span {
  method: string
  path: string
  request_headers: Record<string, string>
  response_status: number
  response_headers: Record<string, string>
  is_streaming: boolean
}

export interface Stats {
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_creation_tokens: number
  total_cache_read_tokens: number
  total_cost: number
  models: Record<string, number>
  current_session_id: string | null
}

export interface DailyCost {
  date: string
  cost: number
  calls: number
}

export type WSEvent =
  | { type: 'span_start'; span: Span }
  | { type: 'span_chunk'; span_id: string; chunk: any; tokens?: { input: number; output: number } }
  | { type: 'span_end'; span: Span }

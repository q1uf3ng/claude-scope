import React, { useState } from 'react'
import type { TraceRecord } from '../types'
import {
  formatCost,
  formatTokens,
  formatDuration,
  formatTime,
  getModelColor,
  getModelBgColor,
  getModelShortName,
  getStatusColor,
  getContextUsage,
} from '../utils'
import { JsonView } from './JsonView'

interface SpanCardProps {
  trace: TraceRecord
  index: number
}

export function SpanCard({ trace, index }: SpanCardProps) {
  const [expanded, setExpanded] = useState(false)
  const modelColor = getModelColor(trace.model)
  const modelBg = getModelBgColor(trace.model)
  const statusColor = getStatusColor(trace.status)
  const ctxUsage = getContextUsage(trace.input_tokens)

  const hasToolUses = trace.tool_uses && trace.tool_uses.length > 0
  const hasToolResults = trace.tool_results && trace.tool_results.length > 0
  const isError = trace.status === 'error' || (trace.response_status && trace.response_status >= 400)

  return (
    <div
      className={`border rounded-lg mb-2 transition-all ${
        isError ? 'border-ct-red/50' : 'border-ct-border'
      } ${modelBg}`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3"
      >
        {/* Index */}
        <span className="text-ct-text-secondary text-xs font-mono w-6 text-right shrink-0">
          #{index + 1}
        </span>

        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            trace.status === 'pending' || trace.status === 'streaming'
              ? 'bg-ct-orange animate-pulse-glow'
              : isError
              ? 'bg-ct-red'
              : 'bg-ct-green'
          }`}
        />

        {/* Model badge */}
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${modelColor}`}>
          {getModelShortName(trace.model)}
        </span>

        {/* Tool names */}
        {hasToolUses && (
          <div className="flex gap-1 min-w-0 flex-shrink overflow-hidden">
            {trace.tool_uses.slice(0, 3).map((tu, i) => (
              <span
                key={i}
                className="text-[10px] bg-ct-bg/60 text-ct-accent px-1.5 py-0.5 rounded truncate max-w-[120px]"
              >
                {tu.name}
              </span>
            ))}
            {trace.tool_uses.length > 3 && (
              <span className="text-[10px] text-ct-text-secondary">
                +{trace.tool_uses.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Error indicator */}
        {isError && (
          <span className="text-[10px] bg-red-900/40 text-ct-red px-1.5 py-0.5 rounded">
            {trace.response_status || 'ERR'}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Metrics */}
        <div className="flex items-center gap-3 text-xs shrink-0">
          <span className="font-mono text-ct-text-secondary">
            {formatTokens(trace.input_tokens)}/{formatTokens(trace.output_tokens)}
          </span>
          <span className="font-mono text-ct-green">{formatCost(trace.cost)}</span>
          <span className="font-mono text-ct-text-secondary">{formatDuration(trace.latency_ms)}</span>
        </div>

        {/* Expand arrow */}
        <span className={`text-ct-text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`}>
          ▸
        </span>
      </button>

      {/* Latency bar */}
      <div className="px-3 pb-1">
        <div className="h-1 bg-ct-bg rounded-full overflow-hidden">
          <div
            className="h-full bg-ct-accent/40 rounded-full transition-all"
            style={{ width: `${Math.min((trace.latency_ms / 30000) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* Context window mini-bar */}
      <div className="px-3 pb-2">
        <div className="h-0.5 bg-ct-bg rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${ctxUsage.color}`}
            style={{ width: `${ctxUsage.percentage}%` }}
          />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-ct-border px-3 py-3 space-y-3">
          {/* Metadata row */}
          <div className="flex flex-wrap gap-4 text-xs text-ct-text-secondary">
            <span>Time: {formatTime(trace.timestamp)}</span>
            <span>ID: {trace.id.slice(0, 12)}</span>
            <span>Session: {trace.session_id.slice(0, 8)}</span>
            {trace.is_streaming && <span className="text-ct-accent">Streaming</span>}
            <span>Input: {trace.input_tokens.toLocaleString()}</span>
            <span>Output: {trace.output_tokens.toLocaleString()}</span>
            {trace.cache_read_tokens > 0 && (
              <span className="text-ct-green">Cache Read: {trace.cache_read_tokens.toLocaleString()}</span>
            )}
            {trace.cache_creation_tokens > 0 && (
              <span>Cache Created: {trace.cache_creation_tokens.toLocaleString()}</span>
            )}
          </div>

          {/* Context Window */}
          <div>
            <h4 className="text-xs font-medium text-ct-text-secondary mb-1">
              Context Window ({ctxUsage.percentage.toFixed(1)}% of 200K)
            </h4>
            <div className="h-3 bg-ct-bg rounded-full overflow-hidden flex">
              <div
                className="h-full bg-blue-700/60"
                style={{
                  width: `${Math.max((trace.input_tokens / 200_000) * 100, 0.5)}%`,
                }}
                title={`Input: ${trace.input_tokens.toLocaleString()}`}
              />
              <div
                className="h-full bg-purple-700/60"
                style={{
                  width: `${Math.max((trace.output_tokens / 200_000) * 100, 0.5)}%`,
                }}
                title={`Output: ${trace.output_tokens.toLocaleString()}`}
              />
            </div>
            <div className="flex gap-4 mt-1 text-[10px] text-ct-text-secondary">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded bg-blue-700/60" /> Input
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded bg-purple-700/60" /> Output
              </span>
            </div>
          </div>

          {/* Error */}
          {trace.error && (
            <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
              <h4 className="text-xs font-medium text-ct-red mb-1">Error</h4>
              <p className="text-xs text-ct-text">{trace.error}</p>
              {trace.response_status === 429 && (
                <p className="text-[10px] text-ct-text-secondary mt-1">
                  Rate limited — consider reducing concurrency or adding retries with backoff
                </p>
              )}
              {trace.response_status === 529 && (
                <p className="text-[10px] text-ct-text-secondary mt-1">
                  API overloaded — usually recovers within seconds
                </p>
              )}
            </div>
          )}

          {/* Tool Uses */}
          {hasToolUses && (
            <div>
              <h4 className="text-xs font-medium text-ct-text-secondary mb-1">
                Tool Calls ({trace.tool_uses.length})
              </h4>
              <div className="space-y-2">
                {trace.tool_uses.map((tu, i) => (
                  <div key={i} className="bg-ct-bg rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-ct-accent">{tu.name}</span>
                      <span className="text-[10px] text-ct-text-secondary font-mono">
                        {tu.id.slice(0, 12)}
                      </span>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      <JsonView data={tu.input} collapsed={true} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Results */}
          {hasToolResults && (
            <div>
              <h4 className="text-xs font-medium text-ct-text-secondary mb-1">
                Tool Results ({trace.tool_results.length})
              </h4>
              <div className="space-y-2">
                {trace.tool_results.map((tr, i) => (
                  <div
                    key={i}
                    className={`bg-ct-bg rounded p-2 ${
                      tr.is_error ? 'border border-ct-red/30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-ct-text-secondary font-mono">
                        {tr.tool_use_id.slice(0, 12)}
                      </span>
                      {tr.is_error && (
                        <span className="text-[10px] text-ct-red">error</span>
                      )}
                    </div>
                    <div className="max-h-40 overflow-auto">
                      <JsonView data={tr.content} collapsed={true} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Request / Response toggle */}
          <details>
            <summary className="text-xs text-ct-text-secondary cursor-pointer hover:text-ct-text">
              Raw Request Body
            </summary>
            <div className="mt-2 max-h-60 overflow-auto bg-ct-bg rounded p-2">
              <JsonView data={trace.request_body} collapsed={true} />
            </div>
          </details>

          <details>
            <summary className="text-xs text-ct-text-secondary cursor-pointer hover:text-ct-text">
              Raw Response Body
            </summary>
            <div className="mt-2 max-h-60 overflow-auto bg-ct-bg rounded p-2">
              <JsonView data={trace.response_body} collapsed={true} />
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

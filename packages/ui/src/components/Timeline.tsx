import React from 'react'
import type { TraceRecord } from '../types'
import { SpanCard } from './SpanCard'
import { formatCost, formatTokens, getContextUsage } from '../utils'

interface TimelineProps {
  traces: TraceRecord[]
  sessionId: string
}

export function Timeline({ traces, sessionId }: TimelineProps) {
  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-ct-text-secondary text-sm">
        No traces in this session
      </div>
    )
  }

  // Summary stats
  const totalCost = traces.reduce((sum, t) => sum + (t.cost || 0), 0)
  const totalInput = traces.reduce((sum, t) => sum + t.input_tokens, 0)
  const totalOutput = traces.reduce((sum, t) => sum + t.output_tokens, 0)
  const totalCacheRead = traces.reduce((sum, t) => sum + t.cache_read_tokens, 0)
  const avgLatency = traces.reduce((sum, t) => sum + t.latency_ms, 0) / traces.length
  const toolCalls = traces.reduce((sum, t) => sum + (t.tool_uses?.length || 0), 0)
  const errors = traces.filter(
    (t) => t.status === 'error' || (t.response_status && t.response_status >= 400)
  ).length

  return (
    <div className="flex flex-col h-full">
      {/* Session summary header */}
      <div className="p-4 border-b border-ct-border bg-ct-surface/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">
            Session <span className="font-mono text-ct-text-secondary">{sessionId.slice(0, 8)}</span>
          </h2>
          <span className="text-xs text-ct-text-secondary">{traces.length} API calls</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-ct-bg rounded-lg p-2.5">
            <div className="text-[10px] text-ct-text-secondary uppercase tracking-wider mb-0.5">Total Cost</div>
            <div className="text-lg font-mono text-ct-green">{formatCost(totalCost)}</div>
          </div>
          <div className="bg-ct-bg rounded-lg p-2.5">
            <div className="text-[10px] text-ct-text-secondary uppercase tracking-wider mb-0.5">Tokens</div>
            <div className="text-lg font-mono">
              {formatTokens(totalInput)}
              <span className="text-ct-text-secondary text-xs"> / </span>
              {formatTokens(totalOutput)}
            </div>
          </div>
          <div className="bg-ct-bg rounded-lg p-2.5">
            <div className="text-[10px] text-ct-text-secondary uppercase tracking-wider mb-0.5">Tool Calls</div>
            <div className="text-lg font-mono text-ct-accent">{toolCalls}</div>
          </div>
          <div className="bg-ct-bg rounded-lg p-2.5">
            <div className="text-[10px] text-ct-text-secondary uppercase tracking-wider mb-0.5">
              {errors > 0 ? 'Errors' : 'Avg Latency'}
            </div>
            <div className={`text-lg font-mono ${errors > 0 ? 'text-ct-red' : ''}`}>
              {errors > 0 ? errors : `${(avgLatency / 1000).toFixed(1)}s`}
            </div>
          </div>
        </div>

        {totalCacheRead > 0 && (
          <div className="mt-2 text-xs text-ct-green">
            Cache saved ~{formatTokens(totalCacheRead)} tokens (
            {((totalCacheRead / (totalInput + totalCacheRead)) * 100).toFixed(0)}% hit rate)
          </div>
        )}

        {/* Context window trend (mini sparkline) */}
        <div className="mt-3">
          <div className="text-[10px] text-ct-text-secondary mb-1">Context Window Usage Trend</div>
          <div className="flex items-end gap-px h-8">
            {traces.map((t, i) => {
              const usage = getContextUsage(t.input_tokens)
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${usage.color} opacity-70 hover:opacity-100 transition-opacity`}
                  style={{ height: `${Math.max(usage.percentage, 2)}%` }}
                  title={`#${i + 1}: ${usage.percentage.toFixed(1)}%`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-ct-text-secondary mt-0.5">
            <span>#1</span>
            <span>200K context limit</span>
            <span>#{traces.length}</span>
          </div>
        </div>
      </div>

      {/* Span list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {traces.map((trace, index) => (
          <SpanCard key={trace.id} trace={trace} index={index} />
        ))}
      </div>
    </div>
  )
}

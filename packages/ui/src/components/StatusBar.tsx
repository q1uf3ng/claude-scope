import React from 'react'
import type { Stats } from '../types'
import { formatCost, formatTokens } from '../utils'

interface StatusBarProps {
  stats: Stats | null
  activeSpans: number
}

export function StatusBar({ stats, activeSpans }: StatusBarProps) {
  return (
    <header className="bg-ct-surface border-b border-ct-border px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-ct-accent">Claude</span>
          <span className="text-ct-text">Scope</span>
        </h1>
        {activeSpans > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-ct-orange">
            <span className="w-2 h-2 rounded-full bg-ct-orange animate-pulse-glow" />
            {activeSpans} active
          </span>
        )}
      </div>

      {stats && (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-ct-text-secondary">Calls:</span>
            <span className="font-mono">{stats.total_calls}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-ct-text-secondary">Tokens:</span>
            <span className="font-mono">
              {formatTokens(stats.total_input_tokens + stats.total_output_tokens)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-ct-text-secondary">Cost:</span>
            <span className="font-mono text-ct-green">{formatCost(stats.total_cost)}</span>
          </div>
        </div>
      )}
    </header>
  )
}

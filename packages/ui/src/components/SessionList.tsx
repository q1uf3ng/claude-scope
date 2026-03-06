import React from 'react'
import type { Session } from '../types'
import { formatCost, formatDate, getModelShortName } from '../utils'

interface SessionListProps {
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-ct-text-secondary text-sm">
        <p className="mb-2">No sessions yet</p>
        <p className="text-xs">
          Point your Anthropic SDK to
          <br />
          <code className="bg-ct-bg px-1 rounded">http://localhost:3100/v1</code>
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto flex-1">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => onSelect(session.id)}
          className={`w-full text-left px-3 py-2.5 border-b border-ct-border hover:bg-ct-bg/50 transition-colors ${
            selectedId === session.id ? 'bg-ct-bg border-l-2 border-l-ct-accent' : ''
          }`}
        >
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs font-mono text-ct-text-secondary">
              {session.id.slice(0, 8)}
            </span>
            <span className="text-xs font-mono text-ct-green">
              {formatCost(session.total_cost)}
            </span>
          </div>
          <div className="text-xs text-ct-text-secondary mb-1">
            {formatDate(session.started_at)}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ct-text-secondary">
              {session.span_count} call{session.span_count !== 1 ? 's' : ''}
            </span>
            {session.models_used.map((model) => (
              <span
                key={model}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  model.includes('opus')
                    ? 'bg-purple-900/40 text-purple-300'
                    : model.includes('sonnet')
                    ? 'bg-blue-900/40 text-blue-300'
                    : 'bg-green-900/40 text-green-300'
                }`}
              >
                {getModelShortName(model)}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  )
}

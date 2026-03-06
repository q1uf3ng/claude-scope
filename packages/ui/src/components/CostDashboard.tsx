import React, { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type { DailyCost, Stats, Session } from '../types'
import { fetchDailyCosts } from '../api'
import { formatCost } from '../utils'

interface CostDashboardProps {
  stats: Stats | null
  sessions: Session[]
}

const MODEL_COLORS: Record<string, string> = {
  opus: '#bc8cff',
  sonnet: '#58a6ff',
  haiku: '#3fb950',
  unknown: '#8b949e',
}

function getModelCategory(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return 'unknown'
}

export function CostDashboard({ stats, sessions }: CostDashboardProps) {
  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([])

  useEffect(() => {
    fetchDailyCosts().then(setDailyCosts).catch(console.error)
  }, [])

  // Model breakdown for pie chart
  const modelBreakdown = stats
    ? Object.entries(stats.models).map(([model, count]) => ({
        name: getModelCategory(model),
        value: count,
        color: MODEL_COLORS[getModelCategory(model)] || MODEL_COLORS.unknown,
      }))
    : []

  // Merge duplicates
  const mergedModels = modelBreakdown.reduce<Array<{ name: string; value: number; color: string }>>(
    (acc, item) => {
      const existing = acc.find((a) => a.name === item.name)
      if (existing) {
        existing.value += item.value
      } else {
        acc.push({ ...item })
      }
      return acc
    },
    []
  )

  // Top sessions by cost
  const topSessions = [...sessions]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 5)

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">
      <h2 className="text-lg font-medium">Cost Dashboard</h2>

      {/* Daily cost chart */}
      <div className="bg-ct-surface rounded-lg border border-ct-border p-4">
        <h3 className="text-sm font-medium text-ct-text-secondary mb-3">Daily Costs</h3>
        {dailyCosts.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dailyCosts}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis
                dataKey="date"
                stroke="#8b949e"
                fontSize={10}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                stroke="#8b949e"
                fontSize={10}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [formatCost(value), 'Cost']}
              />
              <Line
                type="monotone"
                dataKey="cost"
                stroke="#3fb950"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-ct-text-secondary text-sm">
            No cost data yet
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Model distribution */}
        <div className="bg-ct-surface rounded-lg border border-ct-border p-4">
          <h3 className="text-sm font-medium text-ct-text-secondary mb-3">By Model</h3>
          {mergedModels.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={120} height={120}>
                <PieChart>
                  <Pie
                    data={mergedModels}
                    cx="50%"
                    cy="50%"
                    outerRadius={50}
                    innerRadius={25}
                    dataKey="value"
                  >
                    {mergedModels.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {mergedModels.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                    <span className="capitalize">{m.name}</span>
                    <span className="text-ct-text-secondary">{m.value} calls</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-ct-text-secondary text-sm">
              No data
            </div>
          )}
        </div>

        {/* Top sessions */}
        <div className="bg-ct-surface rounded-lg border border-ct-border p-4">
          <h3 className="text-sm font-medium text-ct-text-secondary mb-3">Top Sessions by Cost</h3>
          {topSessions.length > 0 ? (
            <div className="space-y-2">
              {topSessions.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-ct-text-secondary">#{i + 1}</span>
                    <span className="font-mono">{s.id.slice(0, 8)}</span>
                    <span className="text-ct-text-secondary">{s.span_count} calls</span>
                  </div>
                  <span className="font-mono text-ct-green">{formatCost(s.total_cost)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[120px] flex items-center justify-center text-ct-text-secondary text-sm">
              No sessions
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

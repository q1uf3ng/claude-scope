export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function getModelColor(model: string | null): string {
  if (!model) return 'text-ct-text-secondary'
  if (model.includes('opus')) return 'text-ct-opus'
  if (model.includes('sonnet')) return 'text-ct-sonnet'
  if (model.includes('haiku')) return 'text-ct-haiku'
  return 'text-ct-accent'
}

export function getModelBgColor(model: string | null): string {
  if (!model) return 'bg-ct-border'
  if (model.includes('opus')) return 'bg-purple-900/30 border-purple-700/50'
  if (model.includes('sonnet')) return 'bg-blue-900/30 border-blue-700/50'
  if (model.includes('haiku')) return 'bg-green-900/30 border-green-700/50'
  return 'bg-ct-surface'
}

export function getModelShortName(model: string | null): string {
  if (!model) return 'Unknown'
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  return model.split('-').slice(-1)[0]
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'complete': return 'text-ct-green'
    case 'error': return 'text-ct-red'
    case 'streaming':
    case 'pending': return 'text-ct-orange'
    default: return 'text-ct-text-secondary'
  }
}

const MAX_CONTEXT = 200_000

export function getContextUsage(inputTokens: number): {
  percentage: number
  color: string
} {
  const percentage = (inputTokens / MAX_CONTEXT) * 100
  let color = 'bg-ct-green'
  if (percentage > 80) color = 'bg-ct-red'
  else if (percentage > 50) color = 'bg-ct-orange'
  return { percentage: Math.min(percentage, 100), color }
}

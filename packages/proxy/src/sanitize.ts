/** Sanitize API keys in headers — keep first 6 and last 4 chars */
export function sanitizeApiKey(key: string): string {
  if (!key || key.length < 12) return '***'
  return `${key.slice(0, 6)}***${key.slice(-4)}`
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers }
  const sensitiveKeys = ['x-api-key', 'authorization', 'anthropic-api-key']

  for (const key of sensitiveKeys) {
    if (sanitized[key]) {
      sanitized[key] = sanitizeApiKey(sanitized[key])
    }
  }

  // Also check case-insensitive
  for (const [k, v] of Object.entries(sanitized)) {
    if (sensitiveKeys.includes(k.toLowerCase()) && v && !v.includes('***')) {
      sanitized[k] = sanitizeApiKey(v)
    }
  }

  return sanitized
}

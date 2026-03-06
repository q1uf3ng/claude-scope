import type { PricingTable, PricingEntry } from './types.js'

/** Default pricing table — update when Anthropic changes prices */
export const DEFAULT_PRICING: PricingTable = {
  // Claude Opus 4.6
  'claude-opus-4-6-20250415': {
    input_per_million: 15,
    output_per_million: 75,
    cache_read_multiplier: 0.1,
    cache_creation_multiplier: 1.25,
  },
  // Claude Sonnet 4.5
  'claude-sonnet-4-5-20250929': {
    input_per_million: 3,
    output_per_million: 15,
    cache_read_multiplier: 0.1,
    cache_creation_multiplier: 1.25,
  },
  // Claude Haiku 4.5
  'claude-haiku-4-5-20251001': {
    input_per_million: 0.8,
    output_per_million: 4,
    cache_read_multiplier: 0.1,
    cache_creation_multiplier: 1.25,
  },
  // Claude 3.5 Sonnet (legacy)
  'claude-3-5-sonnet-20241022': {
    input_per_million: 3,
    output_per_million: 15,
    cache_read_multiplier: 0.1,
    cache_creation_multiplier: 1.25,
  },
  // Claude 3.5 Haiku (legacy)
  'claude-3-5-haiku-20241022': {
    input_per_million: 0.8,
    output_per_million: 4,
    cache_read_multiplier: 0.1,
    cache_creation_multiplier: 1.25,
  },
}

/** Alias resolution for short model names */
const MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'claude-opus-4-6-20250415',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
}

/** Fallback pricing for unknown models */
const FALLBACK_PRICING: PricingEntry = {
  input_per_million: 3,
  output_per_million: 15,
  cache_read_multiplier: 0.1,
  cache_creation_multiplier: 1.25,
}

export function getPricing(model: string, customTable?: PricingTable): PricingEntry {
  const table = { ...DEFAULT_PRICING, ...customTable }
  const resolved = MODEL_ALIASES[model] || model

  // Exact match
  if (table[resolved]) return table[resolved]

  // Prefix match (e.g., claude-opus-4-6-20250415 matches claude-opus-4-6-*)
  for (const [key, entry] of Object.entries(table)) {
    if (resolved.startsWith(key) || key.startsWith(resolved)) {
      return entry
    }
  }

  return FALLBACK_PRICING
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  customTable?: PricingTable
): number {
  const pricing = getPricing(model, customTable)

  const inputCost = (inputTokens / 1_000_000) * pricing.input_per_million
  const outputCost = (outputTokens / 1_000_000) * pricing.output_per_million
  const cacheCreationCost =
    (cacheCreationTokens / 1_000_000) * pricing.input_per_million * pricing.cache_creation_multiplier
  const cacheReadCost =
    (cacheReadTokens / 1_000_000) * pricing.input_per_million * pricing.cache_read_multiplier

  return inputCost + outputCost + cacheCreationCost + cacheReadCost
}

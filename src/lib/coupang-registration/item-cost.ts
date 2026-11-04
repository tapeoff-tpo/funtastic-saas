import { money } from './model'

/** Read the same KRW column shown on 품목, without substituting old cost or CNY cost. */
export function itemNewCost(metadata: unknown): number | null {
  const root = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const item = root.esa009m && typeof root.esa009m === 'object' ? root.esa009m as Record<string, unknown> : {}
  const value = item['works 신규 원가']
  return typeof value === 'string' && !value.trim() ? null : money(value)
}

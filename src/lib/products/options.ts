type VariantOptionSource = {
  optionName?: string | null
  optionValues?: Record<string, string> | null
  isActive?: boolean | null
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

export function summarizeProductVariantOptions(variants: VariantOptionSource[]): string | null {
  const labels: string[] = []
  const seen = new Set<string>()

  for (const variant of variants) {
    if (variant.isActive === false) continue

    const values = variant.optionValues && typeof variant.optionValues === 'object'
      ? Object.entries(variant.optionValues)
          .map(([key, value]) => {
            const normalizedKey = normalizeText(key)
            const normalizedValue = normalizeText(value)
            if (!normalizedKey && !normalizedValue) return ''
            if (!normalizedKey) return normalizedValue
            if (!normalizedValue) return normalizedKey
            return `${normalizedKey}: ${normalizedValue}`
          })
          .filter(Boolean)
      : []

    const candidates = values.length > 0 ? values : [normalizeText(variant.optionName)]
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue
      seen.add(candidate)
      labels.push(candidate)
    }
  }

  return labels.length > 0 ? labels.join(', ') : null
}

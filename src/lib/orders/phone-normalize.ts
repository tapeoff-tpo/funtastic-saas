const PHONE_PATTERN = /0\d{1,3}[-\s.]?\d{3,4}[-\s.]?\d{4}/g

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 12) return null

  if (digits.startsWith('02')) {
    if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
    if (digits.length === 10) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  }

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }

  if (digits.length === 12 && digits.startsWith('050')) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`
  }

  return value.trim() || null
}

function isPreferredPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return /^(010|011|016|017|018|019|050)/.test(digits)
}

export function extractPhoneNumbers(...values: Array<string | null | undefined>): string[] {
  const phones: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const text = value?.trim()
    if (!text) continue

    const matches = text.match(PHONE_PATTERN) ?? [text]
    for (const match of matches) {
      const normalized = normalizePhone(match)
      if (!normalized) continue

      const key = normalized.replace(/\D/g, '')
      if (seen.has(key)) continue

      seen.add(key)
      phones.push(normalized)
    }
  }

  return phones
}

export function splitPhonePair(...values: Array<string | null | undefined>): {
  phone1: string | null
  phone2: string | null
} {
  const phones = extractPhoneNumbers(...values)
  if (phones.length === 0) {
    return { phone1: null, phone2: null }
  }

  const preferred = phones.find(isPreferredPhone) ?? phones[0]
  const other = phones.find((phone) => phone !== preferred) ?? null

  return {
    phone1: other,
    phone2: preferred,
  }
}

export function primaryPhone(...values: Array<string | null | undefined>): string {
  const { phone1, phone2 } = splitPhonePair(...values)
  return phone2 ?? phone1 ?? ''
}

export function secondaryPhone(...values: Array<string | null | undefined>): string {
  const { phone1 } = splitPhonePair(...values)
  return phone1 ?? ''
}

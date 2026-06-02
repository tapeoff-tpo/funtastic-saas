export type ShippingAddressLike = {
  zipCode?: string | null
  address1?: string | null
  address2?: string | null
}

export type NormalizedShippingAddress = {
  zipCode: string
  address1: string
  address2: string
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function extractZipFromLabeledText(value: string): { zipCode: string; rest: string } | null {
  const bracketMatch = value.match(/^\s*\[\s*(\d{5,6})\s*\]\s*(.*)$/)
  if (bracketMatch) {
    return { zipCode: bracketMatch[1], rest: bracketMatch[2] ?? '' }
  }

  const labeledMatch = value.match(
    /^\s*(?:\[\s*\]\s*)?(?:우편\s*번호|우편번호|우편|postal\s*code|zip(?:\s*code)?)\s*[:：]?\s*(\d{5,6})\s*(.*)$/i,
  )
  if (labeledMatch) {
    return { zipCode: labeledMatch[1], rest: labeledMatch[2] ?? '' }
  }

  return null
}

function stripAddressLabel(value: string): string {
  return value.replace(/^\s*(?:주소|배송지|배송주소|address)\s*[:：]?\s*/i, '').trim()
}

export function normalizeShippingAddress(address: ShippingAddressLike | null | undefined): NormalizedShippingAddress {
  const zipSource = cleanText(address?.zipCode)
  const address1Source = cleanText(address?.address1)
  const address2 = cleanText(address?.address2)

  const zipFromZipField = extractZipFromLabeledText(zipSource)
  const zipFromAddress = extractZipFromLabeledText(address1Source)
  const zipOnly = zipSource.match(/^\d{5,6}$/)?.[0]

  const zipCode = zipFromZipField?.zipCode
    ?? zipOnly
    ?? zipFromAddress?.zipCode
    ?? ''

  const address1 = stripAddressLabel(
    zipFromAddress ? zipFromAddress.rest : address1Source,
  )

  return {
    zipCode,
    address1,
    address2,
  }
}

export function formatShippingAddress(address: ShippingAddressLike | null | undefined): string {
  const normalized = normalizeShippingAddress(address)
  const parts = [
    normalized.zipCode ? `[${normalized.zipCode}]` : '',
    normalized.address1,
    normalized.address2,
  ].filter(Boolean)
  return parts.join(' ') || '-'
}

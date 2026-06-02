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

  const zipLabelPattern = String.raw`(?:\uc6b0\ud3b8\s*\ubc88\ud638|\uc6b0\ud3b8\ubc88\ud638|\uc6b0\ud3b8|postal\s*code|zip(?:\s*code)?)`
  const labeledMatch = value.match(
    new RegExp(String.raw`^\s*(?:\[\s*\]\s*)?${zipLabelPattern}\s*[:：]?\s*(\d{5,6})\s*(.*)$`, 'i'),
  )
  if (labeledMatch) {
    return { zipCode: labeledMatch[1], rest: labeledMatch[2] ?? '' }
  }

  return null
}

function stripAddressLabel(value: string): string {
  const addressLabelPattern = String.raw`(?:\uc8fc\uc18c|\ubc30\uc1a1\uc9c0|\ubc30\uc1a1\uc8fc\uc18c|address)`
  return value.replace(new RegExp(String.raw`^\s*${addressLabelPattern}\s*[:：]?\s*`, 'i'), '').trim()
}

function looksLikeRoadAddress(value: string): boolean {
  return /(?:\ub85c|\uae38)\s*\d/.test(value) || /(?:\ub85c|\uae38)\s+\S/.test(value)
}

function looksLikeJibunAddress(value: string): boolean {
  return /(?:\uc74d|\uba74|\ub3d9|\ub9ac)\s*\d/.test(value)
}

function preferRoadAddress(value: string): string {
  const roadLabelPattern = String.raw`(?:\ub3c4\ub85c\uba85\s*(?:\uc8fc\uc18c)?|\ub3c4\ub85c\uba85)`
  const jibunLabelPattern = String.raw`(?:\uc9c0\ubc88\s*(?:\uc8fc\uc18c)?|\uc9c0\ubc88)`
  const labeledRoad = value.match(
    new RegExp(String.raw`${roadLabelPattern}\s*[:：]?\s*(.+?)(?:\s+${jibunLabelPattern}\s*[:：]?\s*.+)?$`),
  )
  if (labeledRoad?.[1]) return stripAddressLabel(labeledRoad[1])

  const addressStarts = [
    '\uc11c\uc6b8\ud2b9\ubcc4\uc2dc',
    '\uc11c\uc6b8\uc2dc',
    '\ubd80\uc0b0\uad11\uc5ed\uc2dc',
    '\ubd80\uc0b0\uc2dc',
    '\ub300\uad6c\uad11\uc5ed\uc2dc',
    '\ub300\uad6c\uc2dc',
    '\uc778\ucc9c\uad11\uc5ed\uc2dc',
    '\uc778\ucc9c\uc2dc',
    '\uad11\uc8fc\uad11\uc5ed\uc2dc',
    '\uad11\uc8fc\uc2dc',
    '\ub300\uc804\uad11\uc5ed\uc2dc',
    '\ub300\uc804\uc2dc',
    '\uc6b8\uc0b0\uad11\uc5ed\uc2dc',
    '\uc6b8\uc0b0\uc2dc',
    '\uc138\uc885\ud2b9\ubcc4\uc790\uce58\uc2dc',
    '\uc138\uc885\uc2dc',
    '\uacbd\uae30\ub3c4',
    '\uac15\uc6d0\ud2b9\ubcc4\uc790\uce58\ub3c4',
    '\uac15\uc6d0\ub3c4',
    '\ucda9\uccad\ubd81\ub3c4',
    '\ucda9\ubd81',
    '\ucda9\uccad\ub0a8\ub3c4',
    '\ucda9\ub0a8',
    '\uc804\ubd81\ud2b9\ubcc4\uc790\uce58\ub3c4',
    '\uc804\ub77c\ubd81\ub3c4',
    '\uc804\ubd81',
    '\uc804\ub77c\ub0a8\ub3c4',
    '\uc804\ub0a8',
    '\uacbd\uc0c1\ubd81\ub3c4',
    '\uacbd\ubd81',
    '\uacbd\uc0c1\ub0a8\ub3c4',
    '\uacbd\ub0a8',
    '\uc81c\uc8fc\ud2b9\ubcc4\uc790\uce58\ub3c4',
    '\uc81c\uc8fc\ub3c4',
  ]
  const matches = [...value.matchAll(new RegExp(addressStarts.join('|'), 'g'))]
  if (matches.length < 2) return value

  for (let index = 1; index < matches.length; index += 1) {
    const splitIndex = matches[index].index ?? -1
    if (splitIndex <= 0) continue
    const first = value.slice(0, splitIndex).trim()
    const second = value.slice(splitIndex).trim()
    if (looksLikeRoadAddress(first) && looksLikeJibunAddress(second)) {
      return first
    }
  }

  return value
}

export function normalizeShippingAddress(address: ShippingAddressLike | null | undefined): NormalizedShippingAddress {
  const zipSource = cleanText(address?.zipCode)
  const address1Source = cleanText(address?.address1)
  const address2 = cleanText(address?.address2)

  const zipFromZipField = extractZipFromLabeledText(zipSource)
  const zipFromAddress = extractZipFromLabeledText(address1Source)
  const zipOnly = zipSource.match(/^\d{5,6}$/)?.[0]

  const zipCode = zipFromZipField
    ?.zipCode
    ?? zipOnly
    ?? zipFromAddress?.zipCode
    ?? ''

  const address1 = preferRoadAddress(stripAddressLabel(
    zipFromAddress ? zipFromAddress.rest : address1Source,
  ))

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

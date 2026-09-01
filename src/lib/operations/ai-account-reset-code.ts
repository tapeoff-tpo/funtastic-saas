const SEOUL_TIME_ZONE = 'Asia/Seoul'

export type WeeklyResetCodeResult = {
  code: string | null
  resetAt: Date | null
  error?: string
}

export function normalizeWeeklyResetCodeInput(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 3) return `0${digits}0000`
  if (digits.length === 4) return `${digits}0000`
  if (digits.length === 8) return digits
  return value.trim()
}

export function parseWeeklyResetCode(value: string, now = new Date()): WeeklyResetCodeResult {
  const normalized = normalizeWeeklyResetCodeInput(value)
  const digits = normalized.replace(/\D/g, '')
  if (!digits) return { code: null, resetAt: null }
  if (!/^\d{8}$/.test(digits)) {
    return { code: null, resetAt: null, error: '주간 초기화는 HHMMMMDD 형식으로 입력해주세요.' }
  }

  const hours = Number(digits.slice(0, 2))
  const minutes = Number(digits.slice(2, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  if (hours > 23 || minutes > 59) {
    return { code: null, resetAt: null, error: '주간 초기화 시간을 확인해주세요.' }
  }
  if (month === 0 && day === 0) return { code: digits, resetAt: null }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { code: null, resetAt: null, error: '주간 초기화 날짜를 확인해주세요.' }
  }

  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(dateParts.find((item) => item.type === type)?.value)
  const createDate = (year: number) => new Date(Date.UTC(year, month - 1, day, hours - 9, minutes))
  let resetAt = createDate(part('year'))
  const normalizedParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(resetAt)
  const normalizedPart = (type: Intl.DateTimeFormatPartTypes) => Number(normalizedParts.find((item) => item.type === type)?.value)
  if (normalizedPart('month') !== month || normalizedPart('day') !== day) {
    return { code: null, resetAt: null, error: '주간 초기화 날짜를 확인해주세요.' }
  }
  if (resetAt <= now) resetAt = createDate(part('year') + 1)
  return { code: digits, resetAt }
}

export function weeklyResetCodeValue(code: string | null, resetAt: string | Date | null) {
  const storedCode = code?.match(/^\d{8}$/)?.[0]
  if (storedCode) return storedCode
  if (!resetAt) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(resetAt))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || ''
  return `${part('hour')}${part('minute')}${part('month')}${part('day')}`
}

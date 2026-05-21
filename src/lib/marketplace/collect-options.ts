export const AUTO_MARKETPLACE_OPTIONS = [
  { marketplaceId: 'domeggook', displayName: '도매꾹' },
  { marketplaceId: 'onchannel', displayName: '온채널' },
  { marketplaceId: 'tobizon', displayName: '투비즈온' },
  { marketplaceId: 'domesin', displayName: '도매의신' },
  { marketplaceId: 'domechango', displayName: '도매창고' },
  { marketplaceId: 'specialoffer', displayName: '스페셜오퍼' },
  { marketplaceId: 'banana-b2b', displayName: '바나나B2B' },
  { marketplaceId: 'funtastic-b2b', displayName: '펀타스틱B2B' },
  { marketplaceId: 'ohouse', displayName: '오늘의집' },
  { marketplaceId: 'ssgmall', displayName: 'SSG' },
  { marketplaceId: 'cjonestyle', displayName: 'CJ온스타일' },
  { marketplaceId: 'ably', displayName: '에이블리' },
  { marketplaceId: 'hyundai-hmall', displayName: '현대홈쇼핑' },
  { marketplaceId: 'gs-shop', displayName: 'GS샵' },
  { marketplaceId: 'esm', displayName: 'ESM' },
  { marketplaceId: 'always', displayName: '올웨이즈' },
  { marketplaceId: 'elevenst', displayName: '11번가' },
  { marketplaceId: 'zigzag', displayName: '지그재그' },
  { marketplaceId: 'toss-shopping', displayName: '토스쇼핑' },
  { marketplaceId: 'playauto-emp', displayName: '플레이오토 EMP' },
] as const

export const MARKETPLACE_DISPLAY_NAMES: Record<string, string> = {
  '10x10': '텐바이텐',
  ably: '에이블리',
  always: '올웨이즈',
  auction: '옥션',
  'banana-b2b': '바나나B2B',
  'funtastic-b2b': '펀타스틱B2B',
  cafe24: 'Cafe24',
  cjonestyle: 'CJ온스타일',
  coupang: '쿠팡',
  domeggook: '도매꾹',
  domesin: '도매의신',
  domechango: '도매창고',
  elevenst: '11번가',
  esm: 'ESM',
  gmarket: 'G마켓',
  'gs-shop': 'GS샵',
  'hyundai-hmall': '현대홈쇼핑',
  'kakao-store': '카카오톡스토어',
  naver: '네이버 스마트스토어',
  ohouse: '오늘의집',
  onchannel: '온채널',
  ownerclan: '오너클랜',
  ssgmall: 'SSG',
  specialoffer: '스페셜오퍼',
  tobizon: '투비즈온',
  'toss-shopping': '토스쇼핑',
  'playauto-emp': '플레이오토 EMP',
  zigzag: '지그재그',
}

function normalizeMarketplaceKey(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, '')
}

const MARKETPLACE_DISPLAY_BY_NORMALIZED_KEY = Object.fromEntries(
  Object.entries(MARKETPLACE_DISPLAY_NAMES).map(([key, label]) => [
    normalizeMarketplaceKey(key),
    label,
  ]),
)

export function resolveMarketplaceDisplayName(marketplaceId: string, rawName?: unknown): string {
  const fallback = MARKETPLACE_DISPLAY_NAMES[marketplaceId] ?? marketplaceId
  if (typeof rawName !== 'string') return fallback

  const trimmed = rawName.trim()
  if (!trimmed) return fallback

  const normalized = normalizeMarketplaceKey(trimmed)
  if (normalized === 'sabangnet') return fallback

  return MARKETPLACE_DISPLAY_BY_NORMALIZED_KEY[normalized] ?? trimmed
}

export type AutoMarketplaceOption = (typeof AUTO_MARKETPLACE_OPTIONS)[number]

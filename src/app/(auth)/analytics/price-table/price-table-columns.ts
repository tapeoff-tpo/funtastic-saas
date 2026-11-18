import { REGISTRATION_EDIT_PREFIX, registrationIdentifiersKey, registrationNumberKey } from '@/lib/analytics/price-registration-values'
import { isPriceNumberDateKey } from '@/lib/analytics/price-number-date'

export type PriceTableDisplayColumn = {
  id: string
  label: string
  valueKey: string
  valueLabel?: string
  details?: Array<{
    key: string
    label: string
    format?: 'money' | 'text'
  }>
  format?: 'money' | 'text'
  defaultVisible?: boolean
  productIdKeys?: string[]
  showProductId?: boolean
}

export const PRODUCT_ID_FIELD_PATTERN = /(?:등록\s*)?(?:상품|제품)\s*(?:번호|코드|id)|판매자\s*상품\s*코드/i
export const CORE_PRODUCT_ID_KEYS = new Set(['상품코드', '사방넷상품코드', '제품코드'])
const TOKEN_NOISE_PATTERN = /(?:판매가격?|공급가격?|정산희망\s*가격|매입가|배송비|추가금|신사이트|현재|기준|등록|가격으로|상품|제품|번호|코드|id|사이트|판매중단)/gi

const productRegistrationColumns: PriceTableDisplayColumn[] = [
  priceColumn('b2b', 'B2B', 'B2B 판매가', 'b2b 배송비', true, [
    { key: 'B2B 옵션 추가금', label: '옵션', format: 'money' },
  ]),
  priceColumn('b2c', 'B2C', 'B2C 판매가', 'b2c 배송비', true, [
    { key: 'B2C 옵션 추가금', label: '옵션', format: 'money' },
  ]),
  priceColumn('domeme', '도매꾹', '★ 판매가', '★ 배송비'),
  priceColumn('domemae', '도매매', '★ 판매가 2', '★ 배송비 2'),
  priceColumn('onchannel', '온채널', '★ 온채널가', '★ 배송비 3'),
  priceColumn('firstmall', '퍼스트몰', 'B2B 가격으로 등록 판매가', 'B2B 가격으로 등록 배송비'),
  priceColumn('funtab2b', '펀타B2B', '★펀타B2B 신사이트 판매가', 'B2B 가격으로 등록 배송비 2'),
  priceColumn('ownerclan', '오너클랜', '★ 공급가', '★ 배송비 4'),
  priceColumn('domechango', '도매창고', '★ 공급가 2', '★ 배송비 5'),
  priceColumn('wtrading', 'W트레이딩', '★ 정산희망 가격', '★ 배송비 6'),
  priceColumn('domesin', '도매의신', '★ 공급가 3', '★ 배송비 7'),
  priceColumn('funn', '펀앤', '판매중단 공급가', '판매중단 배송비'),
  priceColumn('tobizon', '투비즈온', '★ 공급가격', '★ 배송비 8'),
  priceColumn('specialoffer', '스페셜오퍼', '★ 매입가', '★ 배송비 9'),
  priceColumn('banana', '바나나B2B', '★ 판매가 3', '★ 배송비 10'),
  priceColumn('tenbyten', '텐바이텐', 'tapeofff 판매가', '★ 배송비 11'),
  priceColumn('coupang', '쿠팡', 'belload89 판매가', '★ 배송비 12', true),
  priceColumn('smartstore-home', '스마트스토어 집정리', '집정리(구살림딜) 판매가', 'hu4umart 배송비', true, [], ['스마트스토어 상품코드']),
  priceColumn('smartstore-life', '스마트스토어 생활살림', '생활살림 판매가', 'ncp_1nl4wa_01 배송비', false, [], ['스마트스토어 상품코드 2']),
  priceColumn('smartstore-nat', '스마트스토어 낫카페', '낫카페 판매가', 'belload89 배송비', false, [], ['스마트스토어 상품코드 3']),
  priceColumn('smartstore-18', '스마트스토어 18제곱미터', '스마트스토어 18.제곱미터 판매가', '스마트스토어 18.제곱미터 배송비', false, [], ['스마트스토어 18.제곱미터 상품코드']),
  priceColumn('cafe24', '카페24', '집정리 판매가', '집정리 배송비', true),
  priceColumn('kakao-funta', '카카오 펀타스틱', 'tapeoff (166967) 판매가', '★ 배송비 13'),
  priceColumn('kakao-life', '카카오 생활살림', 'tapeoff1 (166968) 판매가', '★ 배송비 14'),
  priceColumn('kakao-gift', '카카오 선물하기', 'tapeoff1 판매가', 'tapeoff1 배송비'),
  priceColumn('ohouse', '오늘의집', 'tapeoff 판매가', 'tapeoff 배송비', true),
  priceColumn('ably', '에이블리', 'ruth 판매가', '낫카페-scott 배송비'),
  priceColumn('toss', '토스쇼핑', '생활살림 판매가 2', '생활살림 배송비'),
  priceColumn('ssg', 'SSG.COM', '0024772374 판매가', '★ 배송비 15'),
  priceColumn('cj', 'CJ온스타일', 'tapeoff1 판매가 2', 'tapeoff1 배송비 2'),
  priceColumn('gs', 'GS샵', '★ 판매가 4', '★ 배송비 16'),
  priceColumn('ns', 'NS몰', '1003046 판매가', '★ 배송비 17'),
  priceColumn('hyundai', '현대H몰', 'hsian 판매가', 'hsian 배송비'),
  priceColumn('moongori', '문고리닷컴', 'tapeoff 판매가 2', '판매중단 배송비 2'),
  priceColumn('1300k', '1300K', 'tapeoff 판매가 3', 'tapeoff 배송비 2'),
  priceColumn('ohouse-home', '오늘의집 집정리', '오늘의집(집정리) 판매가', '★belload89 배송비'),
  priceColumn('wemakeprice', '위메프', 'tapeoff 판매가 4', '★ 배송비 18'),
  priceColumn('gmarket', 'G마켓', 'tapeoff 판매가격', 'tapeoff 배송비 3', true),
  priceColumn('auction', '옥션', 'tapeoff 판매가격 2', '★ 배송비 19', true),
  priceColumn('tmon', '티몬', 'belload89 판매가 2', '★ 배송비 20'),
  priceColumn('tmon-deal', '티몬 특가', '티몬(T-특가딜 tapeof01, 고정 수수료 10%) 판매가', '티몬(T-특가딜 tapeof01, 고정 수수료 10%) 배송비'),
  priceColumn('11st', '11번가', 'tapeoff 판매가 5', '★ 배송비 21'),
  priceColumn('interpark', '인터파크', 'tapeoff 판매가 6', '★ 배송비 22'),
  priceColumn('crazybox', '크레이지박스', '크레이지박스(T) 판매가', '크레이지박스(T) 배송비'),
  priceColumn('lotte', '롯데닷컴', '롯데닷컴(T) 판매가', '롯데닷컴(T) 배송비'),
  priceColumn('lotteon', '롯데ON', 'LD477300 판매가', '★ 배송비 23'),
  priceColumn('woori', '우리샵', '우리샵(T) 판매가', '우리샵(T) 배송비'),
  priceColumn('daiso', '다이소몰', 'tapeoff01 판매가', '★ 배송비 24'),
  priceColumn('lfmall', 'LF몰', 'tapeoff 판매가 7', '★ 배송비 25'),
  priceColumn('ggumigi', '집꾸미기', 'tapeoff 판매가 8', 'tapeoff 배송비 4'),
  priceColumn('zigzag', '지그재그', 'tapeoff1@daum.net 판매가', '낫카페(240076) / 1530(5002745) 배송비'),
  priceColumn('mongttang', '몽땅뚝딱', 'tapeoff 판매가 9', '(사방넷)인테리어T 배송비'),
  priceColumn('10000recipe', '만개의레시피', 'A924 판매가', 'A924 배송비'),
  priceColumn('smartstore-1530', '스마트스토어 일오삼공', '일오삼공 판매가', '일오삼공 배송비', false, [], ['스마트스토어 상품코드 4']),
  priceColumn('hiver', '하이버', 'tapeoff1 판매가 3', 'tapeoff1 배송비 3'),
  priceColumn('vanessdeco', '바네스데코', 'songarak007 판매가', 'songarak007 배송비'),
  priceColumn('funhome', '집정리 funhome', 'funhome 판매가', 'funhome 배송비'),
  priceColumn('funta-card', '펀타 카드몰', '★cafe24 (펀타 카드사이트) 판매가', 'B2B 가격으로 등록 배송비 3'),
]

const ACTIVE_MARKETPLACE_IDS = new Set([
  'b2b', 'b2c', 'domeme', 'domemae', 'onchannel', 'firstmall', 'funtab2b', 'ownerclan',
  'domechango', 'domesin', 'tobizon', 'specialoffer', 'banana', 'tenbyten', 'coupang',
  'smartstore-home', 'smartstore-life', 'smartstore-nat', 'smartstore-18', 'kakao-funta',
  'kakao-life', 'kakao-gift', 'ohouse', 'ably', 'toss', 'ssg', 'cj', 'gs', 'ns', 'hyundai',
  'ohouse-home', 'gmarket', 'auction', '11st', 'zigzag', 'smartstore-1530', 'funta-card',
])

const mainColumns: PriceTableDisplayColumn[] = [
  { id: 'current-funta', label: '기존 펀타가격', valueKey: '기존 펀타가격', format: 'money', defaultVisible: true },
  {
    id: 'main-b2b',
    label: 'B2B 합계',
    valueKey: 'B2B b2b 판매가+추가금',
    valueLabel: '합계',
    format: 'money',
    defaultVisible: true,
    details: [
      { key: 'B2B 판매가', label: '기본', format: 'money' },
      { key: 'B2B 옵션 추가금', label: '옵션', format: 'money' },
    ],
  },
  {
    id: 'main-b2c',
    label: 'B2C 합계',
    valueKey: '0.3 b2c 판매가+추가금',
    valueLabel: '합계',
    format: 'money',
    defaultVisible: true,
    details: [
      { key: 'B2C 판매가', label: '기본', format: 'money' },
      { key: 'B2C 옵션 추가금', label: '옵션', format: 'money' },
    ],
  },
  { id: 'tmon-current', label: '티몬 현재 판매가', valueKey: '0.3 티몬기준 현재 판매가', format: 'money', defaultVisible: true },
  { id: 'main-gap', label: 'B2C 기존가 차액', valueKey: '0.3 b2c 기존과 차액', format: 'money', defaultVisible: true },
  { id: 'cost', label: '원가', valueKey: '0.3 원가', format: 'money', defaultVisible: true },
  {
    id: 'b2b-margin',
    label: 'B2B 마진',
    valueKey: '변경 후 b2b 마진액',
    valueLabel: '마진액',
    format: 'money',
    defaultVisible: true,
    details: [{ key: '변경 후 b2b 마진률', label: '마진률', format: 'money' }],
  },
  {
    id: 'b2c-margin',
    label: 'B2C 마진',
    valueKey: '사이트 수수료 b2c 마진액',
    valueLabel: '마진액',
    format: 'money',
    defaultVisible: true,
    details: [{ key: '0.2 b2c 마진률', label: '마진률', format: 'money' }],
  },
]

const wholesaleColumns: PriceTableDisplayColumn[] = [
  priceColumn('new-domeme', '도매꾹', '도매꾹(T) 판매가', '도매꾹(T) 배송비', true),
  priceColumn('new-domemae', '도매매', '도매매(T) 판매가', '도매매(T) 배송비', true),
  priceColumn('new-ownerclan', '오너클랜', '오너클랜(T) 공급가', '오너클랜(T) 배송비', true),
  priceColumn('new-domechango', '도매창고', '도매창고(T) 공급가', '도매창고(T) 배송비', true),
  priceColumn('new-wtrading', 'W트레이딩', 'W트레이딩 정산희망 가격', 'W트레이딩 배송비', true),
  priceColumn('new-domesin', '도매의신', '도매의신 공급가', '도매의신 배송비', true),
  priceColumn('new-funn', '펀앤', '펀앤 공급가', '펀앤 배송비', true),
  priceColumn('new-tobizon', '투비즈온', '투비즈온 공급가격', '투비즈온 배송비', true),
]

export const PRICE_TABLE_SOURCE_NUMBER_KEYS = ['no', 'NO', 'No', 'no.', 'NO.', 'No.'] as const

export function getPriceTableSourceNumber(sheetName: string, rawData: Record<string, unknown>) {
  if (sheetName !== '상품등록' && sheetName !== '뉴도매') return null
  for (const key of PRICE_TABLE_SOURCE_NUMBER_KEYS) {
    const value = rawData[key]
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function getPriceTableDisplayColumns(sheetName: string) {
  if (sheetName === '메인') return mainColumns
  if (sheetName === '뉴도매') return wholesaleColumns
  return productRegistrationColumns
}

export function getRegistrationMarketplaceColumns() {
  return productRegistrationColumns.filter((column) => ACTIVE_MARKETPLACE_IDS.has(column.id))
}

export function getRegistrationTargets(sheetName: string, ids: string[]) {
  const columns = sheetName === '뉴도매' ? getPriceTableDisplayColumns(sheetName) : getRegistrationMarketplaceColumns()
  return columns.filter((column) => column.showProductId && column.id !== 'b2b' && column.id !== 'b2c'
    && (ids.length === 0 || ids.includes(column.id)))
}

export function getInactiveRegistrationMarketplaceColumns() {
  return productRegistrationColumns.filter((column) => !ACTIVE_MARKETPLACE_IDS.has(column.id))
}

type IdentifierIndex = {
  keys: string[]
  tokens?: Map<PriceTableDisplayColumn, string[]>
  candidates: Array<{ key: string; value: string; normalizedKey: string; index: number }>
}

function indexIdentifiers(rawData: Record<string, string>): IdentifierIndex {
  const keys = Object.keys(rawData)
  return {
    keys,
    candidates: Object.entries(rawData).flatMap(([key, value], index) =>
      !isPriceNumberDateKey(key) && !key.startsWith(REGISTRATION_EDIT_PREFIX)
        && PRODUCT_ID_FIELD_PATTERN.test(key) && !CORE_PRODUCT_ID_KEYS.has(compactKey(key))
        && isProductIdentifier(value) ? [{ key, value, normalizedKey: key.toLowerCase().replace(/\s+/g, ''), index }] : []),
  }
}

export function createMarketplaceIdentifierReaders(rows: Record<string, string>[], columns: PriceTableDisplayColumn[]) {
  const tokens = new Map(columns.map((column) => [column, marketplaceTokens(column)]))
  return new Map(rows.map((raw) => {
    const index = { ...indexIdentifiers(raw), tokens }
    return [raw, (column: PriceTableDisplayColumn) => findMarketplaceProductIds(raw, column, index)] as const
  }))
}

export function findMarketplaceProductIds(
  rawData: Record<string, string>,
  column: PriceTableDisplayColumn,
  prepared?: IdentifierIndex,
) {
  const savedIdentifiers = rawData[registrationIdentifiersKey(column.id)]
  if (typeof savedIdentifiers === 'string') {
    try {
      const values: unknown = JSON.parse(savedIdentifiers)
      if (Array.isArray(values) && values.every((entry) => entry && typeof entry === 'object'
        && typeof entry.key === 'string' && typeof entry.value === 'string')) {
        return values.filter((entry) => isProductIdentifier(entry.value)).map(({ key, value }) => ({ key, value }))
      }
    } catch { /* Fall back to the imported identifiers if a saved value is malformed. */ }
  }
  const savedKey = registrationNumberKey(column.id)
  if (isProductIdentifier(rawData[savedKey])) return [{ key: savedKey, value: rawData[savedKey] }]
  const manualIdentifierKey = `${column.label} 상품번호`
  if (isProductIdentifier(rawData[manualIdentifierKey])) return [{ key: manualIdentifierKey, value: rawData[manualIdentifierKey] }]
  if (column.id === 'b2b' || column.id === 'b2c') return []
  const exactKeys = column.productIdKeys ?? []
  const exactMatches = exactKeys
    .map((key) => ({ key, value: rawData[key] }))
    .filter((entry): entry is { key: string; value: string } => isProductIdentifier(entry.value))
  if (exactKeys.length) return exactMatches

  const tokens = prepared?.tokens?.get(column) ?? marketplaceTokens(column)
  if (!tokens.length) return []

  const indexed = prepared ?? indexIdentifiers(rawData)
  let bestScore = 0
  const matches: Array<{ key: string; value: string }> = []
  for (const entry of indexed.candidates) {
    const score = identifierKeyScore(entry.normalizedKey, tokens)
    if (score > bestScore) {
      bestScore = score
      matches.length = 0
    }
    if (score > 0 && score === bestScore) matches.push({ key: entry.key, value: entry.value })
  }
  if (matches.length) return matches.sort((left, right) => left.key.localeCompare(right.key, 'ko'))

  const priceIndex = indexed.keys.indexOf(column.valueKey)
  if (priceIndex < 0) return []
  let nearest: { key: string; value: string } | null = null
  let nearestDistance = 5
  for (const entry of indexed.candidates) {
    const distance = Math.abs(entry.index - priceIndex)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { key: entry.key, value: entry.value }
    }
  }
  return nearest ? [nearest] : []
}

function priceColumn(
  id: string,
  label: string,
  valueKey: string,
  shippingKey: string,
  defaultVisible = false,
  extraDetails: PriceTableDisplayColumn['details'] = [],
  productIdKeys?: string[],
): PriceTableDisplayColumn {
  return {
    id,
    label,
    valueKey,
    format: 'money',
    defaultVisible,
    showProductId: true,
    productIdKeys,
    details: [
      ...extraDetails,
      { key: shippingKey, label: '배송', format: 'money' },
    ],
  }
}

function marketplaceTokens(column: PriceTableDisplayColumn) {
  const sources = [
    column.label,
    column.valueKey,
    ...(column.details ?? []).map((detail) => detail.key),
  ]
  const tokens = sources.flatMap((source) => {
    const cleaned = source
      .replace(TOKEN_NOISE_PATTERN, ' ')
      .replace(/[★()@._/,-]/g, ' ')
      .replace(/\b\d+\b/g, ' ')
      .toLowerCase()
    return cleaned.split(/\s+/).filter((token) => token.length >= 2)
  })
  return [...new Set(tokens)]
}

function identifierKeyScore(normalizedKey: string, tokens: string[]) {
  return tokens.reduce((score, token) => {
    const normalizedToken = token.replace(/\s+/g, '')
    if (!normalizedToken || !normalizedKey.includes(normalizedToken)) return score
    return score + Math.max(1, normalizedToken.length)
  }, 0)
}

function compactKey(value: string) {
  return value.replace(/\s+/g, '')
}

export function isProductIdentifier(value: string | undefined): value is string {
  if (!value) return false
  const normalized = value.replace(/\s+/g, '').toLowerCase()
  return !['', '0', '-', '미등록', '없음', 'null', 'undefined', '확인필요', '등록필요'].includes(normalized)
}


export function getManualRegistrationTargets(sheetName: string) {
  return sheetName === '뉴도매' ? getRegistrationTargets(sheetName, [])
    : [...getRegistrationTargets(sheetName, []), ...getInactiveRegistrationMarketplaceColumns()
      .filter((column) => !['b2b', 'b2c'].includes(column.id))]
}

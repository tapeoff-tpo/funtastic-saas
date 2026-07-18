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

const PRODUCT_ID_FIELD_PATTERN = /(?:등록\s*)?(?:상품|제품)\s*(?:번호|코드|id)|판매자\s*상품\s*코드/i
const CORE_PRODUCT_ID_KEYS = new Set(['상품코드', '사방넷상품코드', '제품코드'])
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
  priceColumn('smartstore-home', '스마트스토어 집정리', '집정리(구살림딜) 판매가', 'hu4umart 배송비', true),
  priceColumn('smartstore-life', '스마트스토어 생활살림', '생활살림 판매가', 'ncp_1nl4wa_01 배송비'),
  priceColumn('smartstore-nat', '스마트스토어 낫카페', '낫카페 판매가', 'belload89 배송비'),
  priceColumn('smartstore-18', '스마트스토어 18제곱미터', '스마트스토어 18.제곱미터 판매가', '스마트스토어 18.제곱미터 배송비'),
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
  priceColumn('smartstore-1530', '스마트스토어 일오삼공', '일오삼공 판매가', '일오삼공 배송비'),
  priceColumn('hiver', '하이버', 'tapeoff1 판매가 3', 'tapeoff1 배송비 3'),
  priceColumn('vanessdeco', '바네스데코', 'songarak007 판매가', 'songarak007 배송비'),
  priceColumn('funhome', '집정리 funhome', 'funhome 판매가', 'funhome 배송비'),
  priceColumn('funta-card', '펀타 카드몰', '★cafe24 (펀타 카드사이트) 판매가', 'B2B 가격으로 등록 배송비 3'),
]

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

export function getPriceTableDisplayColumns(sheetName: string) {
  if (sheetName === '메인') return mainColumns
  if (sheetName === '뉴도매') return wholesaleColumns
  return productRegistrationColumns
}

export function findMarketplaceProductIds(
  rawData: Record<string, string>,
  column: PriceTableDisplayColumn,
) {
  const exactKeys = column.productIdKeys ?? []
  const exactMatches = exactKeys
    .map((key) => ({ key, value: rawData[key] }))
    .filter((entry): entry is { key: string; value: string } => Boolean(entry.value))
  if (exactMatches.length) return exactMatches

  const tokens = marketplaceTokens(column)
  if (!tokens.length) return []

  const candidates = Object.entries(rawData)
    .filter(([key, value]) => value && PRODUCT_ID_FIELD_PATTERN.test(key) && !CORE_PRODUCT_ID_KEYS.has(compactKey(key)))
    .map(([key, value]) => ({ key, value, score: identifierKeyScore(key, tokens) }))
  const namedMatches = candidates
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key, 'ko'))
    .filter((entry, index, entries) => index === 0 || entry.score === entries[0]?.score)
    .map(({ key, value }) => ({ key, value }))
  if (namedMatches.length) return namedMatches

  const keys = Object.keys(rawData)
  const priceIndex = keys.indexOf(column.valueKey)
  if (priceIndex < 0) return []
  const nearbyMatch = candidates
    .map((entry) => ({ ...entry, distance: Math.abs(keys.indexOf(entry.key) - priceIndex) }))
    .filter((entry) => entry.distance <= 4)
    .sort((left, right) => left.distance - right.distance)[0]
  return nearbyMatch ? [{ key: nearbyMatch.key, value: nearbyMatch.value }] : []
}

function priceColumn(
  id: string,
  label: string,
  valueKey: string,
  shippingKey: string,
  defaultVisible = false,
  extraDetails: PriceTableDisplayColumn['details'] = [],
): PriceTableDisplayColumn {
  return {
    id,
    label,
    valueKey,
    format: 'money',
    defaultVisible,
    showProductId: true,
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

function identifierKeyScore(key: string, tokens: string[]) {
  const normalizedKey = key.toLowerCase().replace(/\s+/g, '')
  return tokens.reduce((score, token) => {
    const normalizedToken = token.replace(/\s+/g, '')
    if (!normalizedToken || !normalizedKey.includes(normalizedToken)) return score
    return score + Math.max(1, normalizedToken.length)
  }, 0)
}

function compactKey(value: string) {
  return value.replace(/\s+/g, '')
}

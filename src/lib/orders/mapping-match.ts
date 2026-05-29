/**
 * 매핑 매칭 helper — 사방넷 방식 품번/단품 분리.
 *
 * 사용자 시나리오:
 *   - 품번매핑(`marketplace_option_id = ''`): 그 품번 아래 모든 옵션이 같은 매핑코드로 묶임
 *   - 단품매핑(`marketplace_option_id != ''`): 특정 옵션만 별도 매핑코드로 묶임
 *
 * 매칭 우선순위:
 *   1) 단품매핑 정확일치(`{productId}{SEP}{optionId}` == marketplaceItemId)
 *   2) 품번매핑 — productId 가 marketplaceItemId 와 같거나, marketplaceItemId 가 `{productId}{SEP}` 로 시작
 *   3) 둘 다 없으면 미매핑
 *
 * SEP 은 일단 '-' 고정. 마켓별 separator 차이가 생기면 마켓 설정으로 확장.
 */

export const MAPPING_SEPARATOR = '-'
export const EXACT_OPTION_ID = '__exact__'

const ORDER_NUMBER_MAPPING_PATTERNS: Partial<Record<string, RegExp[]>> = {
  onchannel: [/^MO_\d+$/i],
  naver: [/^20\d{14}$/],
  ownerclan: [/^20\d{12,}A(?:-.+)?$/],
  ssgmall: [/^20\d{12,}(?:-.+)?$/],
}

const LINE_SEQUENCE_MAPPING_PATTERNS: Partial<Record<string, RegExp[]>> = {
  cjonestyle: [/^\d{3}-\d{3}-\d{3}$/],
}

export function isOrderNumberMappingCandidate(marketplaceId: string, candidateId: string): boolean {
  const patterns = ORDER_NUMBER_MAPPING_PATTERNS[marketplaceId] ?? []
  const normalized = candidateId.trim()
  return normalized.length > 0 && patterns.some((pattern) => pattern.test(normalized))
}

export function isLineSequenceMappingCandidate(marketplaceId: string, candidateId: string): boolean {
  const patterns = LINE_SEQUENCE_MAPPING_PATTERNS[marketplaceId] ?? []
  const normalized = candidateId.trim()
  return normalized.length > 0 && patterns.some((pattern) => pattern.test(normalized))
}

export function isIgnoredMappingCandidate(marketplaceId: string, candidateId: string): boolean {
  return isOrderNumberMappingCandidate(marketplaceId, candidateId)
    || isLineSequenceMappingCandidate(marketplaceId, candidateId)
}

export function isBlockedMappingSource(marketplaceId: string, marketplaceProductId: string): boolean {
  return isOrderNumberMappingCandidate(marketplaceId, marketplaceProductId)
    || isLineSequenceMappingCandidate(marketplaceId, marketplaceProductId)
}

export function isBlockedMappingSourcePair(
  marketplaceId: string,
  marketplaceProductId: string,
  marketplaceOptionId?: string | null,
): boolean {
  if (isBlockedMappingSource(marketplaceId, marketplaceProductId)) return true

  // CJ order-line ids can be split as product=`002`, option=`001-001`.
  // That pair still means "second row in this order", not a reusable product key.
  return marketplaceId === 'cjonestyle'
    && /^\d{3}$/.test(marketplaceProductId.trim())
    && /^\d{3}-\d{3}$/.test((marketplaceOptionId ?? '').trim())
}

export type MappingSource = {
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
  productNameSnapshot?: string | null
  optionNameSnapshot?: string | null
  /** sources 가 가리키는 매핑코드 식별자 (예: components 그룹 키 등 호출자 자유) */
  ref: string
}

export type MappingIndex = {
  /** key = `${marketplaceId}:${productId}${SEP}${optionId}` */
  optionMap: Map<string, string>
  /** key = `${marketplaceId}:${productId}`; only matches orders without option text */
  exactProductMap: Map<string, string>
  /** key = `${marketplaceId}:${productId}` */
  productMap: Map<string, string>
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function pushRecordValues(record: Record<string, unknown>, keys: string[], values: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key])
    if (value) values.push(value)
  }
}

/**
 * Some marketplaces keep the order-line id and product mapping id separate.
 * CJ온스타일 is one example: marketplaceItemId is the line sequence
 * (`001-001-001`), while rawData.itemCode/vendorItemCode hold the product ids.
 */
export function getRawMappingCandidateIds(rawData: unknown): string[] {
  const record = asPlainRecord(rawData)
  if (!record) return []

  const keys = [
    'optionManageCode',
    'productId',
    'originalProductId',
    'sellerProductCode',
    'itemKey',
    'itemCode',
    'vendorItemCode',
    'affiliateItemCode',
    'productCode',
    'goodsCode',
    'goodsNo',
    'itemNo',
    'originProductNo',
    'sellerProductCode',
    'sellerItemCode',
    'marketplaceProductId',
    'marketplaceItemId',
    'optionCode',
  ]

  const values: string[] = []
  pushRecordValues(record, keys, values)

  const productOrders = Array.isArray(record.productOrders) ? record.productOrders : []
  for (const rawProductOrder of productOrders) {
    const productOrder = asPlainRecord(rawProductOrder)
    if (productOrder) pushRecordValues(productOrder, keys, values)
  }

  const originalData = Array.isArray(record.originalData) ? record.originalData : []
  for (const rawOriginal of originalData) {
    const original = asPlainRecord(rawOriginal)
    const productOrder = asPlainRecord(original?.productOrder)
    if (productOrder) pushRecordValues(productOrder, keys, values)
  }

  const products = Array.isArray(record.products) ? record.products : []
  for (const rawProduct of products) {
    const product = asPlainRecord(rawProduct)
    if (product) pushRecordValues(product, keys, values)
  }

  return Array.from(new Set(values))
}

export function buildMappingIndex(sources: MappingSource[]): MappingIndex {
  const optionMap = new Map<string, string>()
  const exactProductMap = new Map<string, string>()
  const productMap = new Map<string, string>()

  for (const s of sources) {
    if (s.marketplaceOptionId) {
      const sourceKey = `${s.marketplaceProductId}${MAPPING_SEPARATOR}${s.marketplaceOptionId}`
      optionMap.set(`${s.marketplaceId}:${sourceKey}`, s.ref)
      if (s.marketplaceOptionId === EXACT_OPTION_ID) {
        exactProductMap.set(`${s.marketplaceId}:${s.marketplaceProductId}`, s.ref)
      }
    } else {
      const key = `${s.marketplaceId}:${s.marketplaceProductId}`
      productMap.set(key, s.ref)
    }
  }

  return { optionMap, exactProductMap, productMap }
}

function normalizeMappingText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/_펀타스틱$/i, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function isMappingSourceSnapshotCompatible(
  source: Pick<MappingSource, 'productNameSnapshot' | 'optionNameSnapshot'>,
  productName?: string | null,
  optionText?: string | null,
): boolean {
  const sourceProductName = normalizeMappingText(source.productNameSnapshot)
  const currentProductName = normalizeMappingText(productName)
  if (sourceProductName && currentProductName && sourceProductName !== currentProductName) {
    return false
  }

  const sourceOptionName = normalizeMappingText(source.optionNameSnapshot)
  const currentOptionName = normalizeMappingText(optionText)
  if (sourceOptionName && currentOptionName && sourceOptionName !== currentOptionName) {
    return false
  }

  return true
}

function sourceMatchesCandidate(
  source: MappingSource,
  marketplaceId: string,
  marketplaceItemId: string,
  optionText?: string | null,
): boolean {
  if (source.marketplaceId !== marketplaceId) return false
  if (isIgnoredMappingCandidate(marketplaceId, marketplaceItemId)) return false
  if (isBlockedMappingSourcePair(marketplaceId, source.marketplaceProductId, source.marketplaceOptionId)) return false

  const normalizedOptionText = optionText?.trim().slice(0, 100)
  const exactSourceKey = source.marketplaceOptionId
    ? `${source.marketplaceProductId}${MAPPING_SEPARATOR}${source.marketplaceOptionId}`
    : null
  if (exactSourceKey && exactSourceKey === marketplaceItemId) return true

  if (normalizedOptionText) {
    return source.marketplaceProductId === marketplaceItemId
      && (source.marketplaceOptionId === normalizedOptionText || source.marketplaceOptionId === '')
  }

  if (source.marketplaceOptionId === EXACT_OPTION_ID && source.marketplaceProductId === marketplaceItemId) {
    return true
  }

  if (source.marketplaceOptionId === '' && source.marketplaceProductId === marketplaceItemId) {
    return true
  }

  const sepIdx = marketplaceItemId.indexOf(MAPPING_SEPARATOR)
  if (sepIdx > 0) {
    return source.marketplaceOptionId === ''
      && source.marketplaceProductId === marketplaceItemId.slice(0, sepIdx)
  }

  return false
}

export function lookupCompatibleMappingRef(
  sources: MappingSource[],
  marketplaceId: string,
  candidateIds: string[],
  optionText?: string | null,
  productName?: string | null,
): string | null {
  const uniqueCandidateIds = Array.from(new Set(candidateIds.map((id) => id.trim()).filter(Boolean)))
  for (const candidateId of uniqueCandidateIds) {
    const matches = sources.filter((source) =>
      sourceMatchesCandidate(source, marketplaceId, candidateId, optionText)
      && isMappingSourceSnapshotCompatible(source, productName, optionText),
    )
    const exactOptionHit = matches.find((source) => source.marketplaceOptionId && source.marketplaceOptionId !== EXACT_OPTION_ID)
    if (exactOptionHit) return exactOptionHit.ref
    const exactProductHit = matches.find((source) => source.marketplaceOptionId === EXACT_OPTION_ID)
    if (exactProductHit) return exactProductHit.ref
    const productHit = matches.find((source) => source.marketplaceOptionId === '')
    if (productHit) return productHit.ref
  }

  return null
}

/**
 * orderItem 의 (marketplaceId, marketplaceItemId) 가 어떤 매핑 ref 를 가리키는지 찾음.
 * 단품매핑이 우선, 없으면 품번매핑 fallback.
 */
export function lookupMappingRef(
  index: MappingIndex,
  marketplaceId: string,
  marketplaceItemId: string,
  optionText?: string | null,
): string | null {
  if (isIgnoredMappingCandidate(marketplaceId, marketplaceItemId)) return null

  const normalizedOptionText = optionText?.trim().slice(0, 100)

  // 1) 단품 정확매치
  const optKey = `${marketplaceId}:${marketplaceItemId}`
  const optHit = index.optionMap.get(optKey)
  if (optHit) return optHit

  if (normalizedOptionText) {
    const optionTextKey = `${marketplaceItemId}${MAPPING_SEPARATOR}${normalizedOptionText}`
    const optionTextHit = index.optionMap.get(`${marketplaceId}:${optionTextKey}`)
    if (optionTextHit) return optionTextHit
  } else {
    const exactProductHit = index.exactProductMap.get(`${marketplaceId}:${marketplaceItemId}`)
    if (exactProductHit) return exactProductHit
  }

  // 2) 품번 매치 — marketplaceItemId 자체가 productId 인 경우
  const fullProdHit = index.productMap.get(`${marketplaceId}:${marketplaceItemId}`)
  if (fullProdHit) return fullProdHit

  // 3) 품번 매치 - `{productId}{SEP}...` prefix, within the same marketplace only.
  const sepIdx = marketplaceItemId.indexOf(MAPPING_SEPARATOR)
  if (sepIdx > 0) {
    const productId = marketplaceItemId.slice(0, sepIdx)
    const prodKey = `${marketplaceId}:${productId}`
    const prodHit = index.productMap.get(prodKey)
    if (prodHit) return prodHit
  }

  return null
}

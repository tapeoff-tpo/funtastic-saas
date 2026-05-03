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

export type MappingSource = {
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
  /** sources 가 가리키는 매핑코드 식별자 (예: components 그룹 키 등 호출자 자유) */
  ref: string
}

export type MappingIndex = {
  /** key = `${marketplaceId}:${productId}${SEP}${optionId}` */
  optionMap: Map<string, string>
  /** key = `${marketplaceId}:${productId}` */
  productMap: Map<string, string>
  /** key = `${productId}${SEP}${optionId}`; only kept when it points to one mapping ref */
  globalOptionMap: Map<string, string>
  /** key = productId; only kept when it points to one mapping ref */
  globalProductMap: Map<string, string>
}

export function buildMappingIndex(sources: MappingSource[]): MappingIndex {
  const optionMap = new Map<string, string>()
  const productMap = new Map<string, string>()
  const globalOptionCandidates = new Map<string, Set<string>>()
  const globalProductCandidates = new Map<string, Set<string>>()

  const addCandidate = (map: Map<string, Set<string>>, key: string, ref: string) => {
    const refs = map.get(key) ?? new Set<string>()
    refs.add(ref)
    map.set(key, refs)
  }

  for (const s of sources) {
    if (s.marketplaceOptionId) {
      const sourceKey = `${s.marketplaceProductId}${MAPPING_SEPARATOR}${s.marketplaceOptionId}`
      optionMap.set(`${s.marketplaceId}:${sourceKey}`, s.ref)
      addCandidate(globalOptionCandidates, sourceKey, s.ref)
      if (s.marketplaceOptionId === EXACT_OPTION_ID) {
        optionMap.set(`${s.marketplaceId}:${s.marketplaceProductId}`, s.ref)
        addCandidate(globalOptionCandidates, s.marketplaceProductId, s.ref)
      }
    } else {
      const key = `${s.marketplaceId}:${s.marketplaceProductId}`
      productMap.set(key, s.ref)
      addCandidate(globalProductCandidates, s.marketplaceProductId, s.ref)
    }
  }

  const globalOptionMap = new Map<string, string>()
  for (const [key, refs] of globalOptionCandidates) {
    if (refs.size === 1) globalOptionMap.set(key, Array.from(refs)[0])
  }

  const globalProductMap = new Map<string, string>()
  for (const [key, refs] of globalProductCandidates) {
    if (refs.size === 1) globalProductMap.set(key, Array.from(refs)[0])
  }

  return { optionMap, productMap, globalOptionMap, globalProductMap }
}

/**
 * orderItem 의 (marketplaceId, marketplaceItemId) 가 어떤 매핑 ref 를 가리키는지 찾음.
 * 단품매핑이 우선, 없으면 품번매핑 fallback.
 */
export function lookupMappingRef(
  index: MappingIndex,
  marketplaceId: string,
  marketplaceItemId: string,
): string | null {
  // 1) 단품 정확매치
  const optKey = `${marketplaceId}:${marketplaceItemId}`
  const optHit = index.optionMap.get(optKey)
  if (optHit) return optHit

  // 2) 품번 매치 — marketplaceItemId 자체가 productId 인 경우
  const fullProdHit = index.productMap.get(`${marketplaceId}:${marketplaceItemId}`)
  if (fullProdHit) return fullProdHit

  // 3) 쇼핑몰 ID가 다른 수동/사방넷 채널 fallback — 상품코드가 전역에서 유일한 경우만 허용
  const globalOptHit = index.globalOptionMap.get(marketplaceItemId)
  if (globalOptHit) return globalOptHit

  const globalProdHit = index.globalProductMap.get(marketplaceItemId)
  if (globalProdHit) return globalProdHit

  // 4) 품번 매치 — `{productId}{SEP}...` prefix
  const sepIdx = marketplaceItemId.indexOf(MAPPING_SEPARATOR)
  if (sepIdx > 0) {
    const productId = marketplaceItemId.slice(0, sepIdx)
    const prodKey = `${marketplaceId}:${productId}`
    const prodHit = index.productMap.get(prodKey)
    if (prodHit) return prodHit

    const globalPrefixHit = index.globalProductMap.get(productId)
    if (globalPrefixHit) return globalPrefixHit
  }

  return null
}

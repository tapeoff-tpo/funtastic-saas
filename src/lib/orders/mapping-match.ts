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
}

export function buildMappingIndex(sources: MappingSource[]): MappingIndex {
  const optionMap = new Map<string, string>()
  const productMap = new Map<string, string>()
  for (const s of sources) {
    if (s.marketplaceOptionId) {
      const key = `${s.marketplaceId}:${s.marketplaceProductId}${MAPPING_SEPARATOR}${s.marketplaceOptionId}`
      optionMap.set(key, s.ref)
    } else {
      const key = `${s.marketplaceId}:${s.marketplaceProductId}`
      productMap.set(key, s.ref)
    }
  }
  return { optionMap, productMap }
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

  // 3) 품번 매치 — `{productId}{SEP}...` prefix
  const sepIdx = marketplaceItemId.indexOf(MAPPING_SEPARATOR)
  if (sepIdx > 0) {
    const productId = marketplaceItemId.slice(0, sepIdx)
    const prodKey = `${marketplaceId}:${productId}`
    const prodHit = index.productMap.get(prodKey)
    if (prodHit) return prodHit
  }

  return null
}

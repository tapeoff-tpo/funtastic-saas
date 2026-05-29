export const SKU_MAPPING_MARKETPLACE_IDS = [
  'funtastic-b2b',
  'naver',
  'ownerclan',
  'ssgmall',
  'toss-shopping',
  'coupang',
  'kakao-store',
  'kakao-gift',
  'cafe24',
  'ohouse',
  'ably',
  'esm',
  'cjonestyle',
  'domeggook',
  'tobizon',
  'banana-b2b',
  'domechango',
  'playauto-emp',
  '10x10',
  'hyundai-hmall',
  'always',
] as const

export function usesSkuMappingKey(marketplaceId: string): boolean {
  return SKU_MAPPING_MARKETPLACE_IDS.includes(marketplaceId as (typeof SKU_MAPPING_MARKETPLACE_IDS)[number])
}

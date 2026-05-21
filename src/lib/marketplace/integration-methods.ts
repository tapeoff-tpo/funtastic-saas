export type IntegrationMethod = 'api' | 'hub' | 'rpa' | 'excel'

export interface MarketplaceIntegrationInfo {
  method: IntegrationMethod
  label: string
  description: string
}

const INTEGRATION_METHOD_LABELS: Record<IntegrationMethod, string> = {
  api: 'API',
  hub: '연동몰',
  rpa: 'RPA',
  excel: '엑셀',
}

const INTEGRATION_METHOD_DESCRIPTIONS: Record<IntegrationMethod, string> = {
  api: '공식 또는 제휴 API로 주문수집/송장전송을 처리합니다.',
  hub: '여러 쇼핑몰을 한 번에 모아주는 연동몰로 주문수집/송장전송을 처리합니다.',
  rpa: '판매자센터에 로그인해 엑셀 다운로드 등 화면 작업을 자동화합니다.',
  excel: '주문 엑셀을 업로드해 수동으로 주문을 수집합니다.',
}

const RPA_MARKETPLACES = new Set([
  'always',
  'domesin',
  'onchannel',
  'ohouse',
  'domechango',
  'tobizon',
  'banana-b2b',
  'gs-shop',
])

const MULTI_METHOD_MARKETPLACES: Partial<Record<string, IntegrationMethod[]>> = {
  ably: ['api', 'rpa', 'excel'],
  ohouse: ['api', 'rpa', 'excel'],
  tobizon: ['rpa', 'api', 'excel'],
  'banana-b2b': ['rpa', 'api', 'excel'],
}

const HUB_MARKETPLACES = new Set([
  'playauto-emp',
])

export function getIntegrationMethod(
  marketplaceId: string,
  options: { isManual?: boolean; authType?: string | null } = {},
): IntegrationMethod {
  if (options.isManual) return 'excel'
  const multiMethod = MULTI_METHOD_MARKETPLACES[marketplaceId]
  if (multiMethod) {
    if (options.authType === 'session' && multiMethod.includes('rpa')) return 'rpa'
    return multiMethod[0]
  }
  if (HUB_MARKETPLACES.has(marketplaceId)) return 'hub'
  if (RPA_MARKETPLACES.has(marketplaceId)) return 'rpa'
  if (options.authType === 'session') return 'rpa'
  return 'api'
}

export function getSupportedIntegrationMethods(
  marketplaceId: string,
  options: { authType?: string | null } = {},
): IntegrationMethod[] {
  if (marketplaceId === 'domechango') return ['rpa']
  const multiMethod = MULTI_METHOD_MARKETPLACES[marketplaceId]
  if (multiMethod) return multiMethod
  if (HUB_MARKETPLACES.has(marketplaceId)) return ['hub', 'excel']
  if (RPA_MARKETPLACES.has(marketplaceId) || options.authType === 'session') return ['rpa', 'excel']
  return ['api', 'excel']
}

export function getIntegrationInfo(method: IntegrationMethod): MarketplaceIntegrationInfo {
  return {
    method,
    label: INTEGRATION_METHOD_LABELS[method],
    description: INTEGRATION_METHOD_DESCRIPTIONS[method],
  }
}

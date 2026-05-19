export type IntegrationMethod = 'api' | 'rpa' | 'excel'

export interface MarketplaceIntegrationInfo {
  method: IntegrationMethod
  label: string
  description: string
}

const INTEGRATION_METHOD_LABELS: Record<IntegrationMethod, string> = {
  api: 'API',
  rpa: 'RPA',
  excel: '엑셀',
}

const INTEGRATION_METHOD_DESCRIPTIONS: Record<IntegrationMethod, string> = {
  api: '공식 또는 제휴 API로 주문수집/송장전송을 처리합니다.',
  rpa: '판매자센터에 로그인해 엑셀 다운로드 등 화면 작업을 자동화합니다.',
  excel: '주문 엑셀을 업로드해 수동으로 주문을 수집합니다.',
}

const RPA_MARKETPLACES = new Set([
  'always',
  'onchannel',
  'ohouse',
  'hyundai-hmall',
  'gs-shop',
  'cjonestyle',
])

export function getIntegrationMethod(
  marketplaceId: string,
  options: { isManual?: boolean; authType?: string | null } = {},
): IntegrationMethod {
  if (options.isManual) return 'excel'
  if (RPA_MARKETPLACES.has(marketplaceId)) return 'rpa'
  if (options.authType === 'session') return 'rpa'
  return 'api'
}

export function getIntegrationInfo(method: IntegrationMethod): MarketplaceIntegrationInfo {
  return {
    method,
    label: INTEGRATION_METHOD_LABELS[method],
    description: INTEGRATION_METHOD_DESCRIPTIONS[method],
  }
}

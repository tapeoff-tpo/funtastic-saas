import type { IntegrationMethod } from './integration-methods'

const RPA_ORDER_API_CS_MARKETPLACES = new Set([
  'ably',
  'ohouse',
  'onchannel',
])

export function supportsApiCsCollection(marketplaceId: string): boolean {
  return RPA_ORDER_API_CS_MARKETPLACES.has(marketplaceId)
}

export function resolveCsCollectionMethod(params: {
  marketplaceId: string
  orderIntegrationMethod: IntegrationMethod
  requestedMethod: 'all' | 'api' | 'rpa'
}): 'api' | 'rpa' | null {
  const { marketplaceId, orderIntegrationMethod, requestedMethod } = params
  const canUseDedicatedApiCs = supportsApiCsCollection(marketplaceId)

  if (requestedMethod === 'api') {
    if (canUseDedicatedApiCs || orderIntegrationMethod !== 'rpa') return 'api'
    return null
  }

  if (requestedMethod === 'rpa') {
    return orderIntegrationMethod === 'rpa' ? 'rpa' : null
  }

  if (canUseDedicatedApiCs) return 'api'
  if (orderIntegrationMethod === 'rpa') return 'rpa'
  if (orderIntegrationMethod === 'excel') return null
  return 'api'
}

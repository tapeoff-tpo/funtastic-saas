import { describe, expect, it } from 'vitest'
import { getIntegrationMethod, getSupportedIntegrationMethods } from '@/lib/marketplace/integration-methods'

describe('marketplace integration methods', () => {
  it('allows Ably API and RPA connections without misclassifying API credentials', () => {
    expect(getSupportedIntegrationMethods('ably', { authType: 'api_key' })).toEqual([
      'api',
      'rpa',
      'excel',
    ])
    expect(getIntegrationMethod('ably', { authType: 'api_key' })).toBe('api')
    expect(getIntegrationMethod('ably', { authType: 'session' })).toBe('rpa')
  })

  it('allows Ohouse API and RPA connections from marketplace settings', () => {
    expect(getSupportedIntegrationMethods('ohouse', { authType: 'api_key' })).toEqual([
      'api',
      'rpa',
      'excel',
    ])
    expect(getIntegrationMethod('ohouse', { authType: 'api_key' })).toBe('api')
    expect(getIntegrationMethod('ohouse', { authType: 'session' })).toBe('rpa')
  })
})

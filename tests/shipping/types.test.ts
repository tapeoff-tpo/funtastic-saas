import { describe, it, expect } from 'vitest'
import type {
  InvoiceUploadStatus,
  ShipmentGroup,
  CarrierTemplate,
  InvoiceUploadJobData,
  CarrierInfo,
  ShipmentRecord,
} from '@/lib/shipping/types'
import {
  CARRIERS,
  PRIMARY_CARRIERS,
  getCarrierName,
  mapCarrierCode,
} from '@/lib/shipping/carrier-codes'

describe('InvoiceUploadStatus', () => {
  it('includes all 5 states', () => {
    const statuses: InvoiceUploadStatus[] = [
      'pending',
      'uploading',
      'uploaded',
      'failed',
      'confirmed',
    ]
    expect(statuses).toHaveLength(5)
    // Type-check: if any status is invalid, TypeScript will error
    statuses.forEach((s) => expect(typeof s).toBe('string'))
  })
})

describe('CARRIERS registry', () => {
  it('includes CJGLS, HANJIN, HYUNDAI, EPOST, KGB with Korean names', () => {
    const requiredCodes = ['CJGLS', 'HANJIN', 'HYUNDAI', 'EPOST', 'KGB']
    for (const code of requiredCodes) {
      const carrier = CARRIERS.find((c) => c.code === code)
      expect(carrier).toBeDefined()
      expect(carrier!.koreanName).toBeTruthy()
    }
  })

  it('has 14 carriers total', () => {
    expect(CARRIERS).toHaveLength(14)
  })

  it('PRIMARY_CARRIERS has 5 entries', () => {
    expect(PRIMARY_CARRIERS).toHaveLength(5)
    expect(PRIMARY_CARRIERS).toContain('CJGLS')
    expect(PRIMARY_CARRIERS).toContain('HANJIN')
    expect(PRIMARY_CARRIERS).toContain('HYUNDAI')
    expect(PRIMARY_CARRIERS).toContain('EPOST')
    expect(PRIMARY_CARRIERS).toContain('KGB')
  })
})

describe('mapCarrierCode', () => {
  it("mapCarrierCode('coupang', 'CJGLS') returns 'CJGLS'", () => {
    expect(mapCarrierCode('coupang', 'CJGLS')).toBe('CJGLS')
  })

  it("mapCarrierCode('naver', 'CJGLS') returns 'CJGLS'", () => {
    expect(mapCarrierCode('naver', 'CJGLS')).toBe('CJGLS')
  })
})

describe('getCarrierName', () => {
  it("getCarrierName('CJGLS') returns 'CJ대한통운'", () => {
    expect(getCarrierName('CJGLS')).toBe('CJ대한통운')
  })

  it('returns code for unknown carrier', () => {
    expect(getCarrierName('UNKNOWN')).toBe('UNKNOWN')
  })
})

describe('CarrierTemplate type', () => {
  it('has required fields', () => {
    const template: CarrierTemplate = {
      id: 'test-id',
      carrierId: 'CJGLS',
      name: 'Test Template',
      columns: [
        { header: '운송장번호', field: 'trackingNumber', width: 20, required: true },
      ],
      isDefault: true,
      userId: 'user-1',
    }
    expect(template.id).toBe('test-id')
    expect(template.carrierId).toBe('CJGLS')
    expect(template.name).toBe('Test Template')
    expect(template.columns).toHaveLength(1)
    expect(template.isDefault).toBe(true)
  })
})

describe('CarrierInfo type', () => {
  it('has code, koreanName, englishName', () => {
    const info: CarrierInfo = {
      code: 'CJGLS',
      koreanName: 'CJ대한통운',
      englishName: 'CJ Logistics',
    }
    expect(info.code).toBe('CJGLS')
    expect(info.koreanName).toBe('CJ대한통운')
    expect(info.englishName).toBe('CJ Logistics')
  })
})

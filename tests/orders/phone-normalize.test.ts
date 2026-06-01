import { describe, expect, it } from 'vitest'

import { extractPhoneNumbers, primaryPhone, secondaryPhone, splitPhonePair } from '@/lib/orders/phone-normalize'

describe('phone-normalize', () => {
  it('deduplicates two identical phone numbers stored in one cell', () => {
    expect(extractPhoneNumbers('010-9436-2416 010-9436-2416')).toEqual(['010-9436-2416'])
    expect(primaryPhone('010-9436-2416 010-9436-2416')).toBe('010-9436-2416')
    expect(secondaryPhone('010-9436-2416 010-9436-2416')).toBe('')
  })

  it('splits mobile and landline phones into separate fields', () => {
    expect(splitPhonePair('010-7550-1516 070-7375-2226')).toEqual({
      phone1: '070-7375-2226',
      phone2: '010-7550-1516',
    })
  })

  it('normalizes phone numbers without separators', () => {
    expect(splitPhonePair('07077615913 01020565913')).toEqual({
      phone1: '070-7761-5913',
      phone2: '010-2056-5913',
    })
  })

  it('keeps safe numbers as the primary contact when present', () => {
    expect(splitPhonePair('050214991219 0311234567')).toEqual({
      phone1: '031-123-4567',
      phone2: '0502-1499-1219',
    })
  })
})

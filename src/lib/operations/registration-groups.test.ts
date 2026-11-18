import { expect, it } from 'vitest'
import { buildRegistrationGroups, registrationBaseCode, registrationGroupSnapshot, groupRegistrationNumbers } from './registration-groups'
import { getManualRegistrationTargets } from '@/app/(auth)/analytics/price-table/price-table-columns'

const target = getManualRegistrationTargets('상품등록').find((mall) => mall.id === 'coupang')!
const row = (id: string, sku: string, number = '') => ({
  id, productCode: sku, productName: '상품', registeredProductName: null, optionName: id,
  rawData: number ? { '쿠팡 상품번호': number } : {},
})

it('groups option SKUs under the parent and sorts by its item registration date', () => {
  const groups = buildRegistrationGroups([row('red', '112001-0001', '123'), row('blue', '112001-0002', '123')], [
    { sku: '112001', name: '부모 상품', createdAt: new Date('2026-10-01') },
    { sku: '112002', name: '최신 상품', createdAt: new Date('2026-11-18') },
  ])
  expect(groups).toHaveLength(2)
  expect(groups[0]).toMatchObject({ code: '112002', name: '최신 상품', rowId: null })
  expect(groups[1]).toMatchObject({ code: '112001', name: '부모 상품', optionCount: 2 })
  expect(groups[1].missingMalls).not.toContain('coupang')
  expect(groups[0].missingMalls).toContain('coupang')
})

it('does not collapse unrelated unknown codes or treat a fee item as a new product', () => {
  const groups = buildRegistrationGroups([row('a', '확인필요'), row('b', '확인필요')], [
    { sku: '00013', name: '부가세', createdAt: new Date() },
  ])
  expect(groups).toHaveLength(2)
  expect(registrationBaseCode('112001-0002')).toBe('112001')
  expect(registrationBaseCode('112001')).toBe('112001')
})

it('deduplicates shared numbers while detecting conflicts and a newly added option', () => {
  const rows = [row('a', '112001-0001', '123'), row('b', '112001-0002', '123')]
  expect(groupRegistrationNumbers(rows, target)).toEqual([{ key: '쿠팡 상품번호', value: '123' }])
  const snapshot = registrationGroupSnapshot(rows, target)
  expect(registrationGroupSnapshot([...rows].reverse(), target)).toBe(snapshot)
  expect(registrationGroupSnapshot([...rows, row('c', '112001-0003', '456')], target)).not.toBe(snapshot)
  expect(groupRegistrationNumbers([...rows, row('c', '112001-0003', '456')], target)).toHaveLength(2)
})

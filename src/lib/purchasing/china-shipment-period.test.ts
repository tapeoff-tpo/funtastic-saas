import { expect, it } from 'vitest'
import { resolveChinaShipmentPeriod, withChinaShipmentPeriod } from './china-shipment-period'

it('defaults to one calendar month and clamps shorter months including leap years', () => {
  expect(resolveChinaShipmentPeriod({}, '2026-11-11')).toEqual({ preset: '1m', from: '2026-10-11', to: '2026-11-11' })
  expect(resolveChinaShipmentPeriod({}, '2026-03-31').from).toBe('2026-02-28')
  expect(resolveChinaShipmentPeriod({}, '2024-03-31').from).toBe('2024-02-29')
  expect(resolveChinaShipmentPeriod({ period: '1y' }, '2024-02-29').from).toBe('2023-02-28')
})

it('supports all preset periods and rejects invalid or reversed custom dates', () => {
  expect(resolveChinaShipmentPeriod({ period: '3m' }, '2026-11-11').from).toBe('2026-08-11')
  expect(resolveChinaShipmentPeriod({ period: '6m' }, '2026-11-11').from).toBe('2026-05-11')
  expect(resolveChinaShipmentPeriod({ period: '1y' }, '2026-11-11').from).toBe('2025-11-11')
  expect(resolveChinaShipmentPeriod({ period: 'custom', from: '2026-09-01', to: '2026-09-30' }, '2026-11-11')).toEqual({
    preset: 'custom', from: '2026-09-01', to: '2026-09-30',
  })
  expect(resolveChinaShipmentPeriod({ period: 'custom', from: '2026-02-31', to: '2026-03-01' }, '2026-11-11').error).toBeTruthy()
  expect(resolveChinaShipmentPeriod({ period: 'custom', from: '2026-10-01', to: '2026-09-30' }, '2026-11-11').error).toBeTruthy()
})

it('preserves the selected list period when opening requests and switching stages', () => {
  const current = 'period=custom&from=2026-09-01&to=2026-09-30&shipment=old'
  expect(withChinaShipmentPeriod('/purchasing/china-shipments?shipment=next&step=boxes', current))
    .toBe('/purchasing/china-shipments?shipment=next&step=boxes&period=custom&from=2026-09-01&to=2026-09-30')
  expect(withChinaShipmentPeriod('/purchasing/china-shipments?period=1m', current)).toBe('/purchasing/china-shipments?period=1m')
  expect(withChinaShipmentPeriod('/purchasing/import-documents?shipment=next', current)).toBe('/purchasing/import-documents?shipment=next')
})

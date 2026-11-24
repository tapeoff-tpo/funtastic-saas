import { expect, it } from 'vitest'
import { renderChinaPalletWorksheet } from './china-pallet-worksheet-print'
import type { ChinaOutboundShipmentLabelDetail } from './china-outbound-shipment-labels'
it('prints 30 physical boxes per page, numerically sorted, with empty handwritten pallet fields', () => {
  const detail: ChinaOutboundShipmentLabelDetail = {
    shipment: { shipmentNo: '<CN>', status: 'packing', originWarehouseCode: '중국', destinationName: '인천', plannedOutboundDate: '2026-11-20', createdAt: '2026-11-20' },
    pallets: [], items: [{ id: 'i', sku: '100001-0001', productName: '상품 <script>', optionName: '블랙', warehouseCode: '중국', reservedQuantity: 61, packedQuantity: 61 }],
    boxes: Array.from({ length: 62 }, (_, index) => ({ id: `b${index}`, boxNo: String(62 - index), palletId: null, status: 'open' })),
    boxItems: Array.from({ length: 61 }, (_, index) => ({ id: `a${index}`, boxId: `b${index + 1}`, shipmentItemId: 'i', quantity: 1 })),
  }
  const doc = new DOMParser().parseFromString(renderChinaPalletWorksheet(detail, 'test'), 'text/html')
  const pages = [...doc.querySelectorAll('.page')]
  expect(pages.map((page) => page.querySelectorAll('tbody tr').length)).toEqual([30, 30, 1])
  expect(pages[0].querySelector('td')!.textContent).toBe('1')
  expect(pages[2].querySelector('td')!.textContent).toBe('61')
  expect(doc.querySelectorAll('.handwriting')).toHaveLength(61)
  expect([...doc.querySelectorAll('.handwriting')].every((cell) => !cell.textContent)).toBe(true)
  expect(doc.querySelector('script')!.getAttribute('nonce')).toBe('test')
  expect(doc.querySelectorAll('script')).toHaveLength(1)
  expect(doc.querySelector('tbody')!.textContent).toContain('상품 <script> (블랙)')
  expect([...doc.querySelectorAll('th')].slice(0, 4).map((cell) => cell.textContent)).toEqual(['박스번호', '상품명', '수량', '파레트'])
})

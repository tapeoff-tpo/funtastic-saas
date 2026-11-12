import { describe, expect, it } from 'vitest'
import { renderChinaShipmentLabelPrint } from './china-shipment-label-print'
import type { ChinaOutboundShipmentLabelDetail } from './china-outbound-shipment-labels'

const detail: ChinaOutboundShipmentLabelDetail = {
  shipment: { shipmentNo: 'CN-PRINT', status: 'packing', originWarehouseCode: '중국', destinationName: '한국', plannedOutboundDate: '2026-11-02', createdAt: '2026-11-02' },
  items: [{ id: 'item', sku: 'SKU-1', productName: '상품 <script>bad()</script>', chineseProductName: '中文名称', optionName: '블랙', warehouseCode: '중국', reservedQuantity: 20, packedQuantity: 20, location: 'A-01' }],
  pallets: [{ id: 'pallet', palletNo: 'P1' }],
  boxes: [{ id: 'box', boxNo: '1', palletId: 'pallet', status: 'open' }, { id: 'box-two', boxNo: '2', palletId: null, status: 'open' }],
  boxItems: [{ id: 'allocation', boxId: 'box', shipmentItemId: 'item', quantity: 10 }, { id: 'two', boxId: 'box-two', shipmentItemId: 'item', quantity: 10 }],
}

describe('direct shipment label printing', () => {
  it('uses the Excel label layout and one page for each saved box or pallet', () => {
    const html = renderChinaShipmentLabelPrint(detail, {}, 'test-nonce')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('.page')).toHaveLength(3)
    const first = document.querySelector('.page')!
    expect(first.textContent).toContain('中文名称')
    expect(first.textContent).toContain('상품 <script>bad()</script> (블랙)')
    expect(first.textContent).toContain('10 PC')
    expect(first.textContent).toContain('A-01')
    expect(first.querySelector('td[colspan="6"]')?.textContent).toBe('TAPEOFF')
    expect(document.querySelectorAll('script')).toHaveLength(1)
    expect(document.querySelector('script')?.getAttribute('nonce')).toBe('test-nonce')
    expect(html).toContain('size:A4 landscape')
    expect(html).toContain('window.print()')
    // The script is rendered after the label sections, so :last-child never
    // matches a page. Keep the terminal page break on the actual last label
    // only, otherwise Chrome emits an empty trailing sheet.
    expect(document.querySelector('.page:last-child')).toBeNull()
    expect(document.querySelectorAll('.page:last-of-type')).toHaveLength(1)
    expect(html).toContain('.page:last-of-type{break-after:auto;page-break-after:auto}')
  })
  it('scopes per-box and per-pallet output without including empty or unrelated labels', () => {
    const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
    expect(parse(renderChinaShipmentLabelPrint(detail, { boxIds: ['box'], includePalletLabels: false }, 'n')).querySelectorAll('.page')).toHaveLength(1)
    const pallets = parse(renderChinaShipmentLabelPrint(detail, { includeBoxLabels: false }, 'n'))
    expect(pallets.querySelectorAll('.page')).toHaveLength(1)
    expect(pallets.body.textContent).toContain('TAPEOFF (P1)')
  })
})

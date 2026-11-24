import { describe, expect, it } from 'vitest'
import { matchOrderPurchaseUrls, normalizeOrderProductLinks } from './purchase-order-url-match'

const a = 'https://detail.1688.com/offer/111111111111.html', b = 'https://detail.1688.com/offer/222222222222.html'
const row = { id: 'a', sku: '123456-0001', productName: '선반', optionName: '黑色', rawData: {}, metadata: { chineseProductName: '落地架' } }
describe('per-product offer resolution in multi-product orders', () => {
  it('matches different Chinese product titles to their own SKU without depending on row order', () => {
    const rows = [row, { ...row, id: 'b', sku: '654321-0001', productName: '상자', metadata: { chineseProductName: '收纳盒' } }]
    expect(matchOrderPurchaseUrls(rows, [{ url: b, title: '收纳盒' }, { url: a, title: ' 落地架 ' }]))
      .toEqual([{ requestId: 'a', url: a, method: 'product_title' }, { requestId: 'b', url: b, method: 'product_title' }])
  })
  it('resolves duplicate titles only with matching option text and unique offer', () => {
    const rows = [row, { ...row, id: 'b', sku: '654321-0001', optionName: '白色' }]
    expect(matchOrderPurchaseUrls(rows, [{ url: a, title: '落地架', optionName: '黑色' }, { url: b, title: '落地架', optionName: '白色' }]))
      .toEqual([{ requestId: 'a', url: a, method: 'product_title' }, { requestId: 'b', url: b, method: 'product_title' }])
    expect(matchOrderPurchaseUrls(rows, [{ url: a, title: '落地架' }, { url: b, title: '落地架' }])).toEqual([])
    expect(matchOrderPurchaseUrls(rows, [{ url: b, title: '落地架', optionName: '白色' }]))
      .toEqual([{ requestId: 'b', url: b, method: 'product_title' }])
  })
  it('uses exact product codes, never treats an offer ID or code substring as the internal SKU', () => {
    expect(matchOrderPurchaseUrls([row], [{ url: a, productCode: row.sku }, { url: b, productCode: '123456-0002' }]))
      .toEqual([{ requestId: 'a', url: a, method: 'product_code' }])
    expect(matchOrderPurchaseUrls([row], [{ url: a, productCode: '123456' }, { url: b, productCode: '111111111111' }])).toEqual([])
  })
  it('keeps the explicitly deleted Chinese name deleted and avoids approximate title guesses', () => {
    const deleted = { ...row, metadata: { chineseProductName: null, esa009m: { '중국어 상품명': '落地架' } } }
    expect(matchOrderPurchaseUrls([deleted], [{ url: a, title: '落地架' }, { url: b, title: '落地架升级版' }])).toEqual([])
  })
  it('retains a valid manual choice across recollections and rejects stale order evidence', () => {
    const chosen = { ...row, orderNumber: '1234567890123', rawData: { purchaseUrlLookup: { orderNumber: '1234567890123', resolvedUrl: b, matchMethod: 'manual' } } }
    expect(matchOrderPurchaseUrls([chosen], [{ url: a, title: '落地架' }, { url: b }])).toEqual([{ requestId: 'a', url: b, method: 'manual' }])
    expect(matchOrderPurchaseUrls([{ ...chosen, orderNumber: '9999999999999' }], [{ url: a, title: '落地架' }, { url: b }]))
      .toEqual([{ requestId: 'a', url: a, method: 'product_title' }])
  })
  it('preserves option-specific evidence when several rows share the same URL', () => {
    expect(normalizeOrderProductLinks([{ url: a, optionName: '黑色' }, { url: a, optionName: '白色' }, { url: a, optionName: '黑色' }]))
      .toHaveLength(2)
  })
  it('does not attach one remaining link to unrelated product groups or use common options alone', () => {
    const rows = [row, { ...row, id: 'b', sku: '654321-0001' }]
    expect(matchOrderPurchaseUrls(rows, [{ url: a, optionName: '黑色' }])).toEqual([])
  })
})

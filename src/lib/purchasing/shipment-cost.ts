import type { ImportDocumentDetail } from './china-import-document'
import { calculateChinaOutboundBoxCbm } from './china-outbound-dimensions'

export function calculateShipmentCost(
  detail: ImportDocumentDetail,
  inputs: { charges: number; vat: number; exchangeRate: number; prices: Record<string, number>; mixedBoxCbm: Record<string, number> },
) {
  const { charges, vat, exchangeRate, prices, mixedBoxCbm } = inputs
  if (![charges, vat].every((value) => Number.isSafeInteger(value) && value >= 0) || vat > charges
    || !Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error('청구액, 공제 부가세, 환율을 확인해주세요.')
  const totals = new Map(detail.items.map((item) => [item.id, { sku: item.sku, name: item.productName, quantity: 0, cbm: 0, goods: 0 }]))
  const palletBoxes = new Map<string, Array<{ itemId: string; cbm: number }>>()
  for (const box of detail.boxes) {
    const allocations = detail.boxItems.filter((line) => line.boxId === box.id)
    if (!allocations.length) continue
    const boxCbm = calculateChinaOutboundBoxCbm(box)
    if (!boxCbm) throw new Error(`${box.boxNo} 박스 규격을 입력해주세요.`)
    const weights = allocations.map((line) => allocations.length === 1 ? 1 : mixedBoxCbm[line.id])
    if (weights.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${box.boxNo} 혼적 박스의 SKU별 부피를 입력해주세요.`)
    }
    const sum = weights.reduce((a, b) => a + b, 0)
    for (const [index, line] of allocations.entries()) {
      const item = totals.get(line.shipmentItemId)
      if (!item) throw new Error('박스와 품목 연결을 확인해주세요.')
      item.quantity += line.quantity
      const cbm = boxCbm * weights[index] / sum
      if (box.palletId) {
        const lines = palletBoxes.get(box.palletId) ?? []
        lines.push({ itemId: line.shipmentItemId, cbm })
        palletBoxes.set(box.palletId, lines)
      } else {
        item.cbm += cbm
      }
    }
  }
  for (const [palletId, lines] of palletBoxes) {
    const pallet = detail.pallets.find((entry) => entry.id === palletId)
    const cbm = pallet && calculateChinaOutboundBoxCbm(pallet)
    if (!cbm) throw new Error(`${pallet?.palletNo ?? '팔레트'} 적재 후 실측 규격을 입력해주세요.`)
    const inner = lines.reduce((sum, line) => sum + line.cbm, 0)
    for (const line of lines) totals.get(line.itemId)!.cbm += cbm * line.cbm / inner
  }
  const bySku = new Map<string, { sku: string; name: string; quantity: number; cbm: number; goods: number }>()
  for (const source of detail.items) {
    const line = totals.get(source.id)!
    const price = prices[source.id]
    if (line.quantity !== source.reservedQuantity || line.quantity <= 0) throw new Error(`${line.sku}의 박스분할 수량을 확인해주세요.`)
    if (!Number.isFinite(price) || price < 0) throw new Error(`${line.sku}의 상품 매입 단가를 입력해주세요.`)
    const total = bySku.get(line.sku) ?? { ...line, quantity: 0, cbm: 0, goods: 0 }
    total.quantity += line.quantity
    total.cbm += line.cbm
    total.goods += price * exchangeRate * line.quantity
    bySku.set(line.sku, total)
  }
  const rows = [...bySku.values()]
  const cbm = rows.reduce((sum, row) => sum + row.cbm, 0)
  if (!cbm || !Number.isFinite(cbm)) throw new Error('배분할 출고 부피가 없습니다.')
  const distributable = charges - vat
  const shares = rows.map((row, index) => {
    const exact = distributable * row.cbm / cbm
    return { index, fraction: exact % 1, won: Math.floor(exact) }
  })
  const remainder = distributable - shares.reduce((sum, share) => sum + share.won, 0)
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index).slice(0, remainder)) share.won++
  return { cbm, distributable, rows: rows.map((row, index) => ({
    ...row, allocated: shares[index].won, unitCost: (row.goods + shares[index].won) / row.quantity,
  })) }
}

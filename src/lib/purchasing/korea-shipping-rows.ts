import type { ImportDocumentDetail } from './china-import-document'
import { calculateChinaOutboundBoxCbm, dimensionNumber } from './china-outbound-dimensions'
import { resolveChinaLooseBoxes } from './china-pallet-number'

export function formatKoreaBoxNumbers(boxes: string[]) {
  const sorted = [...new Set(boxes)].sort(new Intl.Collator('ko-KR', { numeric: true }).compare)
  const ranges: string[] = []
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index]
    let end = index
    // Only compress plain numeric labels; retain prefixed and zero-padded IDs verbatim.
    if (/^(0|[1-9]\d*)$/.test(start)) {
      while (end + 1 < sorted.length && /^(0|[1-9]\d*)$/.test(sorted[end + 1]) && Number(sorted[end + 1]) === Number(sorted[end]) + 1) end++
    }
    ranges.push(end === index ? start : `${start}-${sorted[end]}`)
    index = end
  }
  return ranges.join(', ')
}

export function koreaShippingRows(source: ImportDocumentDetail, by: 'pallet' | 'box') {
  const detail = { ...source, ...resolveChinaLooseBoxes(source.pallets, source.boxes) }
  const items = new Map(detail.items.map((item) => [item.id, item]))
  const pallets = new Map(detail.pallets.map((pallet) => [pallet.id, pallet.palletNo]))
  const rows = new Map<string, { pallet: string; boxes: Set<string>; sku: string; name: string; option: string; quantity: number; warehouse: number; coupang: number; bulk: number; location: string; cbm: number; weight: number }>()
  for (const box of detail.boxes) {
    for (const line of detail.boxItems.filter((line) => line.boxId === box.id && line.quantity > 0)) {
      const item = items.get(line.shipmentItemId)
      if (!item) continue
      const pallet = box.palletId ? pallets.get(box.palletId) ?? 'BOX' : 'BOX'
      const key = JSON.stringify([pallet, item.productName.trim(), (item.optionName ?? '').trim()])
      const row = rows.get(key) ?? { pallet, boxes: new Set<string>(), sku: item.sku, name: item.productName, option: item.optionName ?? '', quantity: 0, warehouse: 0, coupang: 0, bulk: 0, location: item.location ?? '', cbm: 0, weight: 0 }
      row.sku = [...new Set([...row.sku.split(', '), item.sku])].join(', ')
      row.location = [...new Set([row.location, item.location ?? ''].flatMap((value) => value.split(', ')).filter(Boolean))].join(', ')
      const boxQuantity = detail.boxItems.filter((entry) => entry.boxId === box.id && entry.quantity > 0).reduce((sum, entry) => sum + entry.quantity, 0)
      row.cbm += (calculateChinaOutboundBoxCbm(box) ?? 0) * line.quantity / boxQuantity
      row.weight += (dimensionNumber(box.grossWeightKg) ?? 0) * line.quantity / boxQuantity
      row.quantity += line.quantity
      row.boxes.add(box.boxNo)
      const category = /쿠팡|로켓/.test(item.warehouseCode) ? 'coupang' : /대량/.test(item.warehouseCode) ? 'bulk' : 'warehouse'
      row[category] += line.quantity
      rows.set(key, row)
    }
  }
  const collator = new Intl.Collator('ko-KR', { numeric: true })
  return [...rows.values()].sort((a, b) => Number(a.pallet === 'BOX') - Number(b.pallet === 'BOX') || (by === 'box' ? collator.compare([...a.boxes].sort(collator.compare)[0], [...b.boxes].sort(collator.compare)[0]) : 0) || collator.compare(a.pallet, b.pallet) || collator.compare([...a.boxes][0], [...b.boxes][0]) || collator.compare(a.sku, b.sku))
    .map((row) => ({ ...row, boxes: [...row.boxes].sort(collator.compare) }))
}


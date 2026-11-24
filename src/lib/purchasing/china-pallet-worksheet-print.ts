import type { ChinaOutboundShipmentLabelDetail } from './china-outbound-shipment-labels'
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Thirty physical boxes per page; mixed products stay together on one box row. */
export function renderChinaPalletWorksheet(detail: ChinaOutboundShipmentLabelDetail, nonce: string) {
  const items = new Map(detail.items.map((item) => [item.id, item]))
  const rows = detail.boxes.flatMap((box) => {
    const lines = detail.boxItems.filter((line) => line.boxId === box.id && line.quantity > 0 && items.has(line.shipmentItemId))
    if (!lines.length) return []
    const products = new Map<string, { name: string; quantity: number }>()
    for (const line of lines) {
      const item = items.get(line.shipmentItemId)!
      const previous = products.get(item.id)
      products.set(item.id, { name: `${item.productName}${item.optionName ? ` (${item.optionName})` : ''}`, quantity: (previous?.quantity ?? 0) + line.quantity })
    }
    return [{ number: box.boxNo, products: [...products.values()] }]
  }).sort((a, b) => a.number.localeCompare(b.number, 'ko-KR', { numeric: true }))
  const count = Math.max(1, Math.ceil(rows.length / 30))
  const pages = Array.from({ length: count }, (_, page) => {
    const batch = rows.slice(page * 30, (page + 1) * 30)
    return `<section class="page"><div class="paper-content"><header><h1>파레트 배정 수기 작업지</h1><div>${escape(detail.shipment.shipmentNo)} · ${escape(detail.shipment.plannedOutboundDate ?? '')} · ${page + 1} / ${count}쪽</div><p>파레트 번호를 직접 적어주세요. 낱박스는 BOX로 적어주세요.</p></header><table><colgroup><col style="width:13%"><col style="width:61%"><col style="width:11%"><col style="width:15%"></colgroup><thead><tr><th>박스번호</th><th>상품명</th><th>수량</th><th>파레트</th></tr></thead><tbody>${batch.map((box) => `<tr><td class="box">${escape(box.number)}</td><td>${box.products.map((product) => `<div class="product">${escape(product.name)}${box.products.length > 1 ? ` · ${product.quantity}개` : ''}</div>`).join('')}</td><td class="quantity">${box.products.reduce((sum, product) => sum + product.quantity, 0).toLocaleString('ko-KR')}</td><td class="handwriting"></td></tr>`).join('')}${!batch.length ? '<tr><td colspan="4">저장된 박스가 없습니다.</td></tr>' : ''}</tbody></table><footer>작성자: ____________________　작업일: ____________________　박스 ${batch.length}개 / 전체 ${rows.length}개</footer></div></section>`
  }).join('')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escape(detail.shipment.shipmentNo)} 파레트 배정 작업지</title><style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#111;font-family:Arial,'Malgun Gothic',sans-serif}.toolbar{text-align:center;padding:12px}.toolbar button{padding:8px 18px}.page{position:relative;width:190mm;height:277mm;overflow:hidden;margin:12px auto;padding:0;background:white;break-after:page}.page:last-of-type{break-after:auto}.paper-content{position:absolute;top:0;left:0;width:190mm;transform-origin:top left}header{height:25mm}h1{font-size:16pt;margin:0 0 3mm}header div,header p{font-size:9pt;margin:2mm 0}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt}th,td{border:1px solid #444;padding:1mm 2mm;vertical-align:middle}th{height:8mm;background:#eee}tbody tr{height:7.5mm;break-inside:avoid}.box,.quantity{text-align:center;font-weight:bold}.product{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.15}.handwriting{background:white}footer{padding-top:3mm;font-size:9pt}@media print{body{background:white}.toolbar{display:none}.page{margin:0}thead{display:table-header-group}}</style></head><body><div class="toolbar"><button id="print">인쇄</button> · 30박스 / 장 · A4 세로</div>${pages}<script nonce="${escape(nonce)}">function fit(){document.querySelectorAll('.page').forEach(function(page){const content=page.querySelector('.paper-content');content.style.transform='none';const scale=Math.min(1,page.clientHeight/content.offsetHeight);content.style.transform='scale('+scale+')'})}document.getElementById('print').addEventListener('click',function(){fit();window.print()});window.addEventListener('beforeprint',fit);window.addEventListener('load',async function(){await document.fonts.ready;fit()});</script></body></html>`
}

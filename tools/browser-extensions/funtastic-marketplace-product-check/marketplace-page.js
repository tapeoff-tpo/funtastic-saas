chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FUNTASTIC_MARKET_CHECK_READ') return false
  sendResponse({ ok: true, result: analyzePage(message.check) })
  return false
})

function analyzePage(check) {
  const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim() || ''
  const productIds = Array.isArray(check.productIds) ? check.productIds.filter(Boolean) : []
  const foundId = productIds.find((id) => bodyText.includes(id)) || null
  const host = location.hostname.toLowerCase()
  let status = foundId ? 'registered' : 'needs_review'

  if (host.includes('smartstore.naver.com')) {
    const totalMatch = bodyText.match(/상품목록\s*\(총\s*([0-9,]+)개\)/)
    const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null
    if (total === 0) status = 'missing'
    else if (foundId || (total !== null && total > 0)) status = /판매중지/.test(bodyText) ? 'stopped' : 'registered'
  } else if (/데이터가 존재하지 않습니다|조회된 상품이 없습니다|검색 결과가 없습니다|검색된 상품이 없습니다/.test(bodyText)) {
    status = 'missing'
  }

  return {
    status,
    marketplaceProductId: foundId || productIds[0] || null,
    marketplaceProductName: check.productName || document.title,
    sellerUrl: location.href,
    rawData: {
      host,
      pageTitle: document.title,
      matchedProductId: foundId,
      bodySample: bodyText.slice(0, 500),
      checkedAt: new Date().toISOString(),
    },
  }
}

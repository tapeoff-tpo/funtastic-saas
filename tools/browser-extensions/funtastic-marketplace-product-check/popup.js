const market = document.querySelector('#market')
const empty = document.querySelector('#empty')
const active = document.querySelector('#active')
const code = document.querySelector('#code')
const name = document.querySelector('#name')
const detail = document.querySelector('#detail')

document.querySelector('#open-saas').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'FUNTASTIC_MARKET_CHECK_OPEN_SAAS' }))
document.querySelector('#analyze').addEventListener('click', () => run({ type: 'FUNTASTIC_MARKET_CHECK_ANALYZE' }))
document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', () => run({ type: 'FUNTASTIC_MARKET_CHECK_MANUAL', status: button.dataset.status })))

chrome.runtime.sendMessage({ type: 'FUNTASTIC_MARKET_CHECK_GET_ACTIVE' }, (response) => {
  if (!response?.check) return
  empty.hidden = true
  active.hidden = false
  market.textContent = response.check.marketplaceName
  code.textContent = response.check.productCode
  name.textContent = response.check.productName || ''
})

function run(message) {
  detail.textContent = '확인 중...'
  chrome.runtime.sendMessage(message, (response) => {
    if (!response?.ok) {
      detail.textContent = response?.error || '확인하지 못했습니다.'
      return
    }
    detail.textContent = 'SaaS에 저장했습니다.'
    setTimeout(() => window.close(), 700)
  })
}

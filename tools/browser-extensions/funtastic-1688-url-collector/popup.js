const SAAS_URL = 'https://funtastic-saas-vercel.vercel.app/costs'
const status = document.querySelector('#status')
const detail = document.querySelector('#detail')
const cancel = document.querySelector('#cancel')

document.querySelector('#open-saas').addEventListener('click', () => {
  void chrome.tabs.create({ url: SAAS_URL })
})

cancel.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FUNTASTIC_1688_CANCEL' }, () => window.close())
})

chrome.runtime.sendMessage({ type: 'FUNTASTIC_1688_GET_STATUS' }, (response) => {
  if (!response?.running) return
  status.textContent = '수집 중'
  detail.textContent = `${Math.min(response.index + 1, response.total)} / ${response.total} 주문 조회 중`
  cancel.hidden = false
})

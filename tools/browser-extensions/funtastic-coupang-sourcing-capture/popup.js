const status = document.querySelector('#status')
const detail = document.querySelector('#detail')
const capture = document.querySelector('#capture')
const openSaas = document.querySelector('#open-saas')

capture.addEventListener('click', () => {
  setStatus('저장 중', '')
  capture.disabled = true
  chrome.runtime.sendMessage({ type: 'FUNTASTIC_COUPANG_CAPTURE_ACTIVE' }, (response) => {
    capture.disabled = false
    if (chrome.runtime.lastError || !response?.ok) {
      setStatus('오류', 'error')
      detail.textContent = response?.error || chrome.runtime.lastError?.message || '저장하지 못했습니다.'
      return
    }
    setStatus('완료', 'ok')
    detail.textContent = '소싱탭에 저장 요청을 보냈습니다.'
  })
})

openSaas.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FUNTASTIC_COUPANG_OPEN_SAAS' }, () => window.close())
})

chrome.runtime.sendMessage({ type: 'FUNTASTIC_COUPANG_GET_STATUS' }, (response) => {
  const pendingCount = response?.pendingCount || 0
  if (pendingCount > 0) {
    setStatus(`${pendingCount}건 대기`, '')
    detail.textContent = '소싱탭을 열면 대기 중인 상품이 저장됩니다.'
  }
})

function setStatus(text, className) {
  status.textContent = text
  status.className = `status ${className || ''}`.trim()
}

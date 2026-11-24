;(function () {
  const rules = globalThis.FuntasticSupplierRules
  const CHANNEL = 'funtastic-coupang-registration'
  let busy = false
  let activeJob = null
  let panel = null
  const text = element => rules.clean(element?.innerText || element?.textContent)
  const exactButton = label => Array.from(document.querySelectorAll('button')).filter(button => text(button) === label)
  const send = message => chrome.runtime.sendMessage({ channel: CHANNEL, jobId: activeJob.jobId, token: activeJob.token, ...message })
  async function state(status, message) { renderPanel(message); await send({ type: 'STATE', status, message }) }
  function renderPanel(message, action) {
    if (!panel) {
      panel = document.createElement('section')
      panel.id = 'funtastic-supplier-registration-status'
      panel.setAttribute('aria-label', 'Funtastic 쿠팡 등록 진행')
      Object.assign(panel.style, { position: 'fixed', bottom: '20px', right: '20px', width: '360px', maxWidth: '90vw', padding: '16px', background: '#fff', color: '#111827', border: '2px solid #2563eb', borderRadius: '12px', boxShadow: '0 8px 28px #0003', zIndex: '2147483647', font: '14px/1.6 sans-serif' })
      document.body.append(panel)
    }
    panel.replaceChildren()
    const title = document.createElement('strong')
    title.textContent = 'Funtastic 쿠팡 등록'
    const body = document.createElement('p')
    body.textContent = message
    panel.append(title, body)
    if (action) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      Object.assign(button.style, { padding: '8px 12px', background: '#2563eb', color: '#fff', border: '0', borderRadius: '6px', cursor: 'pointer' })
      button.addEventListener('click', event => { if (event.isTrusted) void action.run().catch(error => state('failed', error.message)) })
      panel.append(button)
    }
    if (activeJob) {
      const check = document.createElement('button')
      check.type = 'button'
      check.textContent = '기존 견적서 검증 결과 확인'
      Object.assign(check.style, { display: 'block', marginTop: '8px', padding: '6px', cursor: 'pointer' })
      check.addEventListener('click', event => { if (event.isTrusted) void checkQuote().catch(error => state('running', error.message)) })
      panel.append(check)
    }
  }
  async function waitUntil(read, milliseconds = 15000) {
    const initial = read()
    if (initial) return initial
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => { const result = read(); if (result) { observer.disconnect(); clearTimeout(timer); resolve(result) } })
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('서플라이어허브 화면 구성을 확인하지 못했습니다. 창을 확인한 뒤 SaaS에서 결과 확인을 눌러주세요.')) }, milliseconds)
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    })
  }
  function registrationInputs() {
    const body = document.body.innerText || document.body.textContent || ''
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
    if (location.pathname !== '/qvt/registration' || !body.includes('작성이 완료된 견적서 Excel 파일') || !body.includes('제품 필수 표시사항을 업로드') || inputs.length !== 4 || inputs.some(input => !input.multiple)) return null
    if (!document.getElementById('msrpAgreement') || !document.getElementById('labelContactAgreement')) return null
    return inputs
  }
  function inputFiles(input, files) {
    if (input.files?.length) throw new Error('서플라이어허브에 이미 선택된 파일이 있습니다. 중복 업로드를 방지하기 위해 새 등록 창에서 확인해주세요.')
    const transfer = new DataTransfer()
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0))
      const type = file.kind === 'workbook' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg'
      transfer.items.add(new File([bytes], file.name, { type }))
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const actual = Array.from(input.files || []).map(file => file.name)
    if (actual.length !== files.length || files.some((file, index) => actual[index] !== file.name)) throw new Error('첨부파일 선택 결과가 일치하지 않습니다. 서플라이어허브에서 확인해주세요.')
  }
  async function prepare() {
    const inputs = await waitUntil(registrationInputs)
    const claim = await send({ type: 'CLAIM_PREPARATION' })
    if (!claim?.ok) return state('running', claim?.error || '중복 업로드하지 않고 기존 검증 결과를 확인해주세요.')
    inputFiles(inputs[0], activeJob.files.filter(file => file.kind === 'workbook'))
    inputFiles(inputs[2], activeJob.files.filter(file => file.kind === 'label'))
    const message = '견적서·품질표시 파일을 준비했습니다. 이 화면의 가격·라벨 연락처 선언을 직접 읽고 체크하고, 상품에 필요한 법정서류를 선택해주세요. 준비가 끝나면 아래 버튼으로 검증을 시작합니다.'
    await send({ type: 'PHASE', phase: 'prepared', message })
    showPrepared(message)
  }
  function showPrepared(message) {
    renderPanel(message, { label: '선언·필수서류 확인 후 검증 시작', run: () => validatePrepared() })
  }
  async function validatePrepared() {
    const inputs = registrationInputs()
    if (!inputs || !document.getElementById('msrpAgreement').checked || !document.getElementById('labelContactAgreement').checked) throw new Error('서플라이어허브의 선언 항목을 직접 확인하고 체크해주세요.')
    const workbook = activeJob.files.find(file => file.kind === 'workbook')
    if (inputs[0].files?.length !== 1 || inputs[0].files[0].name !== workbook.name) throw new Error('선택된 견적서 파일이 등록 요청과 다릅니다.')
    const buttons = exactButton('파일 검증하기')
    if (buttons.length !== 1 || buttons[0].disabled) throw new Error('파일 검증하기가 아직 활성화되지 않았습니다. 필요한 파일·법정서류 항목을 확인해주세요.')
    // Save intent before clicking. A crash here is ambiguous and must never re-upload or re-click.
    const response = await send({ type: 'PHASE', phase: 'submitting', message: '사용자가 선언·서류를 확인했습니다. 쿠팡 파일 검증을 요청합니다.' })
    if (!response?.ok) throw new Error(response?.error || '등록 작업 상태를 저장하지 못했습니다.')
    buttons[0].click()
    await send({ type: 'PHASE', phase: 'submitted', message: '쿠팡 파일 검증을 요청했습니다. 검증에는 최대 2시간이 걸릴 수 있습니다. 검증 완료와 상품 SKU가 확인될 때까지 등록완료로 처리하지 않습니다.' })
    renderPanel('파일 검증을 요청했습니다. 검증에는 최대 2시간이 걸릴 수 있습니다. SaaS에서 결과 확인을 누르면 이 견적서의 실제 상품 검수 결과를 확인합니다.')
  }
  function readTable(headers, root = document) {
    const tables = Array.from(root.querySelectorAll('table')).filter(table => {
      const labels = Array.from(table.querySelectorAll('thead th')).map(element => rules.headerText(text(element)))
      return headers.every(header => labels.includes(header))
    })
    if (tables.length !== 1) return null
    const table = tables[0]
    const labels = Array.from(table.querySelectorAll('thead th')).map(element => rules.headerText(text(element)))
    return Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length === labels.length).map(row => {
      const cells = Array.from(row.querySelectorAll('td'))
      const result = Object.fromEntries(headers.map(header => [header, text(cells[labels.indexOf(header)])]))
      const quoteCell = cells[labels.indexOf('견적서 ID')]
      result.quoteAttributes = quoteCell ? [quoteCell, ...quoteCell.querySelectorAll('*')].flatMap(element => ['title', 'aria-label', 'data-quote-id', 'data-quotation-id'].map(name => element.getAttribute(name)).filter(Boolean)) : []
      return result
    })
  }
  async function checkQuote() {
    if (location.pathname !== '/qvt/registration') return state('login_required', '서플라이어허브에 로그인한 뒤 SaaS에서 결과 확인을 눌러주세요.')
    const headers = ['견적서 명', '견적서 등록일', '검증 상태', '검증 결과', '견적서 ID']
    let rows = readTable(headers)
    if (!rows) {
      const buttons = exactButton('검증 진행상태 확인하기')
      if (buttons.length !== 1) throw new Error('검증 진행상태 확인하기를 찾지 못했습니다. 서플라이어허브 화면을 확인해주세요.')
      buttons[0].click()
      rows = await waitUntil(() => readTable(headers))
    }
    await send({ type: 'OBSERVATION', kind: 'quote', rows: rows.map(row => ({ workbookName: row['견적서 명'], status: row['검증 상태'], result: row['검증 결과'], quoteId: row['견적서 ID'], quoteAttributes: row.quoteAttributes })) })
  }
  function inputByLabel(label) {
    const matches = Array.from(document.querySelectorAll('label')).filter(element => text(element) === label).flatMap(element => {
      const field = element.htmlFor ? document.getElementById(element.htmlFor) : element.querySelector('input')
      return field?.tagName === 'INPUT' ? [field] : []
    })
    return matches.length === 1 ? matches[0] : null
  }
  async function checkProducts(quoteId) {
    if (location.pathname !== '/qvt/wims' || !quoteId) throw new Error('견적서 ID로 상품 검수 결과를 확인할 수 있는 화면이 아닙니다.')
    const filter = await waitUntil(() => inputByLabel('견적서 ID'))
    const searchButtons = exactButton('검색')
    if (searchButtons.length !== 1) throw new Error('상품 검색 버튼을 정확히 찾지 못했습니다.')
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    nativeSetter.call(filter, quoteId)
    filter.dispatchEvent(new Event('input', { bubbles: true }))
    filter.dispatchEvent(new Event('change', { bubbles: true }))
    searchButtons[0].click()
    const headers = ['상품명', '견적서 ID', 'SKU ID', '상태']
    // Only exact quote/name/SKU matches count. Old rows during loading cannot satisfy a different quote.
    const rows = await waitUntil(() => {
      const result = readTable(headers)
      return result && result.some(row => rules.quoteIdentity(row['견적서 ID'], row.quoteAttributes) === quoteId) ? result : null
    }).catch(() => [])
    await send({ type: 'OBSERVATION', kind: 'products', rows: rows.map(row => ({ name: row['상품명'], quoteId: row['견적서 ID'], quoteAttributes: row.quoteAttributes, skuId: row['SKU ID'], status: row['상태'] })) })
    renderPanel('이 견적서의 상품 검수 결과를 확인했습니다. SaaS에서 결과를 확인해주세요. 검수중인 상품은 완료될 때까지 2단계에 남습니다.')
  }

  const CATEGORY_LOGIN = '서플라이어허브 창에서 로그인한 뒤 다시 검색해주세요.'
  function categoryArguments(message) {
    if (message.type === 'CATEGORY_SEARCH') {
      if (!Array.isArray(message.queries) || !message.queries.length || message.queries.length > 6 || message.queries.some(query => typeof query !== 'string' || !query.trim() || query.trim().length > 200)) throw new Error('카테고리 검색어는 1~6개, 각 200자 이내로 입력해주세요.')
      return { queries: [...new Set(message.queries.map(query => query.trim()))] }
    }
    const categoryId = String(message.categoryId ?? '')
    if (!/^[1-9]\d*$/.test(categoryId) || !Number.isSafeInteger(Number(categoryId))) throw new Error('쿠팡 카테고리 ID를 확인해주세요.')
    return { categoryId }
  }
  async function categoryResponse(path, consume) {
    if (location.origin !== 'https://supplier.coupang.com' || /\/(?:login|signin)(?:\/|$)/i.test(location.pathname) || document.querySelector('input[type="password"]')) throw new Error(CATEGORY_LOGIN)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(path, { credentials: 'include', redirect: 'manual', signal: controller.signal })
      if (response.type === 'opaqueredirect') throw new Error('서플라이어허브 대량등록 화면에서 인증 상태를 확인한 뒤 다시 검색해주세요.')
      if ([401, 403].includes(response.status) || response.redirected || /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error(CATEGORY_LOGIN)
      if (!response.ok) throw new Error('쿠팡 카테고리 요청에 실패했습니다. (' + response.status + ')')
      return await consume(response)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('쿠팡 카테고리 응답 시간이 초과되었습니다. 다시 시도해주세요.')
      if (error instanceof TypeError) throw new Error('서플라이어허브에 연결하지 못했습니다. 네트워크와 허브 화면을 확인한 뒤 다시 시도해주세요.')
      throw error
    } finally { clearTimeout(timer) }
  }
  async function searchCategories(queries) {
    const responses = await Promise.all(queries.map(query => categoryResponse('/qvt/kan-categories/search?keyword=' + encodeURIComponent(query), response => response.json())))
    const categories = new Map()
    const resultsByQuery = responses.map((items, queryIndex) => {
      if (!Array.isArray(items)) throw new Error('쿠팡 카테고리 응답 형식이 변경되었습니다. 서플라이어허브에서 확인해주세요.')
      const ids = new Set()
      for (const item of items.slice(0, 5000)) {
        if (!item || item.isLeaf !== true || item.valid !== true || item.risky === true) continue
        const id = String(item.categoryId ?? '')
        const name = rules.clean(item.name)
        const path = rules.clean(item.categoryFullPath)
        if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !name || name.length > 200 || !path || path.length > 1000) continue
        const query = queries[queryIndex]
        const existing = categories.get(id)
        if (existing) { if (!existing.matchedQueries.includes(query)) existing.matchedQueries.push(query) }
        else categories.set(id, { id, name, path, matchedQueries: [query] })
        ids.add(id)
      }
      return [...ids]
    })
    // Give every query a slot before broad source-category results fill the limit.
    const positions = resultsByQuery.map(() => 0)
    const selected = new Set()
    let added = true
    while (selected.size < 50 && added) {
      added = false
      for (let index = 0; index < resultsByQuery.length && selected.size < 50; index++) {
        const ids = resultsByQuery[index]
        while (positions[index] < ids.length && selected.has(ids[positions[index]])) positions[index]++
        if (positions[index] < ids.length) { selected.add(ids[positions[index]++]); added = true }
      }
    }
    return { ok: true, categories: [...selected].map(id => categories.get(id)) }
  }
  function categoryFilename(header, categoryId) {
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header || '')
    const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(header || '')
    let name = encoded?.[1] || plain?.[1] || plain?.[2] || ''
    try { name = decodeURIComponent(name.trim()) } catch { name = '' }
    name = name.split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f\x7f]/g, '_').trim().replace(/^\.+/, '')
    return name && name.length <= 180 && /\.(?:xlsx|zip)$/i.test(name) ? name : '쿠팡_카테고리_' + categoryId + '.zip'
  }
  async function categoryBytes(response) {
    const maximum = 3_000_000
    if (Number(response.headers.get('content-length')) > maximum) throw new Error('카테고리 양식은 3MB까지 연결할 수 있습니다.')
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > maximum) throw new Error('카테고리 양식은 3MB까지 연결할 수 있습니다.')
      return bytes
    }
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        total += part.value.length
        if (total > maximum) { await reader.cancel(); throw new Error('카테고리 양식은 3MB까지 연결할 수 있습니다.') }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
  }
  async function downloadCategory(categoryId) {
    return categoryResponse('/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=' + categoryId + '&locale=ko', async response => {
      const bytes = await categoryBytes(response)
      if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('쿠팡 카테고리 양식 파일을 확인하지 못했습니다. 서플라이어허브에서 확인해주세요.')
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return { ok: true, file: { name: categoryFilename(response.headers.get('content-disposition'), categoryId), data: btoa(binary) } }
    })
  }
  function categoryCommand(message) {
    const args = categoryArguments(message)
    return message.type === 'CATEGORY_SEARCH' ? searchCategories(args.queries) : downloadCategory(args.categoryId)
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.channel === CHANNEL && ['CATEGORY_SEARCH', 'CATEGORY_TEMPLATE'].includes(message.type)) {
      Promise.resolve().then(() => categoryCommand(message)).then(respond).catch(error => respond({ ok: false, error: error.message }))
      return true
    }
    if (message?.channel !== CHANNEL || !['PREPARE', 'RESUME_PREPARED', 'CHECK_QUOTE', 'CHECK_PRODUCTS'].includes(message.type)) return
    if (busy) { respond({ ok: true, busy: true }); return }
    busy = true
    activeJob = message.job
    Promise.resolve().then(async () => {
      rules.validateJob(activeJob)
      if (/\/login(?:\/|$)|\/signin(?:\/|$)/i.test(location.pathname) || document.querySelector('input[type="password"]')) {
        await state('login_required', '서플라이어허브 창에서 로그인한 뒤 SaaS의 결과 확인을 눌러주세요.')
        return { ok: true }
      }
      if (message.type === 'PREPARE') await prepare()
      else if (message.type === 'RESUME_PREPARED') showPrepared('견적서·품질표시가 선택된 기존 등록 작업입니다. 선언·필수서류를 직접 확인해주세요. 파일 선택이 없어졌다면 중복 업로드하지 말고 쿠팡의 기존 검증 상태를 먼저 확인해주세요.')
      else if (message.type === 'CHECK_QUOTE') await checkQuote()
      else await checkProducts(message.quoteId)
      return { ok: true }
    }).then(respond).catch(async error => { await state('failed', error.message).catch(() => {}); respond({ ok: false, error: error.message }) }).finally(() => { busy = false })
    return true
  })
})()

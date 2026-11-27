/* Individual Supplier Hub wizard. DOM events stay inside this tab; no OS input. */
;(function (scope) {
  if (scope.FuntasticIndividualAdapter) return
  const CHANNEL = 'funtastic-coupang-registration'
  const ORIGIN = 'https://supplier.coupang.com'
  const STEPS = ['start', 'product', 'image', 'legal', 'logistics']
  const STEP_PATHS = { start: 'startPage', product: 'productPage', image: 'imagePage', legal: 'legalPage', logistics: 'logisticsPage' }
  const PANEL_ID = 'funtastic-individual-registration-status'
  const clean = value => String(value ?? '').normalize('NFC').trim()
  const text = node => clean(node?.innerText || node?.textContent)
  const caption = value => clean(value).replace(/\b(?:arrow_forward|arrow_back|history|storefront|help|info|search)\b/g, '').trim()
  const key = value => caption(value).replace(/[^\p{L}\p{N}]/gu, '')
  let active = null
  let busy = false

  class Attention extends Error {
    constructor(message, reason = 'screen') { super(message); this.reason = reason }
  }
  function ensureRunning() {
    if (active?.abort.signal.aborted) throw new Attention('자동 입력이 중단됐습니다. 입력한 내용은 보존합니다.', 'cancelled')
  }
  function click(node) { ensureRunning(); node.click() }
  function visible(node) {
    if (!node || !node.isConnected || node.closest('[hidden], [aria-hidden="true"]')) return false
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      const style = document.defaultView.getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  }
  const outsidePanel = node => !node.closest('#' + PANEL_ID)
  function exactlyOne(nodes, description) {
    const unique = [...new Set(nodes)]
    if (unique.length !== 1) throw new Attention(`${description} 항목을 정확히 찾지 못했습니다. 쿠팡 화면에서 확인한 뒤 계속해주세요.`, 'screen')
    return unique[0]
  }
  function buttons(label, root = document) {
    return Array.from(root.querySelectorAll('button, [role="button"]')).filter(node => visible(node) && outsidePanel(node) && key(text(node)) === key(label))
  }
  function button(label, root = document) { return exactlyOne(buttons(label, root), label) }
  function labels(label) {
    return Array.from(document.querySelectorAll('label, legend, span, div, p, h1, h2, h3')).filter(node => {
      if (!visible(node) || !outsidePanel(node)) return false
      const own = Array.from(node.childNodes).filter(child => child.nodeType === 3).map(child => child.textContent).join('')
      return key(own) === key(label) || (key(text(node)) === key(label) && !Array.from(node.children).some(child => key(text(child)) === key(label)))
    })
  }
  function labelled(label, selector, placeholders = []) {
    const matches = Array.from(document.querySelectorAll(selector)).filter(node => visible(node) && outsidePanel(node)
      && (key(node.getAttribute('aria-label')) === key(label) || placeholders.includes(node.getAttribute('placeholder'))))
    for (const labelNode of labels(label)) {
      const target = labelNode.htmlFor ? document.getElementById(labelNode.htmlFor) : null
      if (target?.matches(selector) && visible(target)) matches.push(target)
      for (let container = labelNode; container && container !== document.body; container = container.parentElement) {
        const candidates = Array.from(container.querySelectorAll(selector)).filter(node => visible(node) && outsidePanel(node))
        if (candidates.length === 1) { matches.push(candidates[0]); break }
        if (candidates.length > 1) break
      }
    }
    return exactlyOne(matches, label)
  }
  function field(label, placeholders = []) { return labelled(label, 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]), textarea, select', placeholders) }
  function setNative(input, value) {
    ensureRunning()
    if (input.disabled || input.readOnly) throw new Attention('입력할 수 없는 항목이 있습니다. 쿠팡 화면을 확인해주세요.', 'screen')
    const win = document.defaultView
    if (input.tagName === 'SELECT') {
      const option = exactlyOne(Array.from(input.options).filter(node => clean(node.value) === clean(value) || key(text(node)) === key(value)), '선택값 ' + value)
      input.value = option.value
    } else {
      const prototype = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, String(value))
    }
    input.dispatchEvent(new win.Event('input', { bubbles: true }))
    input.dispatchEvent(new win.Event('change', { bubbles: true }))
    input.dispatchEvent(new win.Event('blur', { bubbles: true }))
    if (clean(input.value) !== clean(value) && input.tagName !== 'SELECT') throw new Attention('입력값이 화면에 반영되지 않았습니다. 계속하기 전에 확인해주세요.', 'screen')
  }
  function setField(label, value, placeholders) { const input = field(label, placeholders); setNative(input, value); return input }
  function radio(groupLabel, value) {
    const found = []
    for (const labelNode of labels(groupLabel)) {
      for (let container = labelNode; container && container !== document.body; container = container.parentElement) {
        const inputs = Array.from(container.querySelectorAll('input[type="radio"]')).filter(visible)
        if (!inputs.length) continue
        for (const input of inputs) {
          const associated = Array.from(document.querySelectorAll('label')).filter(label => label.htmlFor === input.id || label.contains(input))
          if (key(input.getAttribute('aria-label')) === key(value) || associated.some(label => key(text(label)) === key(value))) found.push(input)
        }
        break
      }
    }
    const input = exactlyOne(found, groupLabel + ' ' + value)
    if (!input.checked) click(input)
    if (!input.checked) throw new Attention(groupLabel + ' 선택값이 반영되지 않았습니다.', 'screen')
  }
  function waitFor(read, timeout = 12000) {
    ensureRunning()
    const initial = read()
    if (initial) return Promise.resolve(initial)
    return new Promise((resolve, reject) => {
      const finish = (error, value) => { observer.disconnect(); clearTimeout(timer); active?.abort?.signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(value) }
      const check = () => { try { const value = read(); if (value) finish(null, value) } catch (error) { finish(error) } }
      const observer = new MutationObserver(check)
      const timer = setTimeout(() => finish(new Attention('쿠팡 화면의 처리 결과를 확인하지 못했습니다. 중복 처리하지 않고 화면 확인을 기다립니다.', 'screen')), timeout)
      const aborted = () => finish(new Attention('사용자가 자동 입력을 중단했습니다. 입력한 내용은 그대로 보존합니다.', 'cancelled'))
      active?.abort?.signal.addEventListener('abort', aborted, { once: true })
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true })
    })
  }
  function currentStep() {
    if (location.origin !== ORIGIN) return null
    return STEPS.find(step => location.pathname === '/sr/registration/step/' + STEP_PATHS[step]) || null
  }
  function loginNeeded() { return /\/(?:login|signin|sso)(?:\/|$)/i.test(location.pathname) || !!document.querySelector('input[type="password"]') }
  function assertProduct(product, step) {
    if (step === 'start') {
      const input = field('상품명', ['예) 탐사 스파클링워터 라임향'])
      if (clean(input.value) && clean(input.value) !== clean(product.name)) throw new Attention('다른 상품이 작성 중인 창입니다. 기존 내용을 덮어쓰지 않습니다.', 'different_product')
    } else {
      const matching = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]')).some(node => visible(node) && text(node) === clean(product.name))
      if (!matching) throw new Attention('현재 쿠팡 상품명과 SaaS 등록 상품이 일치하지 않습니다. 기존 내용을 덮어쓰지 않습니다.', 'different_product')
    }
  }
  function rowCells(table, row) {
    const headerRows = Array.from(table.querySelectorAll('thead tr'))
    const header = headerRows.at(-1)
    const headings = header ? Array.from(header.children).map(node => key(text(node))) : []
    const cells = Array.from(row.children).filter(node => node.tagName === 'TD')
    const aligned = headings.length === cells.length + 1 ? headings.slice(1) : headings
    if (aligned.length !== cells.length) return null
    return { headings: aligned, cells }
  }
  function grid(headers) {
    const tables = Array.from(document.querySelectorAll('table')).filter(table => {
      if (!visible(table) || !outsidePanel(table)) return false
      const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelector('td'))
      return rows.some(row => { const data = rowCells(table, row); return data && headers.every(header => data.headings.includes(key(header))) })
    })
    return exactlyOne(tables, headers.join('·') + ' 표')
  }
  function gridRow(table, rowLabel) {
    const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelector('td'))
    if (!rowLabel) return exactlyOne(rows, '단일 상품 옵션')
    return exactlyOne(rows.filter(row => Array.from(row.querySelectorAll('th')).some(node => key(text(node)) === key(rowLabel))), rowLabel + ' 행')
  }
  function gridCell(headers, column, rowLabel) {
    const table = grid(headers)
    const row = gridRow(table, rowLabel)
    const data = rowCells(table, row)
    const index = data.headings.indexOf(key(column))
    if (index < 0) throw new Attention(column + ' 열을 찾지 못했습니다.', 'screen')
    return data.cells[index]
  }
  const sameValue = (left, right) => clean(left).replace(/[\s,]/g, '') === clean(right).replace(/[\s,]/g, '')
  async function editCell(headers, column, value, rowLabel) {
    let cell = gridCell(headers, column, rowLabel)
    const inline = Array.from(cell.querySelectorAll('input:not([type="checkbox"]), textarea')).find(visible)
    if (inline) { setNative(inline, value); return }
    if (sameValue(text(cell), value)) return
    const previous = document.activeElement
    const win = document.defaultView
    ensureRunning()
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) cell.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mousedown' ? 1 : 0 }))
    const editor = await waitFor(() => {
      const element = document.activeElement
      return element && element.matches('input:not([type="checkbox"]):not([type="radio"]), textarea') && visible(element)
        && (element !== previous || cell.contains(element)) ? element : null
    }, 4000)
    setNative(editor, value)
    for (const type of ['keydown', 'keyup']) editor.dispatchEvent(new win.KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
    editor.blur()
    await waitFor(() => { cell = gridCell(headers, column, rowLabel); return sameValue(text(cell), value) }, 4000)
  }
  function checkCell(headers, column, rowLabel) {
    const cell = gridCell(headers, column, rowLabel)
    const input = exactlyOne(Array.from(cell.querySelectorAll('input[type="checkbox"]')), column + ' 선택')
    if (!input.checked) click(input)
    if (!input.checked) throw new Attention(column + ' 선택이 반영되지 않았습니다.', 'screen')
  }
  function savedAt() { return text(document.body).match(/마지막\s*저장\s*:\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2})/)?.[1] || '' }
  async function report(phase, message, extra = {}) {
    const step = extra.step || currentStep() || 'start'
    const response = await chrome.runtime.sendMessage({ channel: CHANNEL, type: 'INDIVIDUAL_PHASE', jobId: active.job.jobId, token: active.job.token,
      productId: active.product.id, productIndex: active.index, phase, message, ...extra, step: step === 'start' ? 'basic' : step })
    if (!response?.ok) throw new Error(response?.error || '등록 진행 상태를 저장하지 못했습니다. 중복 처리하지 않고 중단합니다.')
  }
  async function saveStep() {
    const previousAt = savedAt()
    const previousNotices = new Set(Array.from(document.querySelectorAll('*')).filter(node => visible(node) && text(node) === '저장되었습니다.'))
    const completed = waitFor(() => {
      const date = savedAt()
      const fresh = Array.from(document.querySelectorAll('*')).some(node => visible(node) && text(node) === '저장되었습니다.' && !previousNotices.has(node))
      return fresh || (date && date !== previousAt) ? { date } : null
    })
    click(button('저장하기'))
    const confirmation = await completed
    active.checkpoint = { ...active.checkpoint, step: currentStep(), draftName: active.product.name, draftSavedAt: confirmation.date || savedAt(), assets: { ...active.assets } }
    await report('running', '쿠팡 중간 저장을 확인했습니다.', { ...active.checkpoint, stepStatus: 'saved' })
  }
  async function nextStep(step) {
    const index = STEPS.indexOf(step)
    if (index < 0 || index >= STEPS.length - 1) throw new Error('최종 상품 등록은 자동 실행하지 않습니다.')
    click(button('다음'))
    await waitFor(() => currentStep() === STEPS[index + 1] && !document.querySelector('[role="dialog"]'))
  }
  function selectedCategory() {
    const input = field('카테고리', ['카테고리를 검색해주세요'])
    const value = clean(input.value)
    return value.includes('>') ? value : ''
  }
  async function restoreSavedDraft() {
    const proof = active.checkpoint
    if (!proof?.draftName || !proof?.draftSavedAt) return false
    click(button('중간 저장 불러오기'))
    const table = await waitFor(() => Array.from(document.querySelectorAll('table')).find(node => text(node).includes('저장 날짜') && text(node).includes('상품명')))
    const matches = Array.from(table.querySelectorAll('tbody tr, tr')).filter(row => {
      const cells = Array.from(row.querySelectorAll('td'))
      return cells.some(cell => text(cell) === proof.draftName) && cells.some(cell => text(cell) === proof.draftSavedAt)
    })
    const row = exactlyOne(matches, '이 작업에서 저장한 상품 초안')
    click(button('불러오기', row))
    await waitFor(() => { try { return clean(field('상품명', ['예) 탐사 스파클링워터 라임향']).value) === active.product.name } catch { return false } })
    return true
  }
  async function start(product) {
    const name = field('상품명', ['예) 탐사 스파클링워터 라임향'])
    if (!clean(name.value) && active.checkpoint?.draftSavedAt) await restoreSavedDraft()
    assertProduct(product, 'start')
    setField('상품명', product.name, ['예) 탐사 스파클링워터 라임향'])
    let category = selectedCategory()
    const expected = product.category.hubPath || active.checkpoint?.categoryPath
    if (category && ((expected && key(category) === key(expected)) || active.reviewCategory)) {
      active.checkpoint = { ...active.checkpoint, categoryPath: category }
      await saveStep(); await nextStep('start'); return
    }
    if (category) throw new Attention('카테고리가 이미 선택돼 있습니다. 상품에 맞는지 직접 확인한 뒤 계속해주세요.', 'category')
    const input = field('카테고리', ['카테고리를 검색해주세요'])
    setNative(input, product.category.searchTerms[0] || product.category.sourceName || product.name)
    const candidates = await waitFor(() => {
      const found = Array.from(document.querySelectorAll('[role="option"], button, li')).filter(node => visible(node) && outsidePanel(node) && text(node).includes('>'))
      return found.length ? found : null
    }, 6000).catch(() => [])
    const matches = candidates.filter(node => {
      const value = text(node)
      if (expected) return key(value) === key(expected)
      const leaf = clean(value.split('>').at(-1))
      return product.category.searchTerms.some(term => key(term) === key(leaf))
    })
    const distinct = [...new Map(matches.map(node => [text(node), node])).values()]
    if (distinct.length !== 1) throw new Attention('펀타 등록 분류를 기준으로 검색했습니다. 쿠팡 카테고리 후보를 확인해 하나 선택한 뒤 계속해주세요.', 'category')
    click(distinct[0])
    category = await waitFor(selectedCategory)
    active.checkpoint = { ...active.checkpoint, categoryPath: category }
    await saveStep(); await nextStep('start')
  }
  async function productStep(product) {
    assertProduct(product, 'product')
    setField('모델명', product.modelName, ['예) ModelNumber123'])
    const noBrand = document.querySelector('input[type="checkbox"][aria-label="브랜드 없음"]') || Array.from(document.querySelectorAll('label')).find(node => key(text(node)) === key('브랜드 없음'))?.control
    if (noBrand?.checked) click(noBrand)
    setField('브랜드', product.brand, ['예) 탐사'])
    const headers = ['색상', '수량', '공급가', '쿠팡 판매가', '상품 바코드', '쿠팡 바코드']
    for (const [column, value] of [['색상', product.color], ['수량', product.quantity], ['공급가', product.supplyPrice], ['쿠팡 판매가', product.sellingPrice]]) await editCell(headers, column, value)
    if (product.coupangBarcode) checkCell(headers, '쿠팡 바코드')
    else await editCell(headers, '상품 바코드', product.barcode)
    setField('제조사', product.manufacturer, ['예) 쿠팡'])
    radio('거래타입', product.tradeType)
    radio('과세여부', product.taxType)
    radio('수입여부', product.importType)
    // Enter each tag separately: a bulk comma paste merged the first two tags in the live test.
    const tagField = field('검색태그', ['검색태그 입력 시, 콤마를 넣어 구분해주세요. (,)'])
    const tagContainer = tagField.parentElement
    for (const tag of product.tags) {
      ensureRunning()
      if (Array.from(tagContainer.querySelectorAll('span, div')).some(node => text(node) === tag)) continue
      tagField.focus(); setNative(tagField, tag)
      tagField.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
      await waitFor(() => Array.from(tagContainer.querySelectorAll('span, div')).some(node => text(node) === tag), 4000)
    }
    setField('사이즈', product.size, ['예) S, Medium, Free, 대, one size 등'])
    await saveStep()
    if (!document.getElementById('agreeMSRPTerm')?.checked) throw new Attention('가격정보 이용 약관을 쿠팡 화면에서 직접 읽고 동의한 뒤 계속해주세요.', 'terms')
    await nextStep('product')
  }
  const imageLabels = ['대표 이미지', '추가 이미지 (최대 9개)', '라벨(상품 표시사항) 사진 또는 도안 이미지', '상품 상세 컨텐츠']
  function sectionNodes(label, selector, includeHidden = false) {
    const startNode = exactlyOne(labels(label), label + ' 구역')
    const boundaries = imageLabels.filter(value => value !== label).flatMap(labels).filter(node => startNode.compareDocumentPosition(node) & 4)
    const boundary = boundaries.find(node => !boundaries.some(other => other !== node && (node.compareDocumentPosition(other) & 2)))
    const afterStart = node => !!(startNode.compareDocumentPosition(node) & 4)
    return Array.from(document.querySelectorAll(selector)).filter(node => outsidePanel(node) && (includeHidden || visible(node)) && afterStart(node) && (!boundary || !!(node.compareDocumentPosition(boundary) & 4)))
  }
  const imagePreviews = label => sectionNodes(label, 'img').filter(node => node.getAttribute('src') && !node.getAttribute('src').startsWith('data:image/svg'))
  async function addImageUrl(label, url) {
    const count = imagePreviews(label).length
    const control = exactlyOne(sectionNodes(label, 'button, [role="button"]').filter(node => key(text(node)) === key('URL로 등록')), label + ' URL 등록')
    click(control)
    const dialog = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"]')).find(node => visible(node) && text(node).includes('URL로 등록')))
    const input = exactlyOne(Array.from(dialog.querySelectorAll('input, textarea')).filter(visible), '이미지 URL')
    setNative(input, url); click(button('확인', dialog))
    await waitFor(() => imagePreviews(label).length > count)
  }
  function assignFiles(input, files) {
    ensureRunning()
    if (input.files?.length) throw new Attention('첨부파일이 이미 선택돼 있습니다. 중복 업로드를 방지하기 위해 확인이 필요합니다.', 'existing_assets')
    const transfer = new DataTransfer()
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0))
      if (!/\.(?:jpg|jpeg|png)$/i.test(file.name) || bytes.length > 20_000_000) throw new Error('라벨은 20MB 미만의 JPG 또는 PNG 파일이어야 합니다.')
      transfer.items.add(new File([bytes], file.name, { type: /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg' }))
    }
    input.files = transfer.files
    input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }))
    input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }))
  }
  async function imageStep(product) {
    assertProduct(product, 'image')
    const primary = imagePreviews(imageLabels[0])
    if (!primary.length) await addImageUrl(imageLabels[0], product.primaryImageUrl)
    else if (!active.assets.primary && !primary.some(node => node.src === product.primaryImageUrl)) throw new Attention('기존 대표 이미지를 확인한 뒤 계속해주세요.', 'existing_assets')
    active.assets.primary = true
    const additional = product.additionalImageUrls.filter(url => url !== product.primaryImageUrl).slice(0, 9)
    let count = imagePreviews(imageLabels[1]).length
    if (count && !active.assets.additionalCount && !active.reviewAssets) throw new Attention('기존 추가 이미지를 확인한 뒤 계속해주세요.', 'existing_assets')
    for (const url of additional.slice(count)) { await addImageUrl(imageLabels[1], url); count++ }
    active.assets.additionalCount = count
    const files = product.labelFiles || []
    if (!files.length) throw new Attention('품질표시 JPG 파일이 필요합니다. 공개 URL 라벨은 파일로 추가한 뒤 계속해주세요.', 'labels')
    let labelCount = imagePreviews(imageLabels[2]).length
    if (labelCount && !active.assets.labelNames && !active.reviewAssets) throw new Attention('기존 품질표시 이미지를 확인한 뒤 계속해주세요.', 'existing_assets')
    for (const file of files.slice(labelCount)) {
      const input = exactlyOne(sectionNodes(imageLabels[2], 'input[type="file"]', true), '품질표시 파일 입력')
      assignFiles(input, [file])
      await waitFor(() => imagePreviews(imageLabels[2]).length > labelCount)
      labelCount++
    }
    active.assets.labelNames = files.map(file => file.name)
    const source = button('Source code')
    click(source)
    const dialog = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"]')).find(node => visible(node) && text(node).includes('Source Code')))
    const editor = exactlyOne(Array.from(dialog.querySelectorAll('textarea')).filter(visible), '상세 HTML 편집기')
    setNative(editor, product.detailHtml); click(button('Save', dialog))
    const expected = new DOMParser().parseFromString(product.detailHtml, 'text/html').querySelector('img')?.getAttribute('src')
    await waitFor(() => Array.from(document.querySelectorAll('iframe')).some(frame => {
      try { return Array.from(frame.contentDocument?.querySelectorAll('img') || []).some(node => node.getAttribute('src') === expected) } catch { return false }
    }))
    active.assets.detailImageSrc = expected
    setField('이미지 대체 텍스트', product.alternativeText)
    await saveStep()
    if (!document.getElementById('agreeLabelContact')?.checked) throw new Attention('라벨의 업무용 연락처 공개 안내를 직접 확인하고 동의한 뒤 계속해주세요.', 'terms')
    await nextStep('image')
  }
  async function legalStep(product) {
    assertProduct(product, 'legal')
    if (!active.reviewLegalDocs) throw new Attention('추가 서류와 법적 근거 증빙을 쿠팡 화면에서 직접 확인하고 선택한 뒤 계속해주세요.', 'legal_documents')
    const master = product.certifications['전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입']
    radio('전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입', master)
    const certificates = ['전기용품 및 생활용품, 어린이 (KC) 인증번호', '방송통신 기자재 (EMC) 인증 번호', '안전기준적합확인 신고번호']
    const headers = ['인증 번호', '인증서 업로드', '해당사항없음']
    for (const label of certificates) {
      const value = product.certifications[label]
      if (key(value) !== key('해당사항없음')) throw new Attention(label + ' 인증서 원본과 번호를 직접 확인해주세요.', 'certification')
      checkCell(headers, '해당사항없음', label)
    }
    const noticeHeaders = ['설명', '상품 상세페이지 참조']
    for (const [label, value] of Object.entries(product.notices)) await editCell(noticeHeaders, '설명', value, label)
    await saveStep(); await nextStep('legal')
  }
  async function logisticsStep(product) {
    assertProduct(product, 'logistics')
    setField('박스 내 SKU 수량', product.logistics.boxQuantity, ['예) 24'])
    setField('유통기간 *식품의 경우 소비기간 (일수기재)', product.logistics.shelfLifeDays, ['예) 365'])
    radio('취급주의 사유', product.logistics.handlingReason)
    setField('한 개 단품 포장 무게', product.logistics.weightGrams, ['예) 1000'])
    setField('한 개 단품 포장 사이즈', product.logistics.dimensionsMm.join('*'), ['예) 150*300*400'])
    await saveStep()
    await report('prepared', '모든 단계의 입력과 중간 저장을 확인했습니다. 쿠팡 화면에서 최종 검토 후 상품 등록을 눌러주세요.', { ...active.checkpoint, stepStatus: 'saved' })
    active.completed = true
    renderPanel('입력과 중간 저장이 완료됐습니다. 최종 상품 등록은 쿠팡 화면에서 직접 검토하고 실행해주세요.')
    return 'prepared'
  }
  function renderPanel(message, resume = false) {
    let panel = document.getElementById(PANEL_ID)
    if (!panel) { panel = document.createElement('section'); panel.id = PANEL_ID; panel.setAttribute('aria-label', 'Funtastic 개별등록 진행'); document.body.append(panel) }
    Object.assign(panel.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647', maxWidth: '350px', background: '#fff', color: '#111827', border: '2px solid #7c3aed', borderRadius: '12px', padding: '14px', font: '14px/1.6 sans-serif', boxShadow: '0 8px 24px #0003' })
    panel.replaceChildren()
    const title = document.createElement('strong'); title.textContent = 'Funtastic 개별등록'
    const body = document.createElement('p'); body.textContent = message
    panel.append(title, body)
    if (resume) {
      const control = document.createElement('button'); control.type = 'button'; control.textContent = '확인 후 계속'
      control.addEventListener('click', event => {
        if (!event.isTrusted || busy || !active) return
        if (active.reason === 'category') active.reviewCategory = true
        if (active.reason === 'existing_assets') active.reviewAssets = true
        if (active.reason === 'legal_documents') active.reviewLegalDocs = true
        void run()
      })
      panel.append(control)
    }
  }
  async function run() {
    if (active?.completed) return { ok: true, phase: 'prepared' }
    if (busy) return { ok: true, phase: 'running' }
    busy = true
    try {
      if (loginNeeded()) throw new Attention('서플라이어허브에 로그인한 뒤 이 창의 계속 버튼을 눌러주세요.', 'login')
      if (location.origin !== ORIGIN || !location.pathname.startsWith('/sr/registration')) throw new Attention('쿠팡 개별 상품 등록 화면이 아닙니다.', 'screen')
      let step = await waitFor(currentStep)
      while (step) {
        if (active.abort.signal.aborted) throw new Attention('자동 입력이 중단됐습니다. 입력한 내용은 보존합니다.', 'cancelled')
        renderPanel(active.product.name + ' 입력 중 · ' + (STEPS.indexOf(step) + 1) + '/5')
        await report('running', active.product.name + ' 입력 중', { step })
        if (step === 'start') await start(active.product)
        else if (step === 'product') await productStep(active.product)
        else if (step === 'image') await imageStep(active.product)
        else if (step === 'legal') await legalStep(active.product)
        else return { ok: true, phase: await logisticsStep(active.product) }
        step = currentStep()
      }
      throw new Attention('쿠팡 등록 단계가 변경됐습니다. 현재 화면을 확인해주세요.', 'screen')
    } catch (error) {
      const phase = error instanceof Attention ? 'attention_required' : 'failed'
      active.reason = error.reason || 'error'
      await report(phase, error.message, { reason: active.reason, ...active.checkpoint }).catch(() => {})
      renderPanel(error.message, phase === 'attention_required' && active.reason !== 'cancelled')
      return { ok: phase === 'attention_required', phase, reason: active.reason, error: error.message }
    } finally { busy = false }
  }
  function validate(job, index) {
    if (!job || job.mode !== 'individual' || typeof job.jobId !== 'string' || !job.jobId || typeof job.token !== 'string' || job.token.length < 16
      || !Array.isArray(job.products) || !Number.isInteger(index) || index < 0 || index >= job.products.length) throw new Error('개별등록 작업을 확인해주세요.')
    const product = job.products[index]
    if (!product?.id || !product.name || !product.category || !Array.isArray(product.category.searchTerms) || !product.logistics
      || !Array.isArray(product.logistics.dimensionsMm) || product.logistics.dimensionsMm.length !== 3
      || product.logistics.dimensionsMm.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('개별등록 필수 입력값이 올바르지 않습니다.')
    return product
  }
  scope.FuntasticIndividualAdapter = { Attention, clean, key, visible, field, setNative, setField, radio, grid, gridCell, editCell, checkCell, sectionNodes, assignFiles, assertProduct, currentStep, validate, run }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.channel !== CHANNEL) return
    if (message.type === 'INDIVIDUAL_STOP') {
      if (!active || active.job.jobId !== message.jobId || active.job.token !== message.token || active.product.id !== message.productId) respond({ ok: false, error: '중단할 개별등록 작업이 일치하지 않습니다.' })
      else { active.abort.abort(); renderPanel('자동 입력이 중단됐습니다. 입력한 내용은 그대로 보존합니다.'); respond({ ok: true }) }
      return
    }
    if (message.type !== 'INDIVIDUAL_PREPARE') return
    try {
      const index = message.productIndex ?? 0
      const product = validate(message.job, index)
      if (active && (active.job.jobId !== message.job.jobId || active.job.token !== message.job.token || active.product.id !== product.id)) throw new Error('다른 개별등록 작업이 작성 중인 창입니다.')
      if (!active) active = { job: message.job, product, index, checkpoint: message.checkpoint || {}, assets: { ...(message.checkpoint?.assets || {}) }, abort: new AbortController() }
      run().then(respond).catch(error => respond({ ok: false, error: error.message }))
    } catch (error) { respond({ ok: false, error: error.message }) }
    return true
  })
})(globalThis)

import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(path.resolve('tools/browser-extensions/funtastic-coupang-registration/individual-content.js'), 'utf8')
const channel = 'funtastic-coupang-registration'
const product = {
  id: 'r1', name: '윈터벨 크리스마스 트리 파티모자 그린트리', modelName: '윈터벨 크리스마스 트리 파티모자 그린트리',
  category: { sourcePath: '파티용품>파티모자', sourceName: '파티모자', searchTerms: ['파티모자'] },
  brand: '생활살림', color: '그린트리', quantity: '1개', supplyPrice: 3300, sellingPrice: 5500, coupangBarcode: true,
  manufacturer: 'Ningbo Guanghuan Arts & Crafts Co., Ltd.', tradeType: '기타 도소매업자', taxType: '과세', importType: '수입상품',
  tags: ['크리스마스용품', '크리스마스모자'], size: '34 x 37 cm', primaryImageUrl: 'https://cdn.tapeoff.kr/primary.jpg',
  additionalImageUrls: [], labelFiles: [{ name: 'label.jpg', data: '/9j/' }], detailHtml: '<img src="https://cdn.tapeoff.kr/detail.jpg">',
  alternativeText: '초록색 파티모자', certifications: {}, notices: {}, logistics: { boxQuantity: 20, shelfLifeDays: 0, handlingReason: '해당사항없음', weightGrams: 85, dimensionsMm: [360, 390, 150] },
}
const job = { mode: 'individual', jobId: 'individual-test', token: '0123456789abcdef', products: [product] }

type Adapter = {
  setField(label: string, value: string): void
  field(label: string): HTMLInputElement
  editCell(headers: string[], column: string, value: string): Promise<void>
  sectionNodes(label: string, selector: string): HTMLElement[]
  assignFiles(input: HTMLInputElement, files: Array<{ name: string; data: string }>): void
  assertProduct(value: typeof product, step: string): void
}
function content(step = 'productPage') {
  let listener: (message: unknown, sender: unknown, respond: (response: unknown) => void) => void = () => {}
  const messages: Record<string, unknown>[] = []
  class TestDataTransfer {
    files: File[] = []
    items = { add: (file: File) => this.files.push(file) }
  }
  const chrome = { runtime: { sendMessage: vi.fn(async message => { messages.push(message); return { ok: true } }), onMessage: { addListener: (value: typeof listener) => { listener = value } } } }
  const sandbox: Record<string, unknown> = { document, chrome, location: { origin: 'https://supplier.coupang.com', pathname: '/sr/registration/step/' + step }, MutationObserver, AbortController, setTimeout, clearTimeout, DataTransfer: TestDataTransfer, File, atob, DOMParser }
  vm.runInNewContext(source, sandbox)
  return {
    adapter: sandbox.FuntasticIndividualAdapter as Adapter,
    messages,
    send: (message: object) => new Promise<unknown>(resolve => listener({ channel, ...message }, {}, resolve)),
  }
}
function namedInput(label: string, placeholder = '') { return `<div><label>${label}<input aria-label="${label}" placeholder="${placeholder}"></label></div>` }
function radios(label: string, values: string[]) { return `<fieldset><legend>${label}</legend>${values.map((value, index) => `<label><input type="radio" name="${label}" id="${label}-${index}">${value}</label>`).join('')}</fieldset>` }
function productForm(inlineColor = true) {
  document.body.innerHTML = `<h2>${product.name}</h2>${namedInput('모델명')}${namedInput('브랜드')}
    <table><thead><tr>${['색상', '수량', '공급가', '쿠팡 판매가', '상품 바코드', '쿠팡 바코드'].map(label => `<th>${label} * help</th>`).join('')}</tr></thead>
    <tbody><tr><td>${inlineColor ? '<input aria-label="옵션색상">' : '예) 골드'}</td><td><input></td><td><input></td><td><input></td><td></td><td><input type="checkbox"></td></tr></tbody></table>
    ${namedInput('제조사')}${radios('거래타입', ['제조사', '기타 도소매업자'])}${radios('과세여부', ['과세', '면세'])}${radios('수입여부', ['수입대상아님', '수입상품'])}
    <div><label>검색태그</label><input aria-label="검색태그"></div>${namedInput('사이즈')}
    <input id="agreeMSRPTerm" type="checkbox"><label for="agreeMSRPTerm">이용약관을 읽고 동의합니다.</label>
    <span id="saved-at">마지막 저장: 2026.11.26 17:00</span><button id="save">저장하기</button><button id="next">다음 arrow_forward</button><button id="final">상품 등록 arrow_forward</button>`
  const tag = document.querySelector<HTMLInputElement>('input[aria-label="검색태그"]')!
  tag.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    const chip = document.createElement('span'); chip.textContent = tag.value
    tag.parentElement!.insertBefore(chip, tag); tag.value = ''
  })
  document.querySelector('#save')!.addEventListener('click', () => {
    document.querySelector('#saved-at')!.textContent = '마지막 저장: 2026.11.26 17:01'
    const notice = document.createElement('div'); notice.textContent = '저장되었습니다.'; document.body.append(notice)
  })
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

describe('Individual Supplier Hub DOM adapter', () => {
  it('requires a user review of legal documents before changing the legal form', async () => {
    document.body.innerHTML = `<h2>${product.name}</h2>${radios('추가 서류', ['있음', '없음'])}${radios('법적 근거 필요한 문구 사용 시 증빙 서류 또는 소명자료', ['있음', '없음'])}`
    const instance = content('legalPage')
    expect(await instance.send({ type: 'INDIVIDUAL_PREPARE', job })).toMatchObject({ phase: 'attention_required', reason: 'legal_documents' })
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).every(input => !input.checked)).toBe(true)
    document.querySelector<HTMLButtonElement>('#funtastic-individual-registration-status button')!.click()
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).every(input => !input.checked)).toBe(true)
  })
  it('uses native setters and framework events without any OS input', () => {
    document.body.innerHTML = namedInput('제조사')
    const input = document.querySelector('input')!
    const inputEvent = vi.fn(); const change = vi.fn()
    input.addEventListener('input', inputEvent); input.addEventListener('change', change)
    content().adapter.setField('제조사', '테스트 제조사')
    expect(input.value).toBe('테스트 제조사')
    expect(inputEvent).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce()
  })

  it('refuses ambiguous labels rather than writing another field', () => {
    document.body.innerHTML = namedInput('제조사') + namedInput('제조사')
    expect(() => content().adapter.setField('제조사', '테스트')).toThrow('정확히 찾지 못했습니다')
    expect(Array.from(document.querySelectorAll('input')).every(input => !input.value)).toBe(true)
  })

  it('commits a spreadsheet editor and verifies the displayed cell value', async () => {
    document.body.innerHTML = '<table><thead><tr><th>공급가 * help</th></tr></thead><tbody><tr><td>예) 6500</td></tr></tbody></table>'
    const cell = document.querySelector('td')!
    cell.addEventListener('dblclick', () => {
      const editor = document.createElement('textarea'); document.body.append(editor); editor.focus()
      editor.addEventListener('keydown', event => { if (event.key === 'Enter') { cell.textContent = Number(editor.value).toLocaleString('en-US'); editor.remove() } })
    })
    await content().adapter.editCell(['공급가'], '공급가', '3300')
    expect(cell.textContent).toBe('3,300')
  })

  it('scopes file inputs to their observed image section', () => {
    document.body.innerHTML = '<section><span>대표 이미지</span><input id="primary" type="file"></section><section><span>추가 이미지 (최대 9개)</span><input id="additional" type="file"></section><section><span>라벨(상품 표시사항) 사진 또는 도안 이미지</span><input id="label" type="file"></section><section><span>상품 상세 컨텐츠</span><input id="detail" type="file"></section>'
    const adapter = content('imagePage').adapter
    expect(adapter.sectionNodes('라벨(상품 표시사항) 사진 또는 도안 이미지', 'input[type="file"]').map(input => input.id)).toEqual(['label'])
    const input = document.querySelector<HTMLInputElement>('#label')!
    Object.defineProperty(input, 'files', { value: [], writable: true })
    adapter.assignFiles(input, product.labelFiles)
    expect(Array.from(input.files!).map(file => file.name)).toEqual(['label.jpg'])
    expect(() => adapter.assignFiles(input, product.labelFiles)).toThrow('이미 선택')
  })

  it('fills and saves product fields then waits for an actual user terms choice', async () => {
    productForm()
    const next = vi.fn(); const final = vi.fn()
    document.querySelector('#next')!.addEventListener('click', next); document.querySelector('#final')!.addEventListener('click', final)
    const instance = content()
    expect(await instance.send({ type: 'INDIVIDUAL_PREPARE', job })).toMatchObject({ ok: true, phase: 'attention_required', reason: 'terms' })
    expect(document.querySelector<HTMLInputElement>('[aria-label="모델명"]')!.value).toBe(product.name)
    expect(document.querySelector<HTMLInputElement>('[aria-label="브랜드"]')!.value).toBe('생활살림')
    expect(document.querySelector<HTMLInputElement>('#agreeMSRPTerm')!.checked).toBe(false)
    expect(instance.messages.some(message => message.stepStatus === 'saved' && message.draftName === product.name)).toBe(true)
    expect(next).not.toHaveBeenCalled(); expect(final).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('#funtastic-individual-registration-status button')!.click()
    expect(next).not.toHaveBeenCalled() // programmatic clicks cannot approve a review gate
  })

  it('rejects another product and never mutates its form', async () => {
    productForm(); document.querySelector('h2')!.textContent = '다른 사용자의 상품'
    const instance = content()
    expect(await instance.send({ type: 'INDIVIDUAL_PREPARE', job })).toMatchObject({ phase: 'attention_required', reason: 'different_product' })
    expect(document.querySelector<HTMLInputElement>('[aria-label="모델명"]')!.value).toBe('')
  })

  it('scopes stop commands and aborts a pending grid editor before further writes', async () => {
    productForm(false)
    const instance = content()
    const pending = instance.send({ type: 'INDIVIDUAL_PREPARE', job })
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[aria-label="브랜드"]')!.value).toBe('생활살림'))
    expect(await instance.send({ type: 'INDIVIDUAL_STOP', jobId: job.jobId, token: 'different', productId: product.id })).toMatchObject({ ok: false })
    expect(await instance.send({ type: 'INDIVIDUAL_STOP', jobId: job.jobId, token: job.token, productId: product.id })).toEqual({ ok: true })
    expect(await pending).toMatchObject({ phase: 'attention_required', reason: 'cancelled' })
    expect(document.querySelector<HTMLInputElement>('[aria-label="제조사"]')!.value).toBe('')
    expect(instance.messages.some(message => message.phase === 'prepared')).toBe(false)
  })

  it('reports login without filling or submitting anything', async () => {
    document.body.innerHTML = '<input type="password"><button>로그인</button>'
    const instance = content('login')
    expect(await instance.send({ type: 'INDIVIDUAL_PREPARE', job })).toMatchObject({ phase: 'attention_required', reason: 'login' })
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('')
  })
})

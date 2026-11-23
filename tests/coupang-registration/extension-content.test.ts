import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const directory = path.resolve('tools/browser-extensions/funtastic-coupang-registration')
const job = { jobId: 'content-job', token: '0123456789abcdef', rows: [{ id: 'r1', name: '테스트 상품' }], files: [{ name: 'content-job.xlsx', data: 'UEs=', kind: 'workbook' }, { name: 'label.jpg', data: '/9j/', kind: 'label' }] }

function content(pathname: string) {
  let listener: (message: unknown, sender: unknown, respond: (value: unknown) => void) => void = () => {}
  const messages: Record<string, unknown>[] = []
  class TestDataTransfer {
    files: File[] = []
    items = { add: (file: File) => this.files.push(file) }
  }
  const chrome = { runtime: { sendMessage: vi.fn(async message => { messages.push(message); return { ok: true } }), onMessage: { addListener: (value: typeof listener) => { listener = value } } } }
  const sandbox: Record<string, unknown> = { chrome, URL, document, location: { pathname }, MutationObserver, setTimeout, clearTimeout, DataTransfer: TestDataTransfer, File, Event, HTMLInputElement, atob }
  vm.runInNewContext(readFileSync(path.join(directory, 'shared.js'), 'utf8'), sandbox)
  vm.runInNewContext(readFileSync(path.join(directory, 'supplier-content.js'), 'utf8'), sandbox)
  return { messages, send: (type: string) => new Promise<unknown>(resolve => listener({ channel: 'funtastic-coupang-registration', type, job }, {}, resolve)) }
}
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

describe('Observed Supplier Hub DOM adapter', () => {
  it('fills only the observed workbook and label slots and never checks declarations or clicks validation', async () => {
    document.body.innerHTML = '<h2>작성이 완료된 견적서 Excel 파일</h2><h2>제품 필수 표시사항을 업로드</h2><input type="file" multiple><input type="file" multiple><input type="file" multiple><input type="file" multiple><input id="msrpAgreement" type="checkbox"><input id="labelContactAgreement" type="checkbox"><button>파일 검증하기</button>'
    // jsdom has no browser FileList/DataTransfer implementation; keep observable slots.
    const slots = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    for (const slot of slots) Object.defineProperty(slot, 'files', { value: [], writable: true })
    const validation = vi.fn()
    document.querySelector('button')!.addEventListener('click', validation)
    const instance = content('/qvt/registration')
    expect(await instance.send('PREPARE')).toEqual({ ok: true })
    expect(Array.from(slots[0].files!).map(file => file.name)).toEqual(['content-job.xlsx'])
    expect(slots[1].files).toHaveLength(0)
    expect(Array.from(slots[2].files!).map(file => file.name)).toEqual(['label.jpg'])
    expect(slots[3].files).toHaveLength(0)
    expect(document.querySelector<HTMLInputElement>('#msrpAgreement')!.checked).toBe(false)
    expect(document.querySelector<HTMLInputElement>('#labelContactAgreement')!.checked).toBe(false)
    expect(validation).not.toHaveBeenCalled()
    document.querySelector<HTMLButtonElement>('#funtastic-supplier-registration-status button')!.click()
    expect(validation).not.toHaveBeenCalled() // only a trusted user click can request validation
    expect(instance.messages.some(message => message.type === 'PHASE' && message.phase === 'prepared')).toBe(true)
  })
  it('refuses a changed upload layout without assigning files or validating', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<h2>작성이 완료된 견적서 Excel 파일</h2><h2>제품 필수 표시사항을 업로드</h2><input type="file" multiple><input type="file" multiple><input type="file" multiple><button>파일 검증하기</button>'
    const instance = content('/qvt/registration')
    const result = instance.send('PREPARE')
    await vi.advanceTimersByTimeAsync(15001)
    expect(await result).toMatchObject({ ok: false })
    expect(instance.messages.some(message => message.type === 'CLAIM_PREPARATION')).toBe(false)
    expect(instance.messages.some(message => message.status === 'failed')).toBe(true)
  })
  it('reads quote status by exact observed table headers without inferring registration success', async () => {
    document.body.innerHTML = '<table><thead><tr><th>견적서 명</th><th>견적서 등록일</th><th>검증 상태</th><th>검증 결과</th><th>견적서 ID</th></tr></thead><tbody><tr><td>content-job.xlsx</td><td>2026.11.23</td><td>검증 완료</td><td>성공</td><td>Q123</td></tr></tbody></table>'
    const instance = content('/qvt/registration')
    expect(await instance.send('CHECK_QUOTE')).toEqual({ ok: true })
    expect(instance.messages).toEqual([expect.objectContaining({ type: 'OBSERVATION', kind: 'quote', rows: [{ workbookName: 'content-job.xlsx', status: '검증 완료', result: '성공', quoteId: 'Q123', quoteAttributes: [] }] })])
    expect(instance.messages.some(message => message.status === 'succeeded')).toBe(false)
  })
  it('recognizes known tooltip headers but leaves a truncated quote identity unresolved', async () => {
    document.body.innerHTML = '<table><thead><tr><th>견적서 명</th><th>견적서 등록일</th><th>검증 상태</th><th>검증 결과</th><th>견적서 ID <span>?</span></th></tr></thead><tbody><tr><td>content-job.xlsx</td><td>2026.11.23</td><td>검증 완료</td><td>성공</td><td>766f7621... ( 2897425 )</td></tr></tbody></table>'
    const instance = content('/qvt/registration')
    expect(await instance.send('CHECK_QUOTE')).toEqual({ ok: true })
    expect(instance.messages[0]).toMatchObject({ kind: 'quote', rows: [{ quoteId: '766f7621... ( 2897425 )', quoteAttributes: [] }] })
  })
  it('reports login on the supplier auth page without uploading anything', async () => {
    document.body.innerHTML = '<input type="password"><button>로그인</button>'
    const instance = content('/login')
    expect(await instance.send('PREPARE')).toEqual({ ok: true })
    expect(instance.messages).toEqual([expect.objectContaining({ type: 'STATE', status: 'login_required' })])
  })
})

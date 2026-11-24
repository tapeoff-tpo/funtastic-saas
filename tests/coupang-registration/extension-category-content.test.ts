import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const directory = path.resolve('tools/browser-extensions/funtastic-coupang-registration')
const channel = 'funtastic-coupang-registration'
const leaf = (categoryId: number, name = '행거') => ({ categoryId, name, categoryFullPath: '생활용품 > ' + name, isLeaf: true, valid: true, risky: false })
type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => void
function content(fetcher = vi.fn(), pathname = '/qvt/registration') {
  let listener: Listener = () => {}
  const chrome = { runtime: { sendMessage: vi.fn(), onMessage: { addListener: (value: Listener) => { listener = value } } } }
  const sandbox = { chrome, URL, document, location: { origin: 'https://supplier.coupang.com', pathname }, fetch: fetcher, setTimeout, clearTimeout, AbortController, Uint8Array, TypeError, btoa }
  vm.runInNewContext(readFileSync(path.join(directory, 'shared.js'), 'utf8'), sandbox)
  vm.runInNewContext(readFileSync(path.join(directory, 'supplier-content.js'), 'utf8'), sandbox)
  return { chrome, send: (message: object) => new Promise<unknown>(resolve => listener({ channel, ...message }, {}, resolve)) }
}
function response(body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }, status = 200) {
  return { ok: status >= 200 && status < 300, status, redirected: false, headers: { get: (name: string) => headers[name] ?? null }, json: async () => body }
}
function fileResponse(bytes: Uint8Array, disposition = "attachment; filename*=UTF-8''%EC%98%B7%EA%B1%B8%EC%9D%B4.zip") {
  return { ...response(null, { 'content-type': 'application/zip', 'content-disposition': disposition }), arrayBuffer: async () => bytes.buffer }
}
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

describe('Authenticated Supplier Hub category source', () => {
  it('fetches fixed official endpoints concurrently and deduplicates safe leaves in query order', async () => {
    let first: (value: unknown) => void = () => {}
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
      .mockResolvedValueOnce(response([leaf(20, '옷걸이'), leaf(10), leaf(99, '위험')]))
    const instance = content(fetcher)
    const result = instance.send({ type: 'CATEGORY_SEARCH', queries: [' 행거 ', '옷걸이'], url: 'https://evil.test' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    first(response([leaf(10), { ...leaf(11), isLeaf: false }, { ...leaf(12), valid: false }, { ...leaf(13), risky: true }, { ...leaf(14), categoryFullPath: '' }]))
    expect(await result).toEqual({ ok: true, categories: [
      { id: '10', name: '행거', path: '생활용품 > 행거', matchedQueries: ['행거', '옷걸이'] },
      { id: '20', name: '옷걸이', path: '생활용품 > 옷걸이', matchedQueries: ['옷걸이'] },
      { id: '99', name: '위험', path: '생활용품 > 위험', matchedQueries: ['옷걸이'] },
    ] })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/qvt/kan-categories/search?keyword=%ED%96%89%EA%B1%B0', '/qvt/kan-categories/search?keyword=%EC%98%B7%EA%B1%B8%EC%9D%B4'])
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', redirect: 'manual', signal: expect.any(AbortSignal) })
    expect(instance.chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })
  it('caps broad matches fairly while retaining precise supplementary matches and complete query evidence', async () => {
    const empty = content(vi.fn().mockResolvedValue(response([])))
    expect(await empty.send({ type: 'CATEGORY_SEARCH', queries: ['없는 분류'] })).toEqual({ ok: true, categories: [] })
    const fetcher = vi.fn().mockResolvedValueOnce(response(Array.from({ length: 60 }, (_, index) => leaf(index + 1)))).mockResolvedValueOnce(response([leaf(1), leaf(100, '바지걸이')]))
    const result = await content(fetcher).send({ type: 'CATEGORY_SEARCH', queries: ['행거', '옷걸이'] }) as { categories: Array<{ id: string; matchedQueries: string[] }> }
    expect(result.categories).toHaveLength(50)
    expect(result.categories[0]).toMatchObject({ id: '1', matchedQueries: ['행거', '옷걸이'] })
    expect(result.categories[1]).toMatchObject({ id: '100', name: '바지걸이', matchedQueries: ['옷걸이'] })
    expect(new Set(result.categories.map(item => item.id)).size).toBe(50)
  })
  it('refuses login pages, HTML and authorization failures without registration side effects', async () => {
    const fetcher = vi.fn()
    document.body.innerHTML = '<input type="password">'
    expect(await content(fetcher, '/qvt/sso/login').send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })).toMatchObject({ ok: false, error: expect.stringContaining('로그인') })
    expect(fetcher).not.toHaveBeenCalled()
    document.body.replaceChildren()
    for (const denied of [response(null, {}, 401), response(null, {}, 403), response(null, { 'content-type': 'text/html' })]) {
      expect(await content(vi.fn().mockResolvedValue(denied)).send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })).toMatchObject({ ok: false, error: expect.stringContaining('로그인') })
    }
    expect(document.body.children).toHaveLength(0)
  })
  it('stops category search and template redirects before reading headers or consuming bodies', async () => {
    for (const command of [{ type: 'CATEGORY_SEARCH', queries: ['선반'] }, { type: 'CATEGORY_TEMPLATE', categoryId: 1899 }]) {
      const headers = { get: vi.fn() }
      const json = vi.fn()
      const arrayBuffer = vi.fn()
      const fetcher = vi.fn().mockResolvedValue({ type: 'opaqueredirect', status: 0, ok: false, headers, json, arrayBuffer })
      const instance = content(fetcher)
      expect(await instance.send(command)).toEqual({ ok: false, error: '서플라이어허브 대량등록 화면에서 인증 상태를 확인한 뒤 다시 검색해주세요.' })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', redirect: 'manual' })
      expect(headers.get).not.toHaveBeenCalled()
      expect(json).not.toHaveBeenCalled()
      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(instance.chrome.runtime.sendMessage).not.toHaveBeenCalled()
    }
    expect(document.body.children).toHaveLength(0)
  })
  it('keeps network failures distinct from redirects requiring Hub authentication checks', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await content(fetcher).send({ type: 'CATEGORY_SEARCH', queries: ['선반'] })).toEqual({ ok: false, error: '서플라이어허브에 연결하지 못했습니다. 네트워크와 허브 화면을 확인한 뒤 다시 시도해주세요.' })
  })
  it('validates command input, fails on changed response contracts and aborts stalled requests', async () => {
    const fetcher = vi.fn()
    const instance = content(fetcher)
    expect(await instance.send({ type: 'CATEGORY_SEARCH', queries: Array(7).fill('행거') })).toMatchObject({ ok: false })
    expect(await instance.send({ type: 'CATEGORY_TEMPLATE', categoryId: '1899&host=evil.test' })).toMatchObject({ ok: false })
    expect(fetcher).not.toHaveBeenCalled()
    expect(await content(vi.fn().mockResolvedValue(response({ items: [leaf(1)] }))).send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })).toMatchObject({ ok: false, error: expect.stringContaining('응답 형식') })
    vi.useFakeTimers()
    const hanging = content(vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))))
    const pending = hanging.send({ type: 'CATEGORY_SEARCH', queries: ['행거'] })
    await vi.advanceTimersByTimeAsync(15001)
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('시간이 초과') })
  })
  it('downloads the fixed category ZIP as base64 and sanitizes the returned filename', async () => {
    const bytes = Uint8Array.from([80, 75, 3, 4, 5, 6])
    const fetcher = vi.fn().mockResolvedValue(fileResponse(bytes))
    expect(await content(fetcher).send({ type: 'CATEGORY_TEMPLATE', categoryId: 1899, url: 'https://evil.test' })).toEqual({ ok: true, file: { name: '옷걸이.zip', data: Buffer.from(bytes).toString('base64') } })
    expect(fetcher).toHaveBeenCalledWith('/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=1899&locale=ko', expect.objectContaining({ credentials: 'include', redirect: 'manual' }))
    expect(await content(vi.fn().mockResolvedValue(fileResponse(bytes, 'attachment; filename="../../evil.exe"'))).send({ type: 'CATEGORY_TEMPLATE', categoryId: '1899' })).toMatchObject({ file: { name: '쿠팡_카테고리_1899.zip' } })
    expect(await content(vi.fn().mockResolvedValue(fileResponse(Uint8Array.from([1, 2, 3, 4])))).send({ type: 'CATEGORY_TEMPLATE', categoryId: '1899' })).toMatchObject({ ok: false, error: expect.stringContaining('파일을 확인하지 못') })
  })
  it('rejects oversized files both before reading and while streaming bytes', async () => {
    const arrayBuffer = vi.fn()
    const declared = { ...response(null, { 'content-type': 'application/zip', 'content-length': '3000001' }), arrayBuffer }
    expect(await content(vi.fn().mockResolvedValue(declared)).send({ type: 'CATEGORY_TEMPLATE', categoryId: 1899 })).toMatchObject({ ok: false, error: expect.stringContaining('3MB') })
    expect(arrayBuffer).not.toHaveBeenCalled()
    const reader = { read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(3000001) }), cancel: vi.fn(), releaseLock: vi.fn() }
    const streamed = { ...response(null, { 'content-type': 'application/zip' }), body: { getReader: () => reader } }
    expect(await content(vi.fn().mockResolvedValue(streamed)).send({ type: 'CATEGORY_TEMPLATE', categoryId: 1899 })).toMatchObject({ ok: false, error: expect.stringContaining('3MB') })
    expect(reader.cancel).toHaveBeenCalledOnce()
    expect(reader.releaseLock).toHaveBeenCalledOnce()
  })
})

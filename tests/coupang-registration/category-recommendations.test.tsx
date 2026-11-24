import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoryRecommendations } from '@/app/(auth)/operations/coupang-registration/category-recommendations'
import type { CategoryContext } from '@/lib/coupang-registration/category-context'

const bridge = vi.hoisted(() => ({ ping: vi.fn(), search: vi.fn(), template: vi.fn() }))
vi.mock('@/lib/coupang-registration/supplier-bridge', () => ({
  pingSupplierExtension: bridge.ping,
  searchSupplierCategories: bridge.search,
  getSupplierCategoryTemplate: bridge.template,
}))

const context: CategoryContext = {
  sourceCode: '938', productName: '바뜨 옷장 레일행거', categoryName: '행거',
  categoryPath: '가구/인테리어 > 수납가구 > 행거', keywords: ['바지걸이행거', '슬라이딩옷걸이'],
  queries: ['행거', '바뜨 옷장 레일행거', '바지걸이행거', '슬라이딩옷걸이'],
}
const category = { id: '1234', name: '치마/바지걸이', path: '생활용품 > 옷걸이 > 치마/바지걸이', matchedQueries: ['바지걸이행거'] }
const file = { name: '공식견적서.zip', data: 'UEs=' }
const template = { id: 'official-hash', name: '공식견적서.xlsx', file: { name: '공식견적서.xlsx', data: 'UEs=' }, sheets: [{ name: 'QF_1234_치마_바지걸이', columns: [] }] }
const json = (body: unknown, ok = true) => ({ ok, json: async () => body })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.ping.mockResolvedValue({ connected: true, supportsCategories: true })
  bridge.search.mockResolvedValue([category])
  bridge.template.mockResolvedValue(file)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/category-context?') ? { context } : { template })))
})

describe('B2B category based Supplier Hub recommendations', () => {
  it('loads official candidates into the category dropdown immediately from the actual source category', async () => {
    render(<CategoryRecommendations sourceCode="938" onConnect={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: '쿠팡 카테고리 양식' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: category.path })).toHaveValue(category.id)
    expect(fetch).toHaveBeenCalledWith('/api/operations/coupang-registration/category-context?code=938')
    expect(bridge.search).toHaveBeenCalledExactlyOnceWith(context.queries)
    expect(screen.getByText(context.categoryPath)).toBeInTheDocument()
    expect(within(screen.getByRole('combobox', { name: '쿠팡 카테고리 양식' })).getAllByRole('option')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '이 분류 양식 연결' })).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/templates'))).toBe(false)
  })

  it('keeps the source category first when the user adds a more precise product type', async () => {
    render(<CategoryRecommendations sourceCode="938" onConnect={vi.fn()} />)
    await screen.findByRole('option', { name: category.path })
    fireEvent.change(screen.getByLabelText('쿠팡 카테고리 보완 검색어'), { target: { value: '바지걸이' } })
    fireEvent.click(screen.getByRole('button', { name: '쿠팡 후보 다시 검색' }))
    await waitFor(() => expect(bridge.search).toHaveBeenCalledTimes(2))
    expect(bridge.search).toHaveBeenLastCalledWith(['행거', '바지걸이', '바뜨 옷장 레일행거', '바지걸이행거', '슬라이딩옷걸이'])
  })

  it('connects the selected official template only after the server has parsed and verified it', async () => {
    const parsed = deferred<ReturnType<typeof json>>()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/category-context?') ? json({ context }) : parsed.promise))
    const onConnect = vi.fn()
    render(<CategoryRecommendations sourceCode="938" onConnect={onConnect} />)
    await screen.findByRole('option', { name: category.path })
    fireEvent.change(screen.getByRole('combobox', { name: '쿠팡 카테고리 양식' }), { target: { value: category.id } })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/operations/coupang-registration/category-template', expect.objectContaining({ method: 'POST', body: JSON.stringify({ categoryId: category.id, file }) })))
    expect(bridge.template).toHaveBeenCalledExactlyOnceWith(category.id)
    expect(onConnect).not.toHaveBeenCalled()
    await act(async () => { parsed.resolve(json({ template })) })
    expect(onConnect).toHaveBeenCalledExactlyOnceWith(template, category.id)
  })

  it('does not connect a file rejected by server validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/category-context?') ? json({ context }) : json({ error: '선택한 분류와 양식이 다릅니다.' }, false)))
    const onConnect = vi.fn()
    render(<CategoryRecommendations sourceCode="938" onConnect={onConnect} />)
    await screen.findByRole('option', { name: category.path })
    fireEvent.change(screen.getByRole('combobox', { name: '쿠팡 카테고리 양식' }), { target: { value: category.id } })
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 분류와 양식이 다릅니다.')
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('ignores a previous product search that completes after a different product has loaded', async () => {
    const firstSearch = deferred<typeof category[]>()
    bridge.search.mockReturnValueOnce(firstSearch.promise).mockResolvedValueOnce([{ ...category, id: '5678', path: '주방용품 > 수저' }])
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json({ context: String(url).includes('code=938') ? context : { ...context, sourceCode: '1000', categoryName: '수저', categoryPath: '주방용품 > 수저', queries: ['수저'] } })))
    const view = render(<CategoryRecommendations sourceCode="938" onConnect={vi.fn()} />)
    await waitFor(() => expect(bridge.search).toHaveBeenCalledTimes(1))
    view.rerender(<CategoryRecommendations sourceCode="1000" onConnect={vi.fn()} />)
    expect(await screen.findByRole('option', { name: '주방용품 > 수저' })).toHaveValue('5678')
    await act(async () => { firstSearch.resolve([category]) })
    expect(screen.queryByRole('option', { name: category.path })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '주방용품 > 수저' })).toBeInTheDocument()
  })

  it('does not apply an official file after the editor unmounts', async () => {
    const pendingFile = deferred<typeof file>()
    bridge.template.mockReturnValue(pendingFile.promise)
    const onConnect = vi.fn()
    const view = render(<CategoryRecommendations sourceCode="938" onConnect={onConnect} />)
    await screen.findByRole('option', { name: category.path })
    fireEvent.change(screen.getByRole('combobox', { name: '쿠팡 카테고리 양식' }), { target: { value: category.id } })
    view.unmount()
    await act(async () => { pendingFile.resolve(file) })
    expect(onConnect).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/category-template'))).toBe(false)
  })

  it('clears the previous product candidates when the new source lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('code=938') ? json({ context }) : json({ error: '새 상품 분류 조회 실패' }, false)))
    const onConnect = vi.fn()
    const view = render(<CategoryRecommendations sourceCode="938" onConnect={onConnect} />)
    await screen.findByRole('option', { name: category.path })
    view.rerender(<CategoryRecommendations sourceCode="1000" onConnect={onConnect} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('새 상품 분류 조회 실패')
    expect(screen.queryByRole('option', { name: category.path })).not.toBeInTheDocument()
    expect(screen.queryByText(context.categoryPath)).not.toBeInTheDocument()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('requires the category-capable extension instead of substituting saved workbook categories', async () => {
    bridge.ping.mockResolvedValue({ connected: true, version: '1.0.0' })
    render(<CategoryRecommendations sourceCode="938" onConnect={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('설치된 쿠팡 등록 확장 1.0.0에는 카테고리 검색 기능이 없습니다.')
    expect(screen.getByRole('link', { name: '쿠팡 등록 확장 업데이트' })).toHaveAttribute('href', '/api/operations/coupang-registration/extension')
    expect(bridge.search).not.toHaveBeenCalled()
    expect(screen.queryByRole('option', { name: category.path })).not.toBeInTheDocument()
  })

  it('shows an empty result without inventing a category', async () => {
    bridge.search.mockResolvedValue([])
    render(<CategoryRecommendations sourceCode="938" onConnect={vi.fn()} />)
    expect(await screen.findByText('허브에서 일치하는 분류를 찾지 못했습니다. 보완 검색어를 바꿔 다시 검색해주세요.')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: category.path })).not.toBeInTheDocument()
  })

  it('keeps the saved selection in the category field when the extension cannot search', async () => {
    bridge.ping.mockResolvedValue({ connected: false })
    render(<CategoryRecommendations sourceCode="938" selectedSheetName="QF_1234_생활용품_옷걸이_치마-바지걸이" onConnect={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('쿠팡 등록 확장과 이 페이지가 연결되지 않았습니다.')
    const select = screen.getByRole('combobox', { name: '쿠팡 카테고리 양식' })
    expect(select).toHaveValue('1234')
    expect(within(select).getByRole('option', { name: '생활용품 > 옷걸이 > 치마-바지걸이' })).toBeInTheDocument()
    expect(bridge.search).not.toHaveBeenCalled()
    expect(bridge.template).not.toHaveBeenCalled()
  })
})

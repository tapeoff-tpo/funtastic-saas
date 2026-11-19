import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortMeetingTabs } from './short-meeting-tabs'

const version = '2026-11-12 03:00:00+00'
const rows = [
  { rowNumber: 2, cells: ['조명', '10', '0001'], excludedReason: null },
  { rowNumber: 3, cells: ['텀블러', '2', '0002'], excludedReason: '상품코드 없음' },
  { rowNumber: 4, cells: ['의자', '', '0099'], excludedReason: null },
]
const props = { rows: [], sheetStatus: 'available' as const, rawAvailable: true, uploadFileName: '주문서.xlsx', uploadVersion: version, meetingDate: '2026-11-12' }

function response(data: Record<string, unknown>) {
  return { ok: true, json: async () => ({ rawAvailable: true, headers: ['상품명', '실 출고수량', '주문번호'], rows, totalRows: 3, filteredRows: 3, page: 1, pageSize: 100, totalPages: 1, appliedAt: version, ...data }) }
}

afterEach(() => vi.unstubAllGlobals())

describe('ShortMeetingTabs', () => {
  it('loads source rows only after opening the tab, including excluded rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}))
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingTabs {...props} />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: '상품별 현황' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '주문서 원본' }))
    expect(await screen.findByText('0001')).toBeInTheDocument()
    expect(screen.getByText('집계 제외')).toHaveAttribute('title', '상품코드 없음')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/analytics/short-meeting/original')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ date: '2026-11-12' })
    fireEvent.keyDown(screen.getByRole('tab', { name: '주문서 원본' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: '상품별 현황' })).toHaveAttribute('aria-selected', 'true')
  })

  it('requests ascending and descending column and row sorting', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const query = JSON.parse(String(options.body))
      if (query.sort === 1 && query.direction === 'ascending') return response({ rows: [rows[1], rows[0], rows[2]] })
      if (query.sort === 1 && query.direction === 'descending') return response({ rows: [rows[0], rows[1], rows[2]] })
      if (query.sort === 'row' && query.direction === 'descending') return response({ rows: [...rows].reverse() })
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingTabs {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '주문서 원본' }))
    await screen.findByText('0001')
    const order = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent)
    fireEvent.click(screen.getByRole('button', { name: '실 출고수량' }))
    await waitFor(() => expect(order()).toEqual(['텀블러', '조명', '의자']))
    expect(screen.getByRole('button', { name: '실 출고수량' }).closest('th')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: '실 출고수량' }))
    await waitFor(() => expect(order()).toEqual(['조명', '텀블러', '의자']))
    expect(screen.getByRole('button', { name: '실 출고수량' }).closest('th')).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: '행' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '행' }).closest('th')).toHaveAttribute('aria-sort', 'ascending'))
    fireEvent.click(screen.getByRole('button', { name: '행' }))
    await waitFor(() => expect(order()).toEqual(['의자', '텀블러', '조명']))
  })

  it('searches and requests pages from the server', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const query = JSON.parse(String(options.body))
      if (query.search === '0099') return response({ rows: [rows[2]], filteredRows: 1 })
      return response({ totalRows: 101, filteredRows: 101, totalPages: 2, page: query.page, rows: query.page === 2 ? [rows[1]] : [rows[0]] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingTabs {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '주문서 원본' }))
    await screen.findByText('0001')
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('0002')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '원본 검색' }), { target: { value: '0099' } })
    expect(await screen.findByText('0099')).toBeInTheDocument()
    const query = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
    expect(query.search).toBe('0099')
    expect(query.page).toBe(1)
  })

  it('ignores a stale response after a newer search', async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      const query = JSON.parse(String(options.body))
      if (!query.search) return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve(response({ rows: [rows[2]], filteredRows: 1 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingTabs {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '주문서 원본' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('textbox', { name: '원본 검색' }), { target: { value: '0099' } })
    expect(await screen.findByText('0099')).toBeInTheDocument()
    resolveOld(response({ rows: [rows[0]] }))
    await waitFor(() => expect(screen.queryByText('0001')).not.toBeInTheDocument())
  })

  it('distinguishes an old upload from an empty date without requesting data', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<ShortMeetingTabs {...props} rawAvailable={false} />)
    fireEvent.click(screen.getByRole('tab', { name: '주문서 원본' }))
    expect(screen.getByText(/원본 행이 저장되어 있지 않습니다/)).toBeInTheDocument()
    rerender(<ShortMeetingTabs {...props} rawAvailable={false} uploadFileName={null} />)
    expect(screen.getByText(/이 기준일에 반영된 주문서가 없습니다/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows retry after an error and blocks a different applied snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: '잠시 후 다시 시도해 주세요.' }) }).mockResolvedValueOnce(response({ appliedAt: '2026-11-12 04:00:00+00' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ShortMeetingTabs {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '주문서 원본' }))
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText(/주문서가 새로 반영되어/)).toBeInTheDocument()
    expect(screen.queryByText('0001')).not.toBeInTheDocument()
  })
})

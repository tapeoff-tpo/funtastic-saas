import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CostsEditableTable } from './costs-editable-table'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
const fetchMock = vi.fn()
const headers = ['품목코드', '품목명', '중국어 상품명', '규격정보', '한국창고기준 위치']
const row = { id: 'item-a', data: { '품목코드': 'SKU-A', '품목명': '옷걸이', '중국어 상품명': '多孔衣架', '규격정보': '블랙', '한국창고기준 위치': 'A-01' }, updatedAt: '2026-10-30T00:00:00Z' }

describe('Chinese name editing in the item master', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: row.id }) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the current name and saves changes in the existing item editor', async () => {
    render(<CostsEditableTable headers={headers} rows={[row]} />)
    expect(screen.getByText('多孔衣架')).toHaveAttribute('data-no-translate')
    fireEvent.click(screen.getByText('옷걸이'))
    const field = screen.getByRole('textbox', { name: '중국어 상품명' })
    expect(field).toHaveValue('多孔衣架')
    fireEvent.change(field, { target: { value: '新衣架' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/purchasing/items/item-a')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data).toMatchObject({ '중국어 상품명': '新衣架', '품목코드': 'SKU-A', '한국창고기준 위치': 'A-01' })
  })

  it('lets an operator explicitly clear the Chinese name and save the blank value', async () => {
    render(<CostsEditableTable headers={headers} rows={[row]} />)
    fireEvent.click(screen.getByText('옷걸이'))
    fireEvent.click(screen.getByRole('button', { name: '중국어명 삭제' }))
    expect(screen.getByRole('textbox', { name: '중국어 상품명' })).toHaveValue('')
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data['중국어 상품명']).toBe('')
  })
})

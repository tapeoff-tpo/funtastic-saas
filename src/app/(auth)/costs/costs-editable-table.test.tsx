import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('keeps changes and untouched values when their groups are collapsed before saving', async () => {
    const groupedHeaders = [...headers, '무게', 'HS CODE', '신규원가(元)', '구매 URL', '매입부가세', '추가 관리항목']
    const groupedRow = { ...row, data: { ...row.data, '무게': '100g', 'HS CODE': '3926', '신규원가(元)': '12',
      '구매 URL': 'https://detail.1688.com/offer/123.html', '매입부가세': '10%', '추가 관리항목': '기존 값' } }
    render(<CostsEditableTable headers={groupedHeaders} rows={[groupedRow]} />)
    fireEvent.click(screen.getByText('옷걸이'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '기본정보' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByRole('button', { name: '원가·구매' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).queryByRole('textbox', { name: '무게' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '상품규격·구성' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: '무게' }), { target: { value: '120g' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '상품규격·구성' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '상품규격·구성' }))
    expect(within(dialog).getByRole('textbox', { name: '무게' })).toHaveValue('120g')
    fireEvent.click(within(dialog).getByRole('button', { name: '전체 접기' }))
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data).toEqual({ ...groupedRow.data, '무게': '120g' })
  })

  it('shows unclassified fields, expands all groups, and resets the editor independently of table groups', () => {
    const groupedHeaders = [...headers, '무게', 'HS CODE', '신규원가(元)', '매입부가세', '추가 관리항목']
    render(<CostsEditableTable headers={groupedHeaders} rows={[row]} />)
    fireEvent.click(screen.getByText('옷걸이'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: '품목코드' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '기타 정보' }))
    expect(within(dialog).getByRole('textbox', { name: '추가 관리항목' })).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: '전체 펼치기' }))
    for (const name of ['기본정보', '원가·구매', '상품규격·구성', '통관·인증', '창고·메모', '세금·판매추가금', '기타 정보']) {
      expect(within(dialog).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
    }
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    fireEvent.click(screen.getByText('옷걸이'))
    expect(screen.getByRole('button', { name: '상품규격·구성' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '기본정보' })).toHaveAttribute('aria-expanded', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

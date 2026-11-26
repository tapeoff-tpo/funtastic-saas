import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Dialog } from '@base-ui/react/dialog'
import { CategoryTemplatePicker } from '@/app/(auth)/operations/coupang-registration/category-template-picker'

const templates = Array.from({ length: 45 }, (_, index) => ({
  id: `file-${index + 1}`,
  name: index === 44 ? '최신 가구 견적서.xlsx' : `카테고리원본-${index + 1}.xlsx`,
  sheets: [{ name: `QF_${index + 1}_${index === 44 ? '가구_수납가구_선반' : `생활용품_카테고리${index + 1}`}` }],
}))
const firstChoice = `${templates[0].id}:${templates[0].sheets[0].name}`
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: '업로드한 카테고리 양식' }))
const picker = () => screen.getByRole('dialog', { name: '카테고리 엑셀 양식 선택' })
const choiceButtons = () => within(screen.getByRole('list', { name: '카테고리 양식 목록' })).getAllByRole('button')
function Fixture({ onChange = vi.fn(), initialValue = '' }: { onChange?: (value: string) => void; initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  return <CategoryTemplatePicker label="업로드한 카테고리 양식" value={value} templates={templates} onChange={next => { setValue(next); onChange(next) }} />
}

describe('searchable original category template picker', () => {
  it('shows twenty original sheets per page with complete category and file names', async () => {
    render(<Fixture />)
    openPicker()
    expect(choiceButtons()).toHaveLength(20)
    expect(within(picker()).getByText('검색결과 45개')).toBeInTheDocument()
    expect(within(picker()).getByLabelText('현재 페이지')).toHaveTextContent('1 / 3 페이지')
    expect(within(picker()).getByRole('button', { name: '이전 페이지' })).toBeDisabled()
    fireEvent.click(within(picker()).getByRole('button', { name: '다음 페이지' }))
    expect(choiceButtons()).toHaveLength(20)
    expect(choiceButtons()[0]).toHaveAccessibleName('QF_21_생활용품_카테고리21 · 카테고리원본-21.xlsx 선택')
    fireEvent.click(within(picker()).getByRole('button', { name: '다음 페이지' }))
    expect(choiceButtons()).toHaveLength(5)
    expect(within(picker()).getByRole('button', { name: '다음 페이지' })).toBeDisabled()
    expect(within(picker()).getByText('가구_수납가구_선반')).toBeInTheDocument()
    expect(within(picker()).getByText('최신 가구 견적서.xlsx')).toBeInTheDocument()
    await waitFor(() => expect(within(picker()).getByLabelText('카테고리 양식 검색')).toHaveFocus())
  })

  it('searches all pages by category, original filename and sheet identifier and resets the page', () => {
    render(<Fixture />)
    openPicker()
    fireEvent.click(within(picker()).getByRole('button', { name: '다음 페이지' }))
    const search = within(picker()).getByLabelText('카테고리 양식 검색')
    for (const term of [' 가구 수납가구 선반 ', '최신 가구 견적서', 'qf_45']) {
      fireEvent.change(search, { target: { value: term } })
      expect(choiceButtons()).toHaveLength(1)
      expect(choiceButtons()[0]).toHaveAccessibleName('QF_45_가구_수납가구_선반 · 최신 가구 견적서.xlsx 선택')
      expect(within(picker()).getByLabelText('현재 페이지')).toHaveTextContent('1 / 1 페이지')
    }
    fireEvent.change(search, { target: { value: '없는 양식' } })
    expect(within(picker()).getByText('검색 조건에 맞는 양식이 없습니다.')).toBeInTheDocument()
    expect(within(picker()).getByText('검색결과 0개')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: '' } })
    expect(choiceButtons()).toHaveLength(20)
    expect(within(picker()).getByLabelText('현재 페이지')).toHaveTextContent('1 / 3 페이지')
  })

  it('selects the exact file and sheet, closes, restores trigger focus and marks the current selection', async () => {
    const onChange = vi.fn()
    render(<Fixture onChange={onChange} />)
    openPicker()
    fireEvent.change(within(picker()).getByLabelText('카테고리 양식 검색'), { target: { value: 'qf_45' } })
    fireEvent.click(choiceButtons()[0])
    expect(onChange).toHaveBeenCalledWith('file-45:QF_45_가구_수납가구_선반')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const trigger = screen.getByRole('button', { name: '업로드한 카테고리 양식' })
    expect(trigger).toHaveTextContent('가구_수납가구_선반')
    expect(trigger).toHaveAttribute('title', '가구_수납가구_선반 · 최신 가구 견적서.xlsx')
    await waitFor(() => expect(trigger).toHaveFocus())
    openPicker()
    expect(within(picker()).getByLabelText('카테고리 양식 검색')).toHaveValue('')
    expect(choiceButtons()).toHaveLength(20)
    fireEvent.change(within(picker()).getByLabelText('카테고리 양식 검색'), { target: { value: 'qf_45' } })
    expect(choiceButtons()[0]).toHaveAttribute('aria-pressed', 'true')
    expect(choiceButtons()[0]).toHaveTextContent('선택됨')
  })

  it('keeps existing selection on close and resets the search and page when reopening', async () => {
    const onChange = vi.fn()
    render(<Fixture onChange={onChange} initialValue={firstChoice} />)
    openPicker()
    fireEvent.click(within(picker()).getByRole('button', { name: '다음 페이지' }))
    fireEvent.change(within(picker()).getByLabelText('카테고리 양식 검색'), { target: { value: '없는 값' } })
    fireEvent.click(within(picker()).getByRole('button', { name: '양식 선택 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    openPicker()
    expect(within(picker()).getByLabelText('카테고리 양식 검색')).toHaveValue('')
    expect(within(picker()).getByLabelText('현재 페이지')).toHaveTextContent('1 / 3 페이지')
    expect(choiceButtons()[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears an existing choice without choosing another original file', async () => {
    const onChange = vi.fn()
    render(<Fixture onChange={onChange} initialValue={firstChoice} />)
    openPicker()
    fireEvent.click(within(picker()).getByRole('button', { name: '양식 선택 해제' }))
    expect(onChange).toHaveBeenCalledWith('')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '업로드한 카테고리 양식' })).toHaveTextContent('업로드한 양식 선택')
  })

  it('shows an empty upload state without inventing choices', () => {
    render(<CategoryTemplatePicker label="업로드한 카테고리 양식" value="" templates={[]} onChange={vi.fn()} />)
    openPicker()
    expect(within(picker()).getByText('카테고리 엑셀을 업로드해주세요.')).toBeInTheDocument()
    expect(within(picker()).getByRole('button', { name: '양식 선택 해제' })).toBeDisabled()
    expect(within(picker()).getByRole('button', { name: '다음 페이지' })).toBeDisabled()
  })

  it('closes only the nested picker with Escape and returns focus within the enlarged workbench', async () => {
    const onChange = vi.fn()
    render(<Dialog.Root defaultOpen><Dialog.Portal><Dialog.Popup><Dialog.Title>쿠팡상품등록 크게 보기</Dialog.Title><Dialog.Description className="sr-only">확대 작업 화면</Dialog.Description><Fixture onChange={onChange} /></Dialog.Popup></Dialog.Portal></Dialog.Root>)
    const outer = await screen.findByRole('dialog', { name: '쿠팡상품등록 크게 보기' })
    const trigger = within(outer).getByRole('button', { name: '업로드한 카테고리 양식' })
    fireEvent.click(trigger)
    const search = within(picker()).getByLabelText('카테고리 양식 검색')
    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '카테고리 엑셀 양식 선택' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: '쿠팡상품등록 크게 보기' })).toBe(outer)
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps same-named categories from different original files independently selectable', () => {
    const onChange = vi.fn()
    render(<CategoryTemplatePicker label="업로드한 카테고리 양식" value="" templates={[
      { id: 'older', name: '이전원본.xlsx', sheets: [{ name: 'QF_2379_가구_선반' }] },
      { id: 'latest', name: '최신원본.xlsx', sheets: [{ name: 'QF_2379_가구_선반' }] },
    ]} onChange={onChange} />)
    openPicker()
    expect(choiceButtons()).toHaveLength(2)
    fireEvent.click(within(picker()).getByRole('button', { name: 'QF_2379_가구_선반 · 최신원본.xlsx 선택' }))
    expect(onChange).toHaveBeenCalledWith('latest:QF_2379_가구_선반')
  })
})

import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  SupplierRegistrationControls,
  type SupplierRegistrationControlsProps,
  type SupplierRegistrationMode,
} from '@/app/(auth)/operations/coupang-registration/supplier-registration-controls'

function Fixture({ onModeChange = vi.fn(), ...props }: Partial<SupplierRegistrationControlsProps>) {
  const [mode, setMode] = useState<SupplierRegistrationMode>('excel')
  return <SupplierRegistrationControls mode={mode} selectedCount={3} onStart={vi.fn()} {...props} onModeChange={value => {
    setMode(value)
    onModeChange(value)
  }} />
}

describe('Supplier Hub registration mode controls', () => {
  it('chooses either Excel or individual registration before starting the selected products', () => {
    const onStart = vi.fn()
    const onModeChange = vi.fn()
    render(<Fixture onStart={onStart} onModeChange={onModeChange} />)
    const mode = screen.getByRole('combobox', { name: '쿠팡 등록 방식' })
    expect(mode).toHaveValue('excel')
    expect(screen.getByLabelText('등록 대상 상품 수')).toHaveTextContent('선택 3개')
    fireEvent.click(screen.getByRole('button', { name: '엑셀 대량등록' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    fireEvent.change(mode, { target: { value: 'individual' } })
    expect(onModeChange).toHaveBeenCalledWith('individual')
    expect(mode).toHaveValue('individual')
    fireEvent.click(screen.getByRole('button', { name: '개별등록 준비' }))
    expect(onStart).toHaveBeenCalledTimes(2)
  })

  it('requires a selection and keeps a disabled start from submitting a surrounding form', () => {
    const onStart = vi.fn()
    const onSubmit = vi.fn(event => event.preventDefault())
    const { rerender } = render(<form onSubmit={onSubmit}><Fixture selectedCount={0} onStart={onStart} /></form>)
    fireEvent.click(screen.getByRole('button', { name: '엑셀 대량등록' }))
    expect(onStart).not.toHaveBeenCalled()
    rerender(<form onSubmit={onSubmit}><Fixture onStart={onStart} /></form>)
    fireEvent.click(screen.getByRole('button', { name: '엑셀 대량등록' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('locks mode and start during a job while leaving the running job actions usable', () => {
    const onStart = vi.fn()
    const onOpen = vi.fn()
    const onStop = vi.fn()
    render(<Fixture busy onStart={onStart} onOpen={onOpen} onStop={onStop} items={[
      { id: 'running-1', name: '그린트리', status: 'running', message: '대표 이미지 입력 중', canOpen: true, canStop: true },
    ]} />)
    expect(screen.getByRole('combobox', { name: '쿠팡 등록 방식' })).toBeDisabled()
    expect(within(screen.getByRole('region', { name: '쿠팡 등록' })).getAllByText('진행 중')).toHaveLength(2)
    const start = screen.getAllByRole('button').find(button => button.textContent === '진행 중')!
    expect(start).toBeDisabled()
    fireEvent.click(start)
    expect(onStart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '그린트리 쿠팡 화면 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '그린트리 포함 작업 전체 중지' }))
    expect(onOpen).toHaveBeenCalledWith('running-1')
    expect(onStop).toHaveBeenCalledWith('running-1')
  })

  it('shows saved preparation and manual review without claiming the product is registered', () => {
    const onCheck = vi.fn()
    render(<Fixture mode="individual" onCheck={onCheck} items={[
      { id: 'prepared-1', name: '그린트리', status: 'prepared', message: '쿠팡에 중간 저장됨', canCheck: true },
      { id: 'review-1', name: '실버트리', status: 'review_required', message: '카테고리 선택 필요' },
      { id: 'login-1', name: '마미백', status: 'login_required' },
    ]} />)
    const list = screen.getByRole('list', { name: '쿠팡 등록 진행' })
    expect(within(list).getByText('입력·저장 완료')).toBeInTheDocument()
    expect(within(list).getByText('확인 필요')).toBeInTheDocument()
    expect(within(list).getByText('로그인 필요')).toBeInTheDocument()
    expect(within(list).queryByText('등록완료')).not.toBeInTheDocument()
    expect(within(list).queryByText('쿠팡 검수완료')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '그린트리 다시 확인' }))
    expect(onCheck).toHaveBeenCalledWith('prepared-1')
    expect(screen.queryByRole('button', { name: '실버트리 다시 확인' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '그린트리 중지' })).not.toBeInTheDocument()
  })

  it('shows only actions that have both an applicable flag and a callback', () => {
    render(<Fixture disabled onOpen={vi.fn()} items={[
      { id: 'failed-1', name: '선반', status: 'failed', canStop: true, canCheck: true, canOpen: false },
    ]} />)
    expect(screen.getByRole('combobox', { name: '쿠팡 등록 방식' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '엑셀 대량등록' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /쿠팡 화면 열기|중지|다시 확인/ })).not.toBeInTheDocument()
  })
})

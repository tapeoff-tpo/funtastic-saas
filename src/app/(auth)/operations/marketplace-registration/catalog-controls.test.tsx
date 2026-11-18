import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('./group-actions', () => ({ ensureManualRegistrationGroup: vi.fn() }))
import { RegistrationFilters } from './catalog-controls'
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

it('applies a missing-marketplace filter and saves it under a named preset', () => {
  render(<RegistrationFilters query="112001" status="all" missingMalls={[]} targets={[{ id: 'coupang', label: '쿠팡' }]} />)
  fireEvent.click(screen.getByText('미등록 몰 선택 ▾'))
  fireEvent.click(screen.getByRole('checkbox', { name: '쿠팡' }))
  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  const url = new URL(mocks.push.mock.calls[0][0], 'https://example.com')
  expect(url.searchParams.get('q')).toBe('112001')
  expect(url.searchParams.get('status')).toBe('missing')
  expect(url.searchParams.get('missingMalls')).toBe('coupang')
  fireEvent.click(screen.getByText('필터 저장'))
  fireEvent.change(screen.getByRole('textbox', { name: '저장할 필터 이름' }), { target: { value: '필터2' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(JSON.parse(localStorage.getItem('registration-filter-presets-v1')!)).toEqual({
    필터2: { status: 'missing', malls: ['coupang'] },
  })
  fireEvent.change(screen.getByRole('combobox', { name: '등록상태' }), { target: { value: 'complete' } })
  fireEvent.click(screen.getByRole('button', { name: '필터2' }))
  expect(screen.getByRole('checkbox', { name: '쿠팡' })).toBeChecked()
})

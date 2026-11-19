import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ push: vi.fn(), ensure: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('./group-actions', () => ({ ensureManualRegistrationGroup: mocks.ensure }))
import { RegistrationFilters, RegistrationProductLink } from './catalog-controls'
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('searches by selected conditions with an explicit all-marketplaces match', () => {
  render(<RegistrationFilters query="112001" status="all" missingMalls={[]} targets={[
    { id: 'coupang', label: '쿠팡' }, { id: 'onchannel', label: '온채널' },
  ]} />)
  expect(screen.queryByText('필터 저장')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('미등록 몰 선택 ▾'))
  fireEvent.click(screen.getByRole('checkbox', { name: '쿠팡' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '온채널' }))
  fireEvent.change(screen.getByRole('combobox', { name: '몰 조건' }), { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  const url = new URL(mocks.push.mock.calls[0][0], 'https://example.com')
  expect(url.searchParams.get('q')).toBe('112001')
  expect(url.searchParams.get('status')).toBe('missing')
  expect(url.searchParams.get('missingMalls')).toBe('coupang,onchannel')
  expect(url.searchParams.get('missingMatch')).toBe('all')
  expect(screen.getByRole('link', { name: '초기화' })).toHaveAttribute('href', '/operations/marketplace-registration')
})

it('reuses a newly linked row and prefers a replacement id returned by the server', async () => {
  mocks.ensure.mockResolvedValue({ rowId: 'linked-row' })
  const props = { rowId: null, sku: '112001', label: '상품', href: '/operations/marketplace-registration', selected: false }
  const { rerender } = render(<RegistrationProductLink {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '상품' }))
  await waitFor(() => expect(screen.getByRole('link', { name: '상품' })).toHaveAttribute('href', expect.stringContaining('row=linked-row')))
  expect(mocks.ensure).toHaveBeenCalledOnce()
  expect(new URL(mocks.push.mock.calls[0][0], 'https://example.com').searchParams.get('group')).toBe('112001')
  rerender(<RegistrationProductLink {...props} rowId="replacement-row" />)
  expect(screen.getByRole('link', { name: '상품' })).toHaveAttribute('href', expect.stringContaining('row=replacement-row'))
})

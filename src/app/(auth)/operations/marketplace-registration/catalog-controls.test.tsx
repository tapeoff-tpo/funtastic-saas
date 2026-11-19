import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ push: vi.fn(), ensure: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('./group-actions', () => ({ ensureManualRegistrationGroup: mocks.ensure }))
import { RegistrationFilters, RegistrationProductLink } from './catalog-controls'
import { RegistrationSelectionProvider, RegistrationSelectionPanel } from './selection-panel'
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


it('shows the chosen product immediately and ignores an earlier slow selection', async () => {
  let finishFirst!: (value: { rowId: string }) => void
  let finishSecond!: (value: { rowId: string }) => void
  mocks.ensure.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
  function Workspace({ currentGroup }: { currentGroup?: string }) {
    return <RegistrationSelectionProvider>
      <RegistrationProductLink rowId={null} sku="112001" label="첫 상품" href="/operations/marketplace-registration" selected={false} optionCount={2} />
      <RegistrationProductLink rowId={null} sku="112002" label="두 번째 상품" href="/operations/marketplace-registration" selected={false} />
      <RegistrationSelectionPanel currentGroup={currentGroup}><p>서버 상세</p></RegistrationSelectionPanel>
    </RegistrationSelectionProvider>
  }
  const { rerender } = render(<Workspace />)
  fireEvent.click(screen.getByRole('button', { name: '첫 상품' }))
  expect(screen.getByRole('heading', { name: '첫 상품' })).toBeVisible()
  expect(screen.getByText('112001 · 옵션 2개')).toBeVisible()
  expect(screen.queryByText('서버 상세')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '두 번째 상품' }))
  expect(screen.getByRole('heading', { name: '두 번째 상품' })).toBeVisible()
  finishSecond({ rowId: 'second-row' })
  await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce())
  finishFirst({ rowId: 'first-row' })
  await waitFor(() => expect(screen.getByRole('button', { name: '첫 상품' })).not.toBeDisabled())
  expect(mocks.push).toHaveBeenCalledOnce()
  expect(mocks.push.mock.calls[0][0]).toContain('row=second-row')
  rerender(<Workspace currentGroup="112002" />)
  expect(screen.getByText('서버 상세')).toBeVisible()
})

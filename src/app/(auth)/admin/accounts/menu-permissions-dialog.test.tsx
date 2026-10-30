import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MenuPermissionsDialog } from './menu-permissions-dialog'

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/admin-accounts/actions', () => ({ saveMenuPermissions: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const account = { id: 'staff-id', email: 'staff@example.test', allowedMenus: null }
describe('menu permission editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockResolvedValue({ success: true })
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
  })
  it('starts existing accounts unrestricted, then saves a chosen menu', async () => {
    render(<MenuPermissionsDialog account={account} onClose={vi.fn()} />)
    const all = screen.getByRole('checkbox', { name: '전체 메뉴 허용 · 앞으로 추가되는 메뉴 포함' })
    expect(all).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '중국출고' })).toBeDisabled()
    fireEvent.click(all)
    fireEvent.click(screen.getByRole('button', { name: '선택 해제' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '중국출고' }))
    fireEvent.click(screen.getByRole('button', { name: '권한 저장' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ targetId: account.id, allowedMenus: ['/purchasing/china-shipments'] }))
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('keeps a failed save open with the selection intact', async () => {
    mocks.save.mockResolvedValue({ success: false, error: '저장 실패' })
    const onClose = vi.fn()
    render(<MenuPermissionsDialog account={{ ...account, allowedMenus: [] }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '권한 저장' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ targetId: account.id, allowedMenus: [] }))
    expect(onClose).not.toHaveBeenCalled()
  })
})

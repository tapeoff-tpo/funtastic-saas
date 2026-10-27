import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChinaShipmentWarehouseDialog } from './china-shipment-warehouse-dialog'
import { ChinaWorkGuardProvider } from './unsaved-china-work'

const {
  createWarehouse,
  renameWarehouse,
  refresh,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  createWarehouse: vi.fn(),
  renameWarehouse: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

vi.mock('../saas-china-actions', () => ({
  createSaasChinaOutboundWarehouseAction: createWarehouse,
  renameSaasChinaOutboundWarehouseAction: renameWarehouse,
}))

const warehouses = [
  { warehouseCode: '중국창고', isDefault: true, hasActiveInventory: true },
  { warehouseCode: '쿠팡', isDefault: false, hasActiveInventory: false },
]

function renderDialog() {
  return render(
    <ChinaWorkGuardProvider>
      <ChinaShipmentWarehouseDialog warehouses={warehouses} />
    </ChinaWorkGuardProvider>,
  )
}

describe('China shipment warehouse dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createWarehouse.mockResolvedValue({ ok: true })
    renameWarehouse.mockResolvedValue({ ok: true })
  })

  it('shows the registered warehouse names and adds a new warehouse', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '창고 수정' }))
    const dialog = screen.getByRole('dialog', { name: '출고 창고 관리' })

    expect(within(dialog).getByText('중국창고')).toBeInTheDocument()
    expect(within(dialog).getByText('기본 창고')).toBeInTheDocument()
    expect(within(dialog).getByText('현재 재고 있음')).toBeInTheDocument()
    expect(within(dialog).getByText('재고 없음')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('새 출고창고명'), { target: { value: '중국 2창고' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }))

    await waitFor(() => expect(createWarehouse).toHaveBeenCalledWith({ warehouseCode: '중국 2창고' }))
    expect(toastSuccess).toHaveBeenCalledWith('출고창고를 추가했습니다.')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('requires confirmation before renaming the current inventory warehouse', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '창고 수정' }))
    const dialog = screen.getByRole('dialog', { name: '출고 창고 관리' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: '이름 수정' })[0]!)
    fireEvent.change(within(dialog).getByLabelText('중국창고 새 창고명'), { target: { value: '중국 1창고' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))

    const confirmation = screen.getByRole('dialog', { name: '창고명 변경' })
    expect(confirmation).toHaveTextContent('이미 만든 출고 기록과 재고 이동 이력은 바꾸지 않습니다.')
    fireEvent.click(within(confirmation).getByRole('button', { name: '창고명 변경' }))

    await waitFor(() => expect(renameWarehouse).toHaveBeenCalledWith({
      warehouseCode: '중국창고',
      nextWarehouseCode: '중국 1창고',
    }))
    expect(toastSuccess).toHaveBeenCalledWith('출고창고명을 변경했습니다.')
    expect(refresh).toHaveBeenCalledOnce()
  })
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasingLanguageSwitcher } from '@/components/purchasing-language-switcher'
import { SaasChinaInventoryBoard, type SaasChinaInventoryViewItem } from './saas-china-inventory-board'

const { refresh, receive } = vi.hoisted(() => ({
  refresh: vi.fn(),
  receive: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('../saas-china-actions', () => ({
  adjustSaasChinaInventoryAction: vi.fn(),
  receiveSaasChinaInventoryAction: receive,
}))

const items: SaasChinaInventoryViewItem[] = [{
  id: 'inventory-1',
  warehouseCode: '중국창고',
  sku: 'SKU-01',
  productName: '상품',
  optionName: null,
  onHandQuantity: 20,
  reservedQuantity: 3,
  availableQuantity: 17,
  lastReceivedAt: null,
  lastOutboundAt: null,
}]

describe('SaasChinaInventoryBoard', () => {
  beforeEach(() => {
    refresh.mockReset()
    receive.mockReset()
    window.localStorage.clear()
    document.documentElement.lang = 'ko'
  })

  afterEach(() => {
    document.documentElement.lang = 'ko'
  })

  it('keeps the current inventory download beside the Excel change control, outside the modal', () => {
    render(<SaasChinaInventoryBoard items={items} summary={{ onHandQuantity: 20, reservedQuantity: 3, availableQuantity: 17 }} />)

    const download = screen.getByRole('link', { name: '현재 목록 다운로드' })
    expect(download).toHaveAttribute('href', '/api/purchasing/saas-china-inventory/excel-export')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: '양식 다운로드' })).toHaveAttribute('href', '/api/purchasing/saas-china-inventory/excel-template')
    expect(within(dialog).queryByRole('link', { name: '현재 목록 다운로드' })).not.toBeInTheDocument()
  })

  it('translates the outside download action in Chinese mode', async () => {
    render(
      <div data-app-translate>
        <PurchasingLanguageSwitcher />
        <SaasChinaInventoryBoard items={items} summary={{ onHandQuantity: 20, reservedQuantity: 3, availableQuantity: 17 }} />
      </div>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '中文' }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '下载当前列表' })).toHaveAttribute('href', '/api/purchasing/saas-china-inventory/excel-export')
    })
  })

  it('uses the managed default warehouse and lets the operator select another registered warehouse for a manual receipt', async () => {
    receive.mockResolvedValue({ ok: true })
    render(
      <SaasChinaInventoryBoard
        items={items}
        summary={{ onHandQuantity: 20, reservedQuantity: 3, availableQuantity: 17 }}
        defaultWarehouseCode="중국 2창고"
        warehouseCodes={['중국 2창고', '쿠팡']}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '재고 추가' }))
    const warehouse = screen.getByLabelText('창고')
    expect(warehouse).toHaveValue('중국 2창고')
    expect(within(warehouse).getByRole('option', { name: '쿠팡' })).toBeInTheDocument()

    fireEvent.change(warehouse, { target: { value: '쿠팡' } })
    fireEvent.change(screen.getByLabelText('품목코드'), { target: { value: 'SKU-NEW' } })
    fireEvent.change(screen.getByLabelText('상품명'), { target: { value: '새 상품' } })
    fireEvent.change(screen.getByLabelText('입고 수량'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '입고 반영' }))

    await waitFor(() => {
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({
        warehouseCode: '쿠팡',
        sku: 'SKU-NEW',
        productName: '새 상품',
        quantity: 10,
      }))
    })
  })
})

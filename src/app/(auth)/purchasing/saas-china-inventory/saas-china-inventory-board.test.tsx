import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchasingLanguageSwitcher } from '@/components/purchasing-language-switcher'
import { SaasChinaInventoryBoard, type SaasChinaInventoryViewItem } from './saas-china-inventory-board'

const { refresh } = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('../saas-china-actions', () => ({
  adjustSaasChinaInventoryAction: vi.fn(),
  receiveSaasChinaInventoryAction: vi.fn(),
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
})

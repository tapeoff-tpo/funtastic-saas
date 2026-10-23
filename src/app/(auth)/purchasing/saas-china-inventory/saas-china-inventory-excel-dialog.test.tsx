import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SaasChinaInventoryExcelDialog } from './saas-china-inventory-excel-dialog'

const { refresh, toastError, toastSuccess } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}))

function selectWorkbook(name = '중국재고.xlsx') {
  fireEvent.change(screen.getByLabelText('엑셀 파일 선택'), {
    target: {
      files: [new File(['workbook'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })],
    },
  })
}

function response(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

describe('SaasChinaInventoryExcelDialog', () => {
  beforeEach(() => {
    refresh.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    vi.restoreAllMocks()
  })

  it('blocks applying an Excel preview that includes invalid rows', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      preview: {
        summary: { newCount: 0, changedCount: 0, unchangedCount: 0, invalidCount: 1 },
        rows: [{ row: 2, status: 'invalid', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '빨강', beforeQuantity: 10, afterQuantity: 2, message: '예약 수량보다 적게 변경할 수 없습니다.' }],
        errors: [{ row: 2, message: '예약 수량보다 적게 변경할 수 없습니다.' }],
      },
    }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    selectWorkbook()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const apply = await screen.findByRole('button', { name: '검토 결과 반영' })
    expect(apply).toBeDisabled()
    expect(screen.getByText('오류가 있는 행은 반영할 수 없습니다.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/purchasing/saas-china-inventory/excel-import/preview',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
  })

  it('enables a valid preview and refreshes the inventory list after applying it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        preview: {
          summary: { newCount: 0, changedCount: 1, unchangedCount: 0, invalidCount: 0 },
          rows: [{ row: 2, status: 'changed', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '', beforeQuantity: 10, afterQuantity: 20, message: '현재고를 변경합니다.' }],
          errors: [],
        },
      }))
      .mockResolvedValueOnce(response({ preview: { summary: { newCount: 0, changedCount: 1, unchangedCount: 0, invalidCount: 0 }, rows: [], errors: [] } }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    selectWorkbook()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const apply = await screen.findByRole('button', { name: '검토 결과 반영' })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/purchasing/saas-china-inventory/excel-import/apply',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })

  it('rechecks an inventory-status snapshot before applying blank China warehouse quantities as zero', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        source: 'inventory_status_report',
        reportBlankQuantityRowCount: 2,
        preview: {
          summary: { newCount: 0, changedCount: 0, unchangedCount: 1, invalidCount: 0 },
          rows: [{ row: 2, status: 'unchanged', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '', beforeQuantity: 10, afterQuantity: 10, message: '' }],
          errors: [],
        },
      }))
      .mockResolvedValueOnce(response({
        source: 'inventory_status_report',
        reportBlankQuantityRowCount: 2,
        preview: {
          summary: { newCount: 0, changedCount: 1, unchangedCount: 1, invalidCount: 0 },
          rows: [{ row: 2, status: 'changed', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '', beforeQuantity: 10, afterQuantity: 0, message: '재고현황의 빈 중국창고 수량을 0으로 변경합니다.' }],
          errors: [],
        },
      }))
      .mockResolvedValueOnce(response({
        source: 'inventory_status_report',
        reportBlankQuantityRowCount: 2,
        preview: { summary: { newCount: 0, changedCount: 1, unchangedCount: 1, invalidCount: 0 }, rows: [], errors: [] },
      }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    expect(screen.getByText('엑셀 검토만으로는 재고가 변경되지 않습니다. 검토 결과 반영을 눌러야 실제 재고에 적용됩니다.')).toBeInTheDocument()
    selectWorkbook('재고현황.xlsx')
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const zeroSnapshot = await screen.findByRole('checkbox', { name: '재고현황의 빈 중국창고 수량을 0으로 반영' })
    const firstBody = (fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body as FormData
    expect(firstBody.get('inventoryStatusBlankQuantity')).toBe('keep')

    fireEvent.click(zeroSnapshot)
    expect(screen.queryByRole('button', { name: '검토 결과 반영' })).not.toBeInTheDocument()
    expect(screen.getByText('빈 중국창고 수량 2행을 0 재고 대상으로 다시 검토합니다. 기존 SaaS 재고가 없는 행은 새로 등록하지 않습니다.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))
    const apply = await screen.findByRole('button', { name: '검토 결과 반영' })
    const secondBody = (fetch.mock.calls[1]?.[1] as RequestInit | undefined)?.body as FormData
    expect(secondBody.get('inventoryStatusBlankQuantity')).toBe('zero')

    fireEvent.click(apply)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const applyBody = (fetch.mock.calls[2]?.[1] as RequestInit | undefined)?.body as FormData
    expect(applyBody.get('inventoryStatusBlankQuantity')).toBe('zero')
  })
})

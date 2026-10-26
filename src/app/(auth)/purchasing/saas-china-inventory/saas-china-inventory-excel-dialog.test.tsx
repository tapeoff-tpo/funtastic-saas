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
      fullSnapshot: true,
      preview: {
        summary: { newCount: 1, changedCount: 0, unchangedCount: 0, removedCount: 1, invalidCount: 1 },
        rows: [{ row: 2, status: 'invalid', warehouseCode: '중국창고', sku: 'SKU-01', productName: '', optionName: '빨강', beforeQuantity: null, afterQuantity: 2, message: '상품명은 필수입니다.' }],
        errors: [{ row: 2, message: '상품명은 필수입니다.' }],
      },
    }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    selectWorkbook()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const apply = await screen.findByRole('button', { name: '검토 결과 반영' })
    expect(apply).toBeDisabled()
    expect(screen.getByText('확인 필요 항목이 있어 전체 반영할 수 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('이 엑셀은 SaaS 중국재고 전체를 새 목록으로 교체합니다.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/purchasing/saas-china-inventory/excel-import/preview',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
  })

  it('enables a valid preview and refreshes the inventory list after applying it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        fullSnapshot: true,
        preview: {
          summary: { newCount: 1, changedCount: 0, unchangedCount: 0, removedCount: 1, invalidCount: 0 },
          rows: [
            { row: 2, status: 'new', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '', beforeQuantity: null, afterQuantity: 20, message: '새 엑셀 기준으로 재고를 새로 생성합니다.' },
            { row: null, status: 'removed', warehouseCode: '중국창고', sku: 'OLD-01', productName: '기존 재고', optionName: '', beforeQuantity: 10, afterQuantity: 0, message: '새 엑셀 반영을 위해 기존 활성 재고를 삭제합니다.' },
          ],
          errors: [],
        },
      }))
      .mockResolvedValueOnce(response({
        fullSnapshot: true,
        // The service rechecks under its workspace lock, so use its actual
        // result for the completion toast instead of this earlier preview.
        preview: { summary: { newCount: 8, changedCount: 0, unchangedCount: 0, removedCount: 9, invalidCount: 0 }, rows: [], errors: [] },
        result: { createdCount: 1, archivedCount: 1 },
      }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    selectWorkbook()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const apply = await screen.findByRole('button', { name: '검토 결과 반영' })
    expect(apply).toBeEnabled()
    expect(screen.getAllByText('새 목록 생성')).toHaveLength(2)
    expect(screen.getAllByText('기존 목록 삭제')).toHaveLength(2)
    fireEvent.click(apply)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/purchasing/saas-china-inventory/excel-import/apply',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(toastSuccess).toHaveBeenCalledWith('1개 기존 재고를 삭제하고 1개 재고를 새로 생성했습니다.')
  })

  it('treats blank and zero warehouse quantities as no inventory while replacing the active list', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        fullSnapshot: true,
        source: 'inventory_status_report',
        reportEmptyQuantityCellCount: 2,
        preview: {
          summary: { newCount: 1, changedCount: 0, unchangedCount: 0, removedCount: 1, invalidCount: 0 },
          rows: [{ row: null, status: 'removed', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '', beforeQuantity: 10, afterQuantity: 0, message: '새 엑셀 반영을 위해 기존 활성 재고를 삭제합니다.' }],
          errors: [],
        },
      }))
      .mockResolvedValueOnce(response({
        fullSnapshot: true,
        source: 'inventory_status_report',
        reportEmptyQuantityCellCount: 2,
        preview: { summary: { newCount: 1, changedCount: 0, unchangedCount: 0, removedCount: 1, invalidCount: 0 }, rows: [], errors: [] },
      }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    expect(screen.getByText('엑셀 검토만으로는 재고가 변경되지 않습니다. 검토 결과 반영을 눌러야 실제 재고에 적용됩니다.')).toBeInTheDocument()
    selectWorkbook('재고현황.xlsx')
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const apply = await screen.findByRole('button', { name: '검토 결과 반영' })
    expect(screen.getByText('이 엑셀은 SaaS 중국재고 전체를 새 목록으로 교체합니다.')).toBeInTheDocument()
    expect(screen.getByText('빈 칸 또는 0 수량 2칸은 재고 없음으로 처리합니다.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    const previewBody = (fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body as FormData
    expect(previewBody.get('inventoryStatusBlankQuantity')).toBeNull()

    fireEvent.click(apply)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const applyBody = (fetch.mock.calls[1]?.[1] as RequestInit | undefined)?.body as FormData
    expect(applyBody.get('inventoryStatusBlankQuantity')).toBeNull()
  })

  it('shows file rows as new inventory and current rows as list deletions before applying the full replacement', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      fullSnapshot: true,
      source: 'inventory_status_report',
      reportEmptyQuantityCellCount: 0,
      preview: {
        summary: { newCount: 1, changedCount: 0, unchangedCount: 0, removedCount: 1, invalidCount: 0 },
        rows: [
          { row: 2, status: 'new', warehouseCode: '중국창고', sku: 'SKU-01', productName: '상품', optionName: '', beforeQuantity: null, afterQuantity: 10, message: '새 엑셀 기준으로 재고를 새로 생성합니다.' },
          { row: null, status: 'removed', warehouseCode: '중국창고', sku: 'STALE-01', productName: '기존 재고', optionName: '', beforeQuantity: 5, afterQuantity: 0, message: '새 엑셀 반영을 위해 기존 활성 재고를 삭제합니다.' },
        ],
        errors: [],
      },
    }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    selectWorkbook('재고현황.xlsx')
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    expect((await screen.findAllByText('새 목록 생성')).length).toBeGreaterThanOrEqual(2)
    expect((await screen.findAllByText('기존 목록 삭제')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('새 엑셀 기준으로 재고를 새로 생성합니다.')).toBeInTheDocument()
    expect(screen.getByText('새 엑셀 반영을 위해 기존 활성 재고를 삭제합니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '검토 결과 반영' })).toBeEnabled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

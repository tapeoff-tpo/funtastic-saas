import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('shows optional box measurements precisely and allows applying rows with all measurement cells blank', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        fullSnapshot: true,
        preview: {
          summary: { newCount: 2, invalidCount: 0 },
          rows: [
            { row: 2, status: 'new', warehouseCode: '중국창고', sku: 'MEASURED-01', productName: '측정 상품', afterQuantity: 30, totalBoxCount: 3, lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: '12.3456', manualCbm: 0.000001 },
            { row: 3, status: 'new', warehouseCode: '중국창고', sku: 'BLANK-01', productName: '미측정 상품', afterQuantity: 20, totalBoxCount: null, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: null, manualCbm: null },
          ],
          errors: [],
        },
      }))
      .mockResolvedValueOnce(response({ result: { createdCount: 2, archivedCount: 0 } }))

    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    expect(screen.getByText('총 박스수량·가로·세로·높이·무게·CBM은 선택 입력이며, 빈칸이어도 저장할 수 있습니다. 치수는 cm, 무게는 kg으로 입력하세요.')).toBeInTheDocument()
    selectWorkbook()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))

    const measuredRow = (await screen.findByText('측정 상품')).closest('tr')!
    const blankRow = screen.getByText('미측정 상품').closest('tr')!
    expect(within(measuredRow).getAllByRole('cell').slice(6, 10).map((cell) => cell.textContent)).toEqual(['3', '50 × 40 × 30', '12.3456', '0.000001'])
    expect(within(blankRow).getAllByRole('cell').slice(6, 10).map((cell) => cell.textContent)).toEqual(['-', '-', '-', '-'])
    expect(screen.getByRole('columnheader', { name: '총 박스수량' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '가로 × 세로 × 높이(cm)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '무게(kg)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'CBM' })).toBeInTheDocument()

    const apply = screen.getByRole('button', { name: '검토 결과 반영' })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('marks shared cartons and shows each option quantity share without counting the carton twice', async () => {
    const group = { version: 1, key: 'mixed-keldi', totalBoxCount: 1, referenceQuantity: 150, grossWeightKg: 8, manualCbm: 0.003308 }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ preview: {
      summary: { newCount: 2, invalidCount: 0 }, errors: [], rows: [
        { row: 2, status: 'new', warehouseCode: '중국창고', sku: '110791-0001', productName: '켈디 지퍼고리', optionName: '실버', afterQuantity: 50, totalBoxCount: 1, grossWeightKg: 2.667, manualCbm: 0.001103, packagingGroup: { ...group, memberStartQuantity: 0 } },
        { row: 3, status: 'new', warehouseCode: '중국창고', sku: '110791-0002', productName: '켈디 지퍼고리', optionName: '블랙', afterQuantity: 100, totalBoxCount: null, grossWeightKg: 5.333, manualCbm: 0.002205, packagingGroup: { ...group, memberStartQuantity: 50 } },
      ],
    } }))
    render(<SaasChinaInventoryExcelDialog />)
    fireEvent.click(screen.getByRole('button', { name: '엑셀로 재고 변경' }))
    selectWorkbook()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 검토' }))
    expect(await screen.findAllByText('혼합적재 1 · 1박스 공유')).toHaveLength(2)
    const black = screen.getByText('110791-0002 · 블랙').closest('tr')!
    expect(within(black).getAllByRole('cell').slice(6, 10).map((cell) => cell.textContent)).toEqual(['-', '-', '5.333', '0.002205'])
    expect(screen.getByRole('button', { name: '검토 결과 반영' })).toBeEnabled()
  })
})

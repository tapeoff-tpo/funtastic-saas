import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PurchasingRawDataUpload } from './raw-data-upload'

const freshness = {
  rawDataAppliedAt: null,
  domesticInventoryAt: null,
  chinaInventoryAt: null,
  outboundRawAt: null,
  outboundReflectionAt: null,
}

function renderUploader() {
  return render(
    <PurchasingRawDataUpload
      today="2026-09-11"
      inventoryUpdatedDate="2026-09-11"
      initialStoredFiles={{}}
      dataFreshness={freshness}
    />,
  )
}

describe('PurchasingRawDataUpload drag and drop', () => {
  it('adds an Excel file dropped on the overall upload area', () => {
    renderUploader()
    const file = new File(['workbook'], 'ESG002M.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const dataTransfer = {
      files: [file],
      types: ['Files'],
      dropEffect: '',
    }
    const uploadArea = screen
      .getByText('파일을 카드 어디에나, 또는 이 영역에 여러 개 한꺼번에 드래그해 놓을 수 있습니다.')
      .closest('section')

    expect(uploadArea).not.toBeNull()
    fireEvent.drop(uploadArea!, { dataTransfer })

    expect(screen.getByText('ESG002M.xlsx')).toBeInTheDocument()
    expect(screen.getByText(/1개 파일을 임시 선택했습니다/)).toBeInTheDocument()
  })

  it('keeps an Excel file dropped on its specific card', () => {
    renderUploader()
    const file = new File(['workbook'], 'domestic-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const dataTransfer = {
      files: [file],
      types: ['Files'],
      dropEffect: '',
    }
    const cardInput = screen.getByLabelText('국내재고현황 파일 선택')

    fireEvent.drop(cardInput, { dataTransfer })

    expect(screen.getByText('domestic-stock.xlsx')).toBeInTheDocument()
  })

  it('accepts an Excel file selected by the full-card native input', () => {
    renderUploader()
    const file = new File(['workbook'], 'purchase-plan.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const cardInput = screen.getByLabelText('발주계획현황 파일 선택')

    fireEvent.change(cardInput, { target: { files: [file] } })

    expect(screen.getByText('purchase-plan.xlsx')).toBeInTheDocument()
  })
})

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

function renderUploader(initialStoredFiles: Record<string, { fileName: string; updatedAt: string }> = {}) {
  return render(
    <PurchasingRawDataUpload
      today="2026-09-11"
      inventoryUpdatedDate="2026-09-11"
      initialStoredFiles={initialStoredFiles}
      dataFreshness={freshness}
    />,
  )
}

describe('PurchasingRawDataUpload drag and drop', () => {
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
    const card = getCard('국내재고현황')

    fireEvent.drop(card, { dataTransfer })

    expect(screen.getByText('domestic-stock.xlsx')).toBeInTheDocument()
  })

  it('replaces a stored file when a new file is dropped on that card', () => {
    renderUploader({
      purchaseRequest: { fileName: 'previous-request.xlsx', updatedAt: '2026-09-10T01:41:45.000Z' },
    })
    const file = new File(['workbook'], 'new-request.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const dataTransfer = { files: [file], types: ['Files'], dropEffect: '' }

    fireEvent.drop(getCard('발주요청현황'), { dataTransfer })

    expect(screen.getByText('new-request.xlsx')).toBeInTheDocument()
  })

  it('accepts an Excel file selected through the card input', () => {
    renderUploader()
    const file = new File(['workbook'], 'purchase-plan.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const cardInput = getCard('발주계획현황').querySelector('input[type="file"]')

    expect(cardInput).not.toBeNull()

    fireEvent.change(cardInput!, { target: { files: [file] } })

    expect(screen.getByText('purchase-plan.xlsx')).toBeInTheDocument()
  })
})

function getCard(label: string) {
  const card = screen.getByText(label).closest('label')
  if (!card) throw new Error(`${label} 업로드 카드를 찾지 못했습니다.`)
  return card
}

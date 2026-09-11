import { describe, expect, it } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
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
  it('advertises a copy drop before an Explorer file is released over nested card content', () => {
    renderUploader()
    const dataTransfer = {
      files: [],
      items: [],
      types: [],
      dropEffect: 'none',
    }
    const nestedText = screen.getByText('아직 구매되지 않은 구매요청 건')
    const dragEnter = createEvent.dragEnter(nestedText, { dataTransfer, cancelable: true })
    const dragOver = createEvent.dragOver(nestedText, { dataTransfer, cancelable: true })

    fireEvent(nestedText, dragEnter)
    fireEvent(nestedText, dragOver)

    expect(dragEnter.defaultPrevented).toBe(true)
    expect(dragOver.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(getCard('발주요청현황')).toHaveClass('border-primary')
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

    fireEvent.drop(screen.getByText(/previous-request\.xlsx/), { dataTransfer })

    expect(screen.getByText('new-request.xlsx')).toBeInTheDocument()
    expect(screen.queryByText(/previous-request\.xlsx/)).not.toBeInTheDocument()
  })

  it('reads a dropped file from DataTransfer.items when files is empty', () => {
    renderUploader()
    const file = new File(['workbook'], 'china-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const dataTransfer = {
      files: [],
      items: [{ kind: 'file', getAsFile: () => file }],
      types: ['Files'],
      dropEffect: 'none',
    }

    fireEvent.drop(screen.getByText('현재 중국창고에 보유한 재고'), { dataTransfer })

    expect(screen.getByText('china-stock.xlsx')).toBeInTheDocument()
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

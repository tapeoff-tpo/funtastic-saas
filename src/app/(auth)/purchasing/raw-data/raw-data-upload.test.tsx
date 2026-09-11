import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { CompressionStream as NodeCompressionStream } from 'node:stream/web'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PurchasingRawDataUpload drag and drop', () => {
  it('accepts five arbitrarily named Ecount files dropped together on the upload section', () => {
    renderUploader()
    const files = [
      '8G9KT07OSOXDP52.xlsx',
      'ESZ018R (29).xlsx',
      'BB50CCZlqmL4O8xo.xlsx',
      'L05L61HJMBAHCR2.xlsx',
      '85XQ07KHNO9749I.xlsx',
    ].map((name) => new File(['workbook'], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    const dataTransfer = { files, items: [], types: [], dropEffect: 'none' }
    const sectionHeading = screen.getByText('1. 파일별로 업로드')
    const dragOver = createEvent.dragOver(sectionHeading, { dataTransfer, cancelable: true })

    fireEvent(sectionHeading, dragOver)
    fireEvent.drop(sectionHeading, { dataTransfer })

    expect(dragOver.defaultPrevented).toBe(true)
    for (const file of files) expect(screen.getByText(file.name)).toBeInTheDocument()
    expect(screen.getByText(/5개 변경/)).toBeInTheDocument()
    expect(screen.getByText(/실제 파일 종류대로 자동 정리됩니다/)).toBeInTheDocument()
  })

  it('compresses a purchasing batch larger than 4MB before sending it', async () => {
    vi.stubGlobal('Blob', NodeBlob)
    vi.stubGlobal('CompressionStream', NodeCompressionStream)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'test response' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ))
    renderUploader()
    const files = Array.from({ length: 5 }, (_, index) => new NodeFile(
      [new Uint8Array(900_000)],
      `report-${index + 1}.xlsx`,
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    )) as unknown as File[]
    const sectionHeading = screen.getByText('1. 파일별로 업로드')
    fireEvent.drop(sectionHeading, {
      dataTransfer: { files, items: [], types: [], dropEffect: 'none' },
    })

    fireEvent.click(screen.getByRole('button', { name: /미리보기·검증/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, request] = fetchMock.mock.calls[0]
    expect(request?.headers).toEqual({
      'Content-Type': 'application/vnd.funtastic.purchasing-raw+gzip',
    })
    expect(request?.body).toBeInstanceOf(ArrayBuffer)
    expect((request?.body as ArrayBuffer).byteLength).toBeLessThan(4 * 1024 * 1024)
  })

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

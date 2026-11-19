// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRegistrationRow, type SavedFile } from '@/lib/coupang-registration/model'
import { applyConvertedQualityLabels, qualityLabelFileName, qualityPdfNeedsConversion } from '@/lib/coupang-registration/quality-labels'

const pdfId = '46549232-f6ec-47ba-99cc-ba14a3cdfb37'
const labels: SavedFile[] = [
  { name: '마미백 품질표시-46549232-f6-p1of2.jpg', data: 'aGVsbG8=' },
  { name: '마미백 품질표시-46549232-f6-p2of2.jpg', data: 'aGVsbG8=' },
]

describe('Coupang quality-label PDF defaults', () => {
  it('gives each converted page a stable, ZIP-safe JPG filename', () => {
    const first = qualityLabelFileName('인쇄용)[마미백 플러스 ]품질표시.pdf', pdfId, 1, 2)
    const second = qualityLabelFileName('인쇄용)[마미백 플러스 ]품질표시.pdf', pdfId, 2, 2)
    expect(first).toMatch(/\.jpg$/)
    expect(first).not.toMatch(/[\\/:*?"<>|]/)
    expect(first).not.toBe(second)
  })

  it('connects generated JPGs and recognizes a complete automatic default', () => {
    const row = applyConvertedQualityLabels(createRegistrationRow(), pdfId, labels)
    expect(row.label).toBe(labels.map((file) => file.name).join(','))
    expect(row.autoQualityLabel).toEqual({ sourcePdfId: pdfId, value: row.label })
    expect(qualityPdfNeedsConversion(row, pdfId, labels)).toBe(false)
  })

  it('does not replace a manual label or a deliberate clear', () => {
    const manual = { ...createRegistrationRow(), label: '직접 올린 라벨.jpg' }
    expect(qualityPdfNeedsConversion(manual, pdfId, labels)).toBe(false)
    expect(applyConvertedQualityLabels(manual, pdfId, labels)).toEqual(manual)

    const automatic = applyConvertedQualityLabels(createRegistrationRow(), pdfId, labels)
    const cleared = { ...automatic, label: '' }
    expect(qualityPdfNeedsConversion(cleared, pdfId, labels)).toBe(false)
    expect(applyConvertedQualityLabels(cleared, pdfId, labels)).toEqual(cleared)
  })

  it('refreshes an automatic label when the Product Management PDF changes or its image is missing', () => {
    const automatic = applyConvertedQualityLabels(createRegistrationRow(), pdfId, labels)
    expect(qualityPdfNeedsConversion(automatic, '00e7c6e8-8f31-456b-98a3-7c3e86c36c1a', labels)).toBe(true)
    expect(qualityPdfNeedsConversion(automatic, pdfId, [])).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import type { DaouWorksImportItem } from './daou-works-import'
import {
  applyPrimaryOptionValues,
  buildDaouWorksTextFieldMigration,
  filterDaouWorksItemsWithUniqueSampleCodes,
  normalizeNewProductEditorLayout,
} from './workflow'

describe('normalizeNewProductEditorLayout', () => {
  it('keeps a custom section order, visibility, and column count', () => {
    expect(normalizeNewProductEditorLayout({
      sectionOrder: ['pricing', 'basic', 'progress', 'package', 'attachments', 'notice'],
      hiddenSections: ['package', 'basic'],
      columns: 3,
    })).toEqual({
      sectionOrder: ['pricing', 'basic', 'progress', 'package', 'attachments', 'notice'],
      hiddenSections: ['package'],
      columns: 3,
    })
  })

  it('removes invalid values and restores missing sections', () => {
    expect(normalizeNewProductEditorLayout({
      sectionOrder: ['basic', 'basic', 'unknown'],
      hiddenSections: ['unknown', 'pricing', 'pricing'],
      columns: 9,
    })).toEqual({
      sectionOrder: ['basic', 'progress', 'attachments', 'notice', 'package', 'pricing'],
      hiddenSections: ['pricing'],
      columns: 2,
    })
  })

  it('does not import a different WORKS product with an existing product number', () => {
    const items = [
      { sourceId: 'existing-source', values: { sampleCode: 'AB-100' } },
      { sourceId: 'new-source', values: { sampleCode: 'ab-100' } },
      { sourceId: 'empty-code', values: { sampleCode: null } },
      { sourceId: 'first-new-source', values: { sampleCode: 'CD-200' } },
      { sourceId: 'second-new-source', values: { sampleCode: ' CD-200 ' } },
    ] as unknown as DaouWorksImportItem[]

    const result = filterDaouWorksItemsWithUniqueSampleCodes({
      items,
      existingRows: [{ sourceId: 'existing-source', sampleCode: 'ab-100' }],
    })

    expect(result.items.map((item) => item.sourceId)).toEqual([
      'existing-source',
      'empty-code',
      'first-new-source',
    ])
    expect(result.duplicateSampleCodes).toEqual(['ab-100', 'CD-200'])
  })

  it('moves only WORKS keyword text and history without changing other fields', () => {
    expect(buildDaouWorksTextFieldMigration({
      id: 'item-1',
      requiredChecks: '키워드\n노트,수첩\n\n\n26년 3월 26일 소싱회의 통과\n方块本-黄色-yellow',
      productKeywords: '기존키워드',
      historyNotes: '샘플 구매 완료',
      referenceNotes: '상세페이지 참고',
    })).toMatchObject({
      requiredChecks: '26년 3월 26일 소싱회의 통과\n方块本-黄色-yellow',
      productKeywords: '기존키워드\n\n노트,수첩',
      historyNotes: null,
      referenceNotes: '히스토리: 샘플 구매 완료\n\n비고: 상세페이지 참고',
      keywordMoved: true,
      historyMoved: true,
      changed: true,
    })
  })
})

describe('applyPrimaryOptionValues', () => {
  it('uses the first option as the product-level representative values', () => {
    const values = {
      sabangnetCode: 'legacy-code',
      chinaUnitPriceCny: 1,
      unitShippingCny: 2,
      exchangeRateKrw: 1_500,
      calculatedCostKrw: 4_500,
      previousCostKrw: 4_000,
      b2bOptionSurcharge: 100,
      b2cOptionSurcharge: 200,
      optionDetails: [{
        id: 'option-1',
        optionName: '대형',
        sabangnetOptionCode: 'option-code',
        sabangnetRegistered: 'Y',
        chinaUnitPriceCny: 12.5,
        unitShippingCny: 3.5,
        purchaseReferenceNotes: null,
        costKrw: 24_000,
        previousCostKrw: 22_000,
        exchangeRateKrw: 205,
        b2bPrice: 1_000,
        b2cPrice: 2_000,
      }],
    } as unknown as import('./workflow').NewProductInput

    expect(applyPrimaryOptionValues(values)).toMatchObject({
      sabangnetCode: 'option-code',
      chinaUnitPriceCny: 12.5,
      unitShippingCny: 3.5,
      exchangeRateKrw: 205,
      calculatedCostKrw: 24_000,
      previousCostKrw: 22_000,
      b2bOptionSurcharge: 1_000,
      b2cOptionSurcharge: 2_000,
    })
  })

  it('keeps existing values when the first option has no matching data', () => {
    const values = {
      sabangnetCode: 'legacy-code',
      chinaUnitPriceCny: 1,
      unitShippingCny: 2,
      exchangeRateKrw: 1_500,
      calculatedCostKrw: 4_500,
      previousCostKrw: 4_000,
      b2bOptionSurcharge: 100,
      b2cOptionSurcharge: 200,
      optionDetails: [{
        id: 'option-1',
        optionName: '대형',
        sabangnetOptionCode: null,
        sabangnetRegistered: null,
        chinaUnitPriceCny: null,
        unitShippingCny: null,
        purchaseReferenceNotes: null,
        costKrw: null,
        previousCostKrw: null,
        exchangeRateKrw: null,
        b2bPrice: null,
        b2cPrice: null,
      }],
    } as unknown as import('./workflow').NewProductInput

    expect(applyPrimaryOptionValues(values)).toMatchObject({
      sabangnetCode: 'legacy-code',
      chinaUnitPriceCny: 1,
      unitShippingCny: 2,
      exchangeRateKrw: 1_500,
      calculatedCostKrw: 4_500,
      previousCostKrw: 4_000,
      b2bOptionSurcharge: 100,
      b2cOptionSurcharge: 200,
    })
  })
})

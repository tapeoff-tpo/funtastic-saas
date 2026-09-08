import { describe, expect, it } from 'vitest'
import type { DaouWorksImportItem } from './daou-works-import'
import {
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
})

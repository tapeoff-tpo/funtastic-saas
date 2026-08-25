import { describe, expect, it } from 'vitest'
import { normalizeNewProductEditorLayout } from './workflow'

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
})

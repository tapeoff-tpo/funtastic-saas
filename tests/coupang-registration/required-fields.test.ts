import { describe, expect, it } from 'vitest'
import {
  applyProductMasterDefaults, applyRegistrationDefaults, AS_CONTACT_DEFAULT, AS_CONTACT_FIELD,
  blankDraft, createRegistrationRow, registrationCommonSheet, registrationFieldKey,
  registrationInformationSheet, rowIssues, SEARCH_TAGS_FIELD, WARRANTY_DEFAULT, WARRANTY_FIELD,
  type RegistrationDraft, type RegistrationProductMaster, type RegistrationRow, type TemplateSheet,
} from '@/lib/coupang-registration/model'
import { rowSchema } from '@/lib/coupang-registration/schema'

const master: RegistrationProductMaster = {
  itemId: 'master-1', match: 'sku', noticeSize: '', noticeWeight: '', noticeMaterial: '', noticeManufacturer: '', noticeCountry: '',
  productKeywords: '선반,수납장\n책장',
}
const base = (overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({
  ...createRegistrationRow(), name: '수납 선반', sourceName: '수납 선반', stage: 'information', costPrice: 10000, wholesalePrice: 15000, productMaster: master, ...overrides,
})
const official: TemplateSheet = { name: 'QF_1_선반', columns: [
  { column: 2, label: '상품명', requirement: '필수', guide: '' },
  { column: 4, label: '공급가', requirement: '필수', guide: '' },
] }
function withOfficial(row: RegistrationRow, sheet = official): RegistrationDraft {
  return { ...blankDraft(), rows: [row], templates: [{ id: 'official-file', name: 'original.xlsx', file: { name: 'original.xlsx', data: 'QQ==' }, sheets: [sheet] }] }
}

describe('required registration search tags and service information', () => {
  it('prefills the confirmed warranty and phone text while using Product Management keywords verbatim', () => {
    const result = applyRegistrationDefaults(base(), registrationCommonSheet)
    expect(result.fields).toMatchObject({
      [SEARCH_TAGS_FIELD]: master.productKeywords,
      [WARRANTY_FIELD]: '제품 이상 시 공정거래위원회 고시 소비자 분쟁해결기준에 의거 보상합니다',
      [AS_CONTACT_FIELD]: '1577-7011',
    })
    expect(WARRANTY_DEFAULT).toBe(result.fields[WARRANTY_FIELD])
    expect(AS_CONTACT_DEFAULT).toBe(result.fields[AS_CONTACT_FIELD])
    expect(applyRegistrationDefaults(result, registrationCommonSheet)).toBe(result)
  })

  it('refreshes automatic keywords but preserves user edits and explicit clears', () => {
    const initial = applyProductMasterDefaults(base())
    const changedMaster = { ...master, productKeywords: '최신 선반,정리함' }
    expect(applyProductMasterDefaults({ ...initial, productMaster: changedMaster }).fields[SEARCH_TAGS_FIELD]).toBe(changedMaster.productKeywords)
    for (const value of ['직접 정한 검색태그', '']) {
      const edited = { ...initial, productMaster: changedMaster, fields: { ...initial.fields, [SEARCH_TAGS_FIELD]: value } }
      expect(applyProductMasterDefaults(edited).fields[SEARCH_TAGS_FIELD]).toBe(value)
    }
  })

  it('preserves manual warranty and service values, including deliberate clears of defaults', () => {
    const initial = applyRegistrationDefaults(base(), registrationCommonSheet)
    for (const value of ['사용자가 확인한 안내', '']) {
      const edited = { ...initial, fields: { ...initial.fields, [WARRANTY_FIELD]: value, [AS_CONTACT_FIELD]: value } }
      expect(applyRegistrationDefaults(edited, registrationCommonSheet).fields).toMatchObject({ [WARRANTY_FIELD]: value, [AS_CONTACT_FIELD]: value })
    }
  })

  it('does not derive a set’s tags from one component or invent tags when the master has none', () => {
    expect(applyProductMasterDefaults(base({ bundleComponents: [] })).fields).not.toHaveProperty(SEARCH_TAGS_FIELD)
    expect(applyProductMasterDefaults(base({ productMaster: { ...master, productKeywords: undefined } })).fields).not.toHaveProperty(SEARCH_TAGS_FIELD)
  })

  it('keeps existing original column positions and duplicate field keys when adding required information', () => {
    const original: TemplateSheet = { name: 'QF_2_정보', columns: [
      { column: 2, label: '주요 소재', requirement: '선택', guide: '첫 표기' },
      { column: 9, label: SEARCH_TAGS_FIELD, requirement: '선택', guide: '원본 가이드' },
      { column: 12, label: '주요 소재', requirement: '필수', guide: '두 번째 표기' },
    ] }
    const saved = structuredClone(original)
    const row = base({ templateId: 'official-file' })
    const beforeKeys = original.columns.map(column => registrationFieldKey(row, original, column))
    const result = registrationInformationSheet(original)
    expect(original).toEqual(saved)
    expect(result.columns.slice(0, 3).map(({ column, label, guide }) => ({ column, label, guide }))).toEqual(original.columns.map(({ column, label, guide }) => ({ column, label, guide })))
    expect(result.columns.slice(0, 3).map(column => registrationFieldKey(row, result, column))).toEqual(beforeKeys)
    for (const label of [SEARCH_TAGS_FIELD, WARRANTY_FIELD, AS_CONTACT_FIELD]) {
      const columns = result.columns.filter(column => column.label === label)
      expect(columns).toHaveLength(1)
      expect(columns[0].requirement).toBe('필수')
    }
    expect(registrationInformationSheet(result)).toEqual(result)
  })

  it('reports missing search tags even when the original official sheet omits them', () => {
    const row = applyRegistrationDefaults(base({ templateId: 'official-file', sheetName: official.name, productMaster: undefined }), registrationInformationSheet(official))
    const issues = rowIssues(row, withOfficial(row))
    expect(issues).toContain(`${SEARCH_TAGS_FIELD} 누락`)
    expect(issues).not.toContain(`${WARRANTY_FIELD} 누락`)
    expect(issues).not.toContain(`${AS_CONTACT_FIELD} 누락`)
    const filled = { ...row, fields: { ...row.fields, [SEARCH_TAGS_FIELD]: '직접 확인한 태그' } }
    expect(rowIssues(filled, withOfficial(filled))).not.toContain(`${SEARCH_TAGS_FIELD} 누락`)
  })

  it('reports the common required fields before a template is selected', () => {
    const row = base({ productMaster: undefined })
    expect(rowIssues(row, blankDraft())).toEqual(expect.arrayContaining([
      `${SEARCH_TAGS_FIELD} 누락`, `${WARRANTY_FIELD} 누락`, `${AS_CONTACT_FIELD} 누락`,
    ]))
  })

  it('saves the optional keyword source in current rows and accepts older saved masters without it', () => {
    expect(rowSchema.parse(base()).productMaster?.productKeywords).toBe(master.productKeywords)
    const legacyMaster = { ...master }
    delete legacyMaster.productKeywords
    const legacy = rowSchema.parse(base({ productMaster: legacyMaster }))
    expect(legacy.productMaster).toEqual(legacyMaster)
    expect(legacy.productMaster).not.toHaveProperty('productKeywords')
  })

  it.each([
    { stage: 'registered' as const },
    { submission: { status: 'running' as const, jobId: 'job-1' } },
  ])('does not change locked values or introduce new defaults for %j', lock => {
    const row = base({ ...lock, fields: { [SEARCH_TAGS_FIELD]: '기존 태그' } })
    expect(applyProductMasterDefaults(row)).toBe(row)
    expect(applyRegistrationDefaults(row, registrationCommonSheet)).toBe(row)
  })
})

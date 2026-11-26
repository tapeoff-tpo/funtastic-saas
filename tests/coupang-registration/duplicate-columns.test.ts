// @vitest-environment node
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildRegistrationArchive, readTemplate } from '@/lib/coupang-registration/excel'
import { applyRegistrationDefaults, AS_CONTACT_DEFAULT, AS_CONTACT_FIELD, blankDraft, createRegistrationRow, registrationFieldKey, registrationFieldValue, rowIssues, SEARCH_TAGS_FIELD, WARRANTY_DEFAULT, WARRANTY_FIELD, type RegistrationDraft, type TemplateSheet } from '@/lib/coupang-registration/model'
import { draftSchema, rowSchema } from '@/lib/coupang-registration/schema'

const requiredFields = { [SEARCH_TAGS_FIELD]: '선반,수납', [WARRANTY_FIELD]: WARRANTY_DEFAULT, [AS_CONTACT_FIELD]: AS_CONTACT_DEFAULT }

async function fixture() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('QF_2379_가구_수납가구_선반')
  sheet.getRow(5).values = ['상품명', '공급가', '쿠팡 판매가', '설치지원방식', '설치지원방식', '색상', '색상']
  sheet.getRow(6).values = ['필수', '필수', '필수', '선택', '조건부 필수', '필수', '필수']
  sheet.getRow(7).values = ['', '', '', '상품 조립 방식', '로켓 설치 지원 방식', '대표 표면 색상', '상품 고시 색상']
  sheet.getRow(9).values = ['선반 3단', 13000, 21667, '완전 조립', '고객직접설치', '브라운', '우드 브라운']
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  const parsed = await readTemplate(bytes, '공식 선반 양식.xlsx')
  const draft: RegistrationDraft = { ...blankDraft(), templates: [parsed.template], rows: parsed.rows.map(row => ({ ...row, fields: { ...row.fields, ...requiredFields } })) }
  return { draft, row: draft.rows[0], sheet: parsed.template.sheets[0] }
}

async function exportedSheet(draft: RegistrationDraft) {
  const archive = await JSZip.loadAsync(await buildRegistrationArchive(draft))
  const file = Object.values(archive.files).find((entry) => entry.name.endsWith('.xlsx'))!
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.async('nodebuffer') as unknown as ExcelJS.Buffer)
  return workbook.worksheets.find((sheet) => sheet.name.startsWith('QF_'))!
}

describe('independent official columns with duplicate labels', () => {
  it('preserves independent assembly, installation and color values through import, save validation and export', async () => {
    const { draft, row, sheet } = await fixture()
    expect(row.fields.설치지원방식).toBeUndefined()
    expect(row.fields.색상).toBeUndefined()
    expect(sheet.columns.slice(3).map((column) => registrationFieldValue(row, sheet, column))).toEqual(['완전 조립', '고객직접설치', '브라운', '우드 브라운'])
    expect(row.fields.상품명).toBe('선반 3단')
    expect(registrationFieldKey(row, sheet, sheet.columns[0])).toBe('상품명')
    const saved = draftSchema.parse(draft)
    expect(saved.rows[0].fields).toEqual(row.fields)
    expect(rowIssues(saved.rows[0], saved)).toEqual([])
    const exported = await exportedSheet(saved)
    expect(exported.getRow(9).values).toEqual([undefined, '선반 3단', 13000, 21667, '완전 조립', '고객직접설치', '브라운', '우드 브라운'])
  })

  it('validates each required duplicate independently and lets an explicit clear override legacy label fallback', async () => {
    const { draft, row, sheet } = await fixture()
    const firstColor = sheet.columns[5]
    const secondColor = sheet.columns[6]
    const legacy = { ...row, fields: { ...requiredFields, 상품명: row.name, 색상: '기존 색상', 설치지원방식: '기존 설치 방식' } }
    expect(registrationFieldValue(legacy, sheet, firstColor)).toBe('기존 색상')
    expect(registrationFieldValue(legacy, sheet, secondColor)).toBe('기존 색상')
    expect(rowIssues(legacy, { ...draft, rows: [legacy] })).toEqual([])
    const cleared = { ...legacy, fields: { ...legacy.fields, [registrationFieldKey(legacy, sheet, firstColor)]: '' } }
    expect(registrationFieldValue(cleared, sheet, firstColor)).toBe('')
    expect(registrationFieldValue(cleared, sheet, secondColor)).toBe('기존 색상')
    expect(applyRegistrationDefaults(cleared, sheet)).toBe(cleared)
    expect(rowIssues(cleared, draft)).toEqual(['색상 (6열) 누락'])
    const bothCleared = { ...cleared, fields: { ...cleared.fields, [registrationFieldKey(cleared, sheet, secondColor)]: '' } }
    expect(rowIssues(bothCleared, draft)).toEqual(['색상 (6열) 누락', '색상 (7열) 누락'])
    await expect(buildRegistrationArchive({ ...draft, rows: [cleared] })).rejects.toThrow('색상 (6열) 누락')
    const clearedOptional = { ...legacy, fields: { ...legacy.fields, [registrationFieldKey(legacy, sheet, sheet.columns[3])]: '', [registrationFieldKey(legacy, sheet, sheet.columns[4])]: '고객직접설치' } }
    const exported = await exportedSheet({ ...draft, rows: [clearedOptional] })
    expect(exported.getCell('D9').value).toBeNull()
    expect(exported.getCell('E9').value).toBe('고객직접설치')
    expect(exported.getCell('F9').value).toBe('기존 색상')
    expect(exported.getCell('G9').value).toBe('기존 색상')
  })

  it('preserves an untracked explicit duplicate clear across defaults while still filling imported unique blanks', () => {
    const sheet: TemplateSheet = { name: 'QF_2379_선반', columns: [
      { column: 6, label: '브랜드', requirement: '필수', guide: '' },
      { column: 7, label: '색상', requirement: '필수', guide: '' },
      { column: 62, label: '색상', requirement: '필수', guide: '' },
    ] }
    const row = { ...createRegistrationRow(), templateId: 'official-shelf', fields: { 브랜드: '', 색상: '검정' } }
    const firstKey = registrationFieldKey(row, sheet, sheet.columns[1])
    const secondKey = registrationFieldKey(row, sheet, sheet.columns[2])
    const edited = { ...row, fields: { ...row.fields, [firstKey]: '', [secondKey]: '흰색' } }
    const result = applyRegistrationDefaults(edited, sheet)
    expect(result.fields).toEqual({ 브랜드: '생활살림', 색상: '검정', [firstKey]: '', [secondKey]: '흰색' })
    expect(result.defaultedFields).toEqual({ 브랜드: '생활살림' })
    expect(applyRegistrationDefaults(result, sheet)).toBe(result)
  })

  it('scopes duplicate keys to their original template and sheet when categories change', async () => {
    const { row, sheet } = await fixture()
    const column = sheet.columns[3]
    const changedTemplate = { ...row, templateId: 'different-official-file' }
    expect(registrationFieldValue(changedTemplate, sheet, column)).toBeUndefined()
    const changedSheet = { ...sheet, name: 'QF_1899_생활용품_행거' }
    expect(registrationFieldValue(row, changedSheet, column)).toBeUndefined()
    const unrelated = { ...column, label: '다른 항목' }
    expect(registrationFieldValue(row, { ...sheet, columns: [unrelated] }, unrelated)).toBeUndefined()
    const legacy = { ...changedTemplate, fields: { ...row.fields, 설치지원방식: '이전 저장값' } }
    expect(registrationFieldValue(legacy, sheet, column)).toBe('이전 저장값')
  })

  it('tracks duplicate defaults independently while preserving deliberate clears and schema compatibility', () => {
    const sheet: TemplateSheet = { name: 'QF_1_기본값', columns: [1, 2].map((column) => ({ column, label: '브랜드', requirement: '필수', guide: '' })) }
    const row = { ...createRegistrationRow(), templateId: 'official-file' }
    const initial = applyRegistrationDefaults(row, sheet)
    const keys = sheet.columns.map((column) => registrationFieldKey(initial, sheet, column))
    expect(initial.fields).toEqual({ [keys[0]]: '생활살림', [keys[1]]: '생활살림' })
    expect(initial.defaultedFields).toEqual(initial.fields)
    const cleared = { ...initial, fields: { ...initial.fields, [keys[0]]: '' } }
    expect(applyRegistrationDefaults(cleared, sheet)).toBe(cleared)
    expect(registrationFieldValue(cleared, sheet, sheet.columns[1])).toBe('생활살림')
    const longRow = { ...row, templateId: '"'.repeat(100) }
    const longSheet = { ...sheet, name: '\\'.repeat(100) }
    const key = registrationFieldKey(longRow, longSheet, longSheet.columns[0])
    expect(key.length).toBeGreaterThan(200)
    expect(key.length).toBeLessThanOrEqual(500)
    const parsed = rowSchema.parse({ ...longRow, fields: { [key]: '생활살림' }, defaultedFields: { [key]: '생활살림' } })
    expect(parsed.fields[key]).toBe('생활살림')
    expect(parsed.defaultedFields?.[key]).toBe('생활살림')
  })
})

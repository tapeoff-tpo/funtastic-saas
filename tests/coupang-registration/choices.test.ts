// @vitest-environment node
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildRegistrationArchive, readTemplate } from '@/lib/coupang-registration/excel'
import { applyRegistrationDefaults, blankDraft, createRegistrationRow, rowIssues } from '@/lib/coupang-registration/model'
import { draftSchema } from '@/lib/coupang-registration/schema'

function fixture() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('QF_2379_가구_수납가구_선반')
  sheet.getRow(5).values = ['상품명', '공급가', '카테고리', '브랜드', '수입여부']
  sheet.getRow(6).values = ['필수', '필수', '필수', '필수', '필수']
  const options = workbook.addWorksheet('HQF_6_2379', { state: 'veryHidden' })
  return { workbook, sheet, options }
}
async function parse(workbook: ExcelJS.Workbook) {
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  return { bytes, ...await readTemplate(bytes, '공식 견적서.xlsx') }
}

describe('official template choice metadata', () => {
  it('exports the chosen official leaf value and preserves choices through save validation', async () => {
    const { workbook, sheet } = fixture()
    const paths = ['벽선반 (77939)', '스탠드선반 (77940)']
    sheet.getCell('C9').dataValidation = { type: 'list', formulae: ['"' + paths.join(',') + '"'], showErrorMessage: false }
    const { template } = await parse(workbook)
    const row = applyRegistrationDefaults({ ...createRegistrationRow(), name: '선반 3단', templateId: template.id, sheetName: sheet.name, priceMode: 'manual', manualSupplyPrice: 13000, saleMode: 'manual', manualSalePrice: 21667 }, template.sheets[0])
    expect(row.fields.카테고리).toBeUndefined()
    const draft = draftSchema.parse({ ...blankDraft(), templates: [template], rows: [{ ...row, fields: { ...row.fields, 카테고리: paths[1] } }] })
    expect(draft.templates[0].sheets[0].columns.find((column) => column.label === '카테고리')?.choices).toEqual(paths)
    expect(rowIssues(draft.rows[0], draft)).toEqual([])
    const invalid = { ...draft.rows[0], fields: { ...draft.rows[0].fields, 카테고리: '선반' } }
    expect(rowIssues(invalid, draft)).toContain('카테고리는 공식 양식의 세부 분류에서 선택해주세요.')
    await expect(buildRegistrationArchive({ ...draft, rows: [invalid] })).rejects.toThrow('세부 분류')
    const archive = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const exported = new ExcelJS.Workbook()
    const file = Object.values(archive.files).find((entry) => entry.name.endsWith('.xlsx'))!
    await exported.xlsx.load(await file.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(exported.getWorksheet(sheet.name)!.getCell('C9').value).toBe(paths[1])
    expect(exported.getWorksheet(sheet.name)!.getCell('B9').value).toBe(13000)
  })
  it('reads exact hidden named-range category choices and inline options without changing the original file', async () => {
    const { workbook, sheet, options } = fixture()
    const paths = ['가구/홈데코>가구>수납가구>선반>벽선반 (77939)', '가구/홈데코>가구>수납가구>선반>스탠드선반 (77940)']
    options.getCell('B2').value = paths[0]
    options.getCell('B3').value = paths[1]
    workbook.definedNames.add("'HQF_6_2379'!$B$2:$B$3", '_2379_categoryPath_1')
    sheet.getCell('C9').dataValidation = { type: 'list', formulae: ['_2379_categoryPath_1'], showErrorMessage: true }
    sheet.getCell('D9').dataValidation = { type: 'list', formulae: ['"브랜드 없음"'], showErrorMessage: false }
    sheet.getCell('E9').dataValidation = { type: 'list', formulae: ['"수입대상아님,수입상품,병행수입상품"'], showErrorMessage: true }
    sheet.getCell('C9').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC00' } }
    const { template, bytes, rows } = await parse(workbook)
    const columns = template.sheets[0].columns
    expect(columns.find((column) => column.label === '카테고리')).toMatchObject({ choices: paths, allowCustom: false })
    expect(columns.find((column) => column.label === '브랜드')).toMatchObject({ choices: ['브랜드 없음'], allowCustom: true })
    expect(columns.find((column) => column.label === '수입여부')).toMatchObject({ choices: ['수입대상아님', '수입상품', '병행수입상품'], allowCustom: false })
    expect(rows).toEqual([])
    expect(template.id).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(Buffer.from(template.file.data, 'base64')).toEqual(bytes)
    const preserved = new ExcelJS.Workbook()
    await preserved.xlsx.load(Buffer.from(template.file.data, 'base64') as unknown as ExcelJS.Buffer)
    expect(preserved.getWorksheet(sheet.name)!.getCell('C9').fill).toEqual(sheet.getCell('C9').fill)
    expect(preserved.getWorksheet(sheet.name)!.getCell('C9').dataValidation).toEqual(sheet.getCell('C9').dataValidation)
    expect(preserved.getWorksheet(options.name)!.state).toBe('veryHidden')
  })

  it('keeps warning and information validations editable and does not infer an unset category', async () => {
    const { workbook, sheet } = fixture()
    sheet.getCell('C9').dataValidation = { type: 'list', formulae: ['"스탠드선반"'], showErrorMessage: true }
    sheet.getCell('D9').dataValidation = { type: 'list', formulae: ['"브랜드 없음"'], showErrorMessage: true, errorStyle: 'warning' }
    sheet.getCell('E9').dataValidation = { type: 'list', formulae: ['"수입상품"'], showErrorMessage: true, errorStyle: 'information' }
    const { template, rows } = await parse(workbook)
    expect(template.sheets[0].columns.find((column) => column.label === '카테고리')).toMatchObject({ choices: ['스탠드선반'], allowCustom: false })
    expect(template.sheets[0].columns.find((column) => column.label === '브랜드')).toMatchObject({ choices: ['브랜드 없음'], allowCustom: true })
    expect(template.sheets[0].columns.find((column) => column.label === '수입여부')).toMatchObject({ choices: ['수입상품'], allowCustom: true })
    expect(rows).toEqual([])
  })

  it('omits external, formula-derived and oversized choice metadata without rejecting the workbook', async () => {
    const { workbook, sheet, options } = fixture()
    sheet.getRow(5).values = ['상품명', '공급가', '외부', '계산', '범위초과', '긴값', '긴목록', '수식목록', '未定義', '여러범위']
    sheet.getCell('C9').dataValidation = { type: 'list', formulae: ["'[external.xlsx]Sheet1'!$A$1:$A$2"] }
    options.getCell('B2').value = { formula: '"카테고리 추정 금지"', result: '캐시된 선택지' }
    workbook.definedNames.add("'HQF_6_2379'!$B$2", '_calculated')
    sheet.getCell('D9').dataValidation = { type: 'list', formulae: ['_calculated'] }
    workbook.definedNames.add("'HQF_6_2379'!$C$1:$C$501", '_tooMany')
    sheet.getCell('E9').dataValidation = { type: 'list', formulae: ['_tooMany'] }
    options.getCell('D2').value = 'x'.repeat(2001)
    sheet.getCell('F9').dataValidation = { type: 'list', formulae: ["'HQF_6_2379'!$D$2"] }
    sheet.getCell('G9').dataValidation = { type: 'list', formulae: ['"' + Array.from({ length: 501 }, (_, index) => String(index)).join(',') + '"'] }
    sheet.getCell('H9').dataValidation = { type: 'list', formulae: ['INDIRECT("HQF_6_2379!B2")'] }
    sheet.getCell('I9').dataValidation = { type: 'list', formulae: ['_missingName'] }
    options.getCell('E2').value = '첫 범위'
    options.getCell('G4').value = '두번째 범위'
    workbook.definedNames.add("'HQF_6_2379'!$E$2", '_multiple')
    workbook.definedNames.add("'HQF_6_2379'!$G$4", '_multiple')
    sheet.getCell('J9').dataValidation = { type: 'list', formulae: ['_multiple'] }
    const { template } = await parse(workbook)
    for (const column of template.sheets[0].columns) {
      expect(column).not.toHaveProperty('choices')
      expect(column).not.toHaveProperty('allowCustom')
    }
  })
})

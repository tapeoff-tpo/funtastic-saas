// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readTemplate, buildRegistrationArchive } from '@/lib/coupang-registration/excel'
import { blankDraft } from '@/lib/coupang-registration/model'
import { compatibleSpreadsheetXml, loadRegistrationWorkbook } from '@/lib/coupang-registration/xlsx-compat'

const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

async function prefixedTemplate() {
  const workbook = new ExcelJS.Workbook()
  const hidden = workbook.addWorksheet('HQF_choices', { state: 'veryHidden' })
  hidden.getCell('A1').value = '가구 > 선반'
  hidden.getCell('A2').value = '가구 > 선반장'
  for (const [index, name] of ['QF_2379_선반', 'QF_100_파티용품'].entries()) {
    const sheet = workbook.addWorksheet(name)
    for (const [column, label] of ['상품명', '공급가', '카테고리', '참고정보', '크기'].entries()) {
      sheet.getCell(5, column + 2).value = label
      sheet.getCell(6, column + 2).value = column < 2 ? '필수' : '선택'
    }
    sheet.getCell('B9').value = `원본 상품 ${index + 1}`
    sheet.getCell('C9').value = 15000
    sheet.getCell('D9').value = '가구 > 선반'
    sheet.getCell('D9').dataValidation = { type: 'list', formulae: ["'HQF_choices'!$A$1:$A$2"], showErrorMessage: true }
    sheet.getCell('E9').value = { richText: [{ text: '문자열 <x:sheet> & x:row', font: { bold: true } }, { text: ' 보존' }] }
    sheet.getCell('F9').value = { formula: '"<x:formula>"', result: '<x:formula>' }
  }
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer())
  for (const entry of Object.values(zip.files)) {
    if (!/^xl\/.*\.xml$/.test(entry.name)) continue
    const xml = await entry.async('string')
    if (!xml.includes(`xmlns="${namespace}"`)) continue
    // Fixture only: ExcelJS writes all SpreadsheetML elements without a prefix.
    zip.file(entry.name, xml.replace(`xmlns="${namespace}"`, `xmlns:x="${namespace}"`).replace(/(<\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, '$1x:$2'))
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('Coupang SpreadsheetML namespace compatibility', () => {
  it('loads prefixed official sheets, hidden choices, rich text and formulas while retaining original bytes', async () => {
    const buffer = await prefixedTemplate()
    await expect(new ExcelJS.Workbook().xlsx.load(buffer as unknown as ExcelJS.Buffer)).rejects.toThrow()
    const before = Buffer.from(buffer)
    const { template, rows } = await readTemplate(buffer, '공식원본.xlsx')
    expect(template.id).toBe(createHash('sha256').update(before).digest('hex'))
    expect(Buffer.from(template.file.data, 'base64')).toEqual(before)
    expect(buffer).toEqual(before)
    expect(template.sheets.map((sheet) => sheet.name)).toEqual(['QF_2379_선반', 'QF_100_파티용품'])
    expect(template.sheets.every((sheet) => sheet.columns.length === 5)).toBe(true)
    expect(template.sheets[0].columns[2]).toMatchObject({ label: '카테고리', choices: ['가구 > 선반', '가구 > 선반장'], allowCustom: false })
    expect(rows.map((row) => row.name)).toEqual(['원본 상품 1', '원본 상품 2'])
    expect(rows[0].fields).toMatchObject({ 참고정보: '문자열 <x:sheet> & x:row 보존', 크기: '<x:formula>' })
    const loaded = await loadRegistrationWorkbook(buffer)
    expect(loaded.getWorksheet('HQF_choices')?.state).toBe('veryHidden')
    expect(loaded.getWorksheet('QF_2379_선반')?.getCell('F9').formula).toBe('"<x:formula>"')
    expect(loaded.getWorksheet('QF_2379_선반')?.getCell('E9').value).toMatchObject({ richText: [{ text: '문자열 <x:sheet> & x:row', font: { bold: true } }, { text: ' 보존' }] })

    const draft = { ...blankDraft(), templates: [template], rows: rows.map((row) => ({ ...row, primaryImage: 'https://cdn.tapeoff.kr/front.jpg', detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], label: 'https://cdn.tapeoff.kr/label.jpg' })) }
    const archive = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const result = await loadRegistrationWorkbook(await archive.file('견적서/공식원본_등록용.xlsx')!.async('nodebuffer'))
    expect(result.getWorksheet('HQF_choices')?.state).toBe('veryHidden')
    expect(result.getWorksheet('QF_2379_선반')?.getCell('D9').dataValidation.formulae).toEqual(["'HQF_choices'!$A$1:$A$2"])
  })

  it('changes only SpreadsheetML element names while preserving namespace shadowing and literal XML-like text', () => {
    const xml = `<x:root xmlns:x="${namespace}" xmlns:o="urn:other" x:flag="x:literal &amp; &lt;x:row&gt;"><x:t>text x:row &amp; &lt;x:sheet&gt;</x:t><o:extension xmlns:x="urn:other"><x:row>other namespace</x:row><unqualified>kept</unqualified></o:extension><x:t><![CDATA[literal <x:row> & value]]></x:t><!-- literal <x:row> --></x:root>`
    const result = compatibleSpreadsheetXml(xml)
    expect(result).toContain('<root ')
    expect(result).toContain(`<root xmlns:x="${namespace}"`)
    expect(result).toContain(`xmlns="${namespace}"`)
    expect(result).toContain('x:flag="x:literal &amp; &lt;x:row&gt;"')
    expect(result).toContain('<t>text x:row &amp; &lt;x:sheet&gt;</t>')
    expect(result).toContain('<x:row>other namespace</x:row>')
    expect(result).toContain('<unqualified xmlns="">kept</unqualified>')
    expect(result).toContain('<![CDATA[literal <x:row> & value]]>')
    expect(result).toContain('<!-- literal <x:row> -->')
  })

  it('leaves existing unprefixed and unrelated XML unchanged', () => {
    for (const xml of [`<workbook xmlns="${namespace}"><sheets /></workbook>`, '<other xmlns:q="urn:other"><q:row>text</q:row></other>']) {
      expect(compatibleSpreadsheetXml(xml)).toBe(xml)
    }
  })
})

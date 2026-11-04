// @vitest-environment node
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { buildRegistrationArchive, readTemplate } from '@/lib/coupang-registration/excel'
import { blankDraft, LABEL_FIELD, rowIssues } from '@/lib/coupang-registration/model'

async function fixture() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('QF_100_test')
  const hidden = workbook.addWorksheet('HQF_100', { state: 'veryHidden' })
  hidden.getCell('A1').value = 'protected metadata'
  sheet.getCell('B1').value = 'Retail_Categorized_Excel:Version186'
  const headers = ['상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD, '제조국', '고시명']
  headers.forEach((header, index) => { sheet.getCell(5, index + 2).value = header; sheet.getCell(6, index + 2).value = header === 'HTML 상품 상세 컨텐츠' || header === '고시명' ? '선택' : '필수' })
  for (const [index, name] of ['샘플 베이지', '제외할 상품'].entries()) {
    sheet.getCell(index + 9, 2).value = name
    sheet.getCell(index + 9, 3).value = 15000
    sheet.getCell(index + 9, 4).value = 20000
    sheet.getCell(index + 9, 5).value = 'old-front'
    sheet.getCell(index + 9, 6).value = 'old-detail'
    sheet.getCell(index + 9, 8).value = 'old-label'
    sheet.getCell(index + 9, 9).value = '중국'
    sheet.getCell(index + 9, 10).value = { formula: '"기타 재화"', result: '기타 재화' }
    sheet.getCell(index + 9, 9).dataValidation = { type: 'list', formulae: ['"중국,한국"'] }
  }
  const parsed = await readTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), 'sample.xlsx')
  const row = { ...parsed.rows[0], primaryImage: 'https://cdn.tapeoff.kr/front.jpg', detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], label: 'https://cdn.tapeoff.kr/label.jpg' }
  return { draft: { ...blankDraft(), templates: [parsed.template], rows: [row] }, parsed }
}

describe('official Coupang template round trip', () => {
  it('imports only populated products and preserves metadata, validation and formulas while replacing prices/images', async () => {
    const { draft, parsed } = await fixture()
    expect(parsed.rows).toHaveLength(2)
    expect(rowIssues(draft.rows[0], draft)).toEqual([])
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const file = zip.file('견적서/sample_등록용.xlsx')!
    const result = new ExcelJS.Workbook()
    await result.xlsx.load(await file.async('nodebuffer') as unknown as ExcelJS.Buffer)
    const sheet = result.getWorksheet('QF_100_test')!
    expect(sheet.getCell('B1').value).toBe('Retail_Categorized_Excel:Version186')
    expect(result.getWorksheet('HQF_100')!.state).toBe('veryHidden')
    expect(sheet.getCell('C9').value).toBe(15000)
    expect(sheet.getCell('D9').value).toBe(25000)
    expect(sheet.getCell('F9').value).toBeNull()
    expect(sheet.getCell('G9').value).toContain('<img ')
    expect(sheet.getCell('B10').value).toBeNull()
    expect(sheet.getCell('I9').dataValidation.type).toBe('list')
    expect(sheet.getCell('J10').formula).toBe('"기타 재화"')
  })
  it('blocks missing label attachments and requires a bundle review', async () => {
    const { draft } = await fixture()
    draft.rows[0].label = '찾을 수 없는 라벨'
    await expect(buildRegistrationArchive(draft)).rejects.toThrow('파일 또는 URL 확인')
    draft.rows[0].label = 'https://cdn.tapeoff.kr/label.jpg'
    draft.rows[0].name = '샘플 2개입 세트'
    await expect(buildRegistrationArchive(draft)).rejects.toThrow('묶음 구성')
    draft.rows[0].bundleReviewed = true
    expect(rowIssues(draft.rows[0], draft)).toEqual([])
  })
  it('revalidates actual template headers and rejects forged file identity', async () => {
    const { draft } = await fixture()
    draft.templates[0].sheets[0].columns = []
    draft.rows[0].fields['제조국'] = ''
    await expect(buildRegistrationArchive(draft)).rejects.toThrow('제조국 누락')
    draft.templates[0].id = 'changed'; draft.rows[0].templateId = 'changed'
    await expect(buildRegistrationArchive(draft)).rejects.toThrow('다시 불러와주세요')
  })
})

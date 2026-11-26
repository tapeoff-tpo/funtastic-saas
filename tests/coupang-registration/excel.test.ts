// @vitest-environment node
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { buildRegistrationArchive, buildRegistrationDownload, readTemplate } from '@/lib/coupang-registration/excel'
import { applyRegistrationDefaults, AS_CONTACT_DEFAULT, AS_CONTACT_FIELD, blankDraft, calculatePrice, LABEL_FIELD, rowIssues, SEARCH_TAGS_FIELD, WARRANTY_DEFAULT, WARRANTY_FIELD } from '@/lib/coupang-registration/model'
import { draftSchema } from '@/lib/coupang-registration/schema'

const requiredFields = { [SEARCH_TAGS_FIELD]: '선반,수납', [WARRANTY_FIELD]: WARRANTY_DEFAULT, [AS_CONTACT_FIELD]: AS_CONTACT_DEFAULT }

async function fixture(requiredNotice = false) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('QF_100_test')
  const hidden = workbook.addWorksheet('HQF_100', { state: 'veryHidden' })
  hidden.getCell('A1').value = 'protected metadata'
  sheet.getCell('B1').value = 'Retail_Categorized_Excel:Version186'
  const headers = ['상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD, '제조국', '고시명']
  headers.forEach((header, index) => { sheet.getCell(5, index + 2).value = header; sheet.getCell(6, index + 2).value = header === 'HTML 상품 상세 컨텐츠' || header === '고시명' && !requiredNotice ? '선택' : '필수' })
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
  const row = { ...parsed.rows[0], fields: { ...parsed.rows[0].fields, ...requiredFields }, primaryImage: 'https://cdn.tapeoff.kr/front.jpg', detailImages: ['https://cdn.tapeoff.kr/detail.jpg'], label: 'https://cdn.tapeoff.kr/label.jpg' }
  return { draft: { ...blankDraft(), templates: [parsed.template], rows: [row] }, parsed }
}

describe('official Coupang template round trip', () => {
  it('writes the agreed model name, country and consumer contact into the original notice headers', async () => {
    const { draft } = await fixture()
    const original = new ExcelJS.Workbook()
    await original.xlsx.load(Buffer.from(draft.templates[0].file.data, 'base64') as unknown as ExcelJS.Buffer)
    const source = original.getWorksheet('QF_100_test')!
    const headers = ['품명 및 모델명', '제조국(원산지)', '소비자상담 관련 전화번호']
    headers.forEach((header, index) => { source.getCell(5, index + 11).value = header; source.getCell(6, index + 11).value = '필수' })
    const parsed = await readTemplate(Buffer.from(await original.xlsx.writeBuffer()), 'sample.xlsx')
    draft.templates = [parsed.template]
    const entry = { ...draft.rows[0], name: '마미백 플러스 베이지', templateId: parsed.template.id, sheetName: parsed.template.sheets[0].name }
    draft.rows = [applyRegistrationDefaults(entry, parsed.template.sheets[0])]
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const result = new ExcelJS.Workbook()
    await result.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    const sheet = result.getWorksheet('QF_100_test')!
    expect(headers.map((_, index) => sheet.getCell(5, index + 11).value)).toEqual(headers)
    expect(['B9', 'K9', 'L9', 'M9'].map(address => sheet.getCell(address).value)).toEqual(['마미백 플러스 베이지', '마미백 플러스 베이지', '중국', '1577-7011'])
  })

  it('imports only populated products and preserves metadata, validation and formulas while replacing prices/images', async () => {
    const { draft, parsed } = await fixture()
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ saleMode: 'manual', manualSalePrice: 20000 })
    expect(rowIssues(draft.rows[0], draft)).toEqual([])
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const file = zip.file('견적서/sample_등록용.xlsx')!
    const result = new ExcelJS.Workbook()
    await result.xlsx.load(await file.async('nodebuffer') as unknown as ExcelJS.Buffer)
    const sheet = result.getWorksheet('QF_100_test')!
    expect(sheet.getCell('B1').value).toBe('Retail_Categorized_Excel:Version186')
    expect(result.getWorksheet('HQF_100')!.state).toBe('veryHidden')
    expect(sheet.getCell('C9').value).toBe(15000)
    expect(sheet.getCell('D9').value).toBe(20000)
    expect(sheet.getCell('F9').value).toBeNull()
    expect(sheet.getCell('G9').value).toContain('<img ')
    expect(sheet.getCell('B10').value).toBeNull()
    expect(sheet.getCell('I9').dataValidation.type).toBe('list')
    expect(sheet.getCell('J9').formula).toBe('"기타 재화"')
    expect(sheet.getCell('J10').formula).toBe('"기타 재화"')
  })
  it('keeps required category-derived notices automatic for old drafts and expands formulas to extra rows', async () => {
    const { draft, parsed } = await fixture(true)
    expect(parsed.template.sheets[0].columns.find((column) => column.label === '고시명')?.autoGenerated).toBe(true)
    draft.rows[0].fields['고시명'] = '수동으로 덮어쓰면 안 됨'
    draft.templates[0].sheets[0].columns = draft.templates[0].sheets[0].columns.map((column) => {
      const legacy = { ...column }
      delete legacy.autoGenerated
      return legacy
    })
    expect(rowIssues({ ...draft.rows[0], fields: { ...draft.rows[0].fields, 고시명: '' } }, draft)).toEqual([])
    draft.rows.push({ ...draft.rows[0], id: 'second', name: '둘째 상품' }, { ...draft.rows[0], id: 'third', name: '셋째 상품' })
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet('QF_100_test')!
    expect(sheet.getCell('J9').formula).toBe('"기타 재화"')
    expect(sheet.getCell('J11').formula).toBe('"기타 재화"')
  })
  it('translates relative category formula references when extra rows are needed', async () => {
    const { draft } = await fixture(true)
    const template = new ExcelJS.Workbook()
    await template.xlsx.load(Buffer.from(draft.templates[0].file.data, 'base64') as unknown as ExcelJS.Buffer)
    const source = template.getWorksheet('QF_100_test')!
    source.getCell('J9').value = { formula: 'IF(B9="","",HQF_100!$A$1)', result: '기타 재화' }
    source.getCell('J10').value = { formula: 'IF(B10="","",HQF_100!$A$1)', result: '기타 재화' }
    const parsed = await readTemplate(Buffer.from(await template.xlsx.writeBuffer()), 'relative.xlsx')
    draft.templates = [parsed.template]
    draft.rows = [0, 1, 2].map((index) => ({ ...draft.rows[0], id: `relative-${index}`, templateId: parsed.template.id }))
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await zip.file('견적서/relative_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('QF_100_test')!.getCell('J11').formula).toBe('IF(B11="","",HQF_100!$A$1)')
  })
  it('exports only the selected products without requiring unrelated incomplete rows', async () => {
    const { draft } = await fixture()
    draft.rows.push({ ...draft.rows[0], id: 'incomplete', name: '미완료 상품', label: '' })
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft, [draft.rows[0].id]))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('QF_100_test')!.getCell('B10').value).toBeNull()
    await expect(buildRegistrationArchive(draft, [])).rejects.toThrow('선택해주세요')
    await expect(buildRegistrationArchive(draft, ['missing'])).rejects.toThrow('찾을 수 없습니다')
  })
  it('downloads one original workbook directly and excludes unfinished and completed rows', async () => {
    const { draft } = await fixture()
    draft.rows[0].stage = 'information'
    draft.rows.push({ ...draft.rows[0], id: 'pricing', name: '미완료 가격설정', stage: 'pricing', label: '' }, { ...draft.rows[0], id: 'registered', name: '이전 등록상품', stage: 'registered', registrationCompletedAt: '2026-11-26', label: '' })
    const download = await buildRegistrationDownload(draft)
    expect(download.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(download.fileName).toBe('sample_등록용.xlsx')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(download.buffer as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('HQF_100')?.state).toBe('veryHidden')
    const sheet = workbook.getWorksheet('QF_100_test')!
    expect(sheet.getCell('B1').value).toBe('Retail_Categorized_Excel:Version186')
    expect(sheet.getCell('B9').value).toBe('샘플 베이지')
    expect(sheet.getCell('B10').value).toBeNull()
    expect(sheet.getCell('I9').dataValidation.type).toBe('list')
    expect(sheet.getCell('J9').formula).toBe('"기타 재화"')
    expect((await buildRegistrationDownload(draft, [draft.rows[0].id])).contentType).toBe(download.contentType)
  })

  it('bundles different original workbooks or used quality-label images in a ZIP', async () => {
    const { draft } = await fixture()
    draft.rows[0].stage = 'information'
    const original = new ExcelJS.Workbook()
    await original.xlsx.load(Buffer.from(draft.templates[0].file.data, 'base64') as unknown as ExcelJS.Buffer)
    original.getWorksheet('QF_100_test')!.getCell('B1').value = 'other original workbook'
    const other = await readTemplate(Buffer.from(await original.xlsx.writeBuffer()), '다른카테고리.xlsx')
    draft.templates.push(other.template)
    draft.rows.push({ ...draft.rows[0], id: 'other', templateId: other.template.id })
    const many = await buildRegistrationDownload(draft)
    expect(many.contentType).toBe('application/zip')
    const zip = await JSZip.loadAsync(many.buffer)
    expect(zip.file('견적서/sample_등록용.xlsx')).not.toBeNull()
    expect(zip.file('견적서/다른카테고리_등록용.xlsx')).not.toBeNull()
    draft.templates[1].name = 'sample.xlsx'
    draft.templates[1].file.name = 'sample.xlsx'
    const sameNames = await JSZip.loadAsync((await buildRegistrationDownload(draft)).buffer)
    expect(sameNames.file('견적서/sample_등록용.xlsx')).not.toBeNull()
    expect(sameNames.file('견적서/sample_2_등록용.xlsx')).not.toBeNull()
    const second = new ExcelJS.Workbook()
    await second.xlsx.load(await sameNames.file('견적서/sample_2_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(second.getWorksheet('QF_100_test')!.getCell('B1').value).toBe('other original workbook')

    const label = { name: '사용한라벨.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
    draft.labels = [label, { name: '미사용라벨.jpg', data: '' }]
    draft.rows[0].label = label.name
    const withLabel = await buildRegistrationDownload(draft, [draft.rows[0].id])
    expect(withLabel.contentType).toBe('application/zip')
    const labels = await JSZip.loadAsync(withLabel.buffer)
    expect(labels.file(`품질표시/${label.name}`)).not.toBeNull()
    expect(labels.file('품질표시/미사용라벨.jpg')).toBeNull()
    expect(labels.file('견적서/다른카테고리_등록용.xlsx')).toBeNull()
  })

  it('keeps only exported category sheets in direct downloads and ZIPs while preserving hidden template dependencies', async () => {
    const { draft } = await fixture()
    const original = new ExcelJS.Workbook()
    await original.xlsx.load(Buffer.from(draft.templates[0].file.data, 'base64') as unknown as ExcelJS.Buffer)
    for (const name of ['QF_200_worked', 'QF_300_unused']) {
      const sheet = original.addWorksheet(name)
      sheet.getCell('B1').value = 'Retail_Categorized_Excel:Version186'
      sheet.getRow(5).values = ['상품명', '공급가', '제조국', '고시명']
      sheet.getRow(6).values = ['필수', '필수', '필수', '필수']
      sheet.getRow(9).values = ['원본 예시 상품', 1000, '중국', { formula: 'HQF_100!$A$1', result: '기타 재화' }]
      sheet.getCell('C9').dataValidation = { type: 'list', formulae: ['"중국,한국"'] }
    }
    const parsed = await readTemplate(Buffer.from(await original.xlsx.writeBuffer()), 'sample.xlsx')
    draft.templates = [parsed.template]
    const first = { ...draft.rows[0], stage: 'information' as const, templateId: parsed.template.id }
    const second = { ...first, id: 'second-category', name: '두 번째 카테고리 상품', sheetName: 'QF_200_worked' }
    draft.rows = [first, second, { ...first, id: 'unworked', stage: 'pricing', sheetName: 'QF_300_unused', label: '' }]
    const savedFile = parsed.template.file.data
    const all = await buildRegistrationDownload(draft)
    expect(all.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(all.buffer as unknown as ExcelJS.Buffer)
    expect(workbook.worksheets.filter(sheet => sheet.name.startsWith('QF_')).map(sheet => sheet.name)).toEqual(['QF_100_test', 'QF_200_worked'])
    expect(workbook.getWorksheet('HQF_100')?.state).toBe('veryHidden')
    const worked = workbook.getWorksheet('QF_200_worked')!
    expect(worked.getCell('A9').value).toBe(second.name)
    expect(worked.getCell('C9').dataValidation.formulae).toEqual(['"중국,한국"'])
    expect(worked.getCell('D9').formula).toBe('HQF_100!$A$1')

    const selected = new ExcelJS.Workbook()
    await selected.xlsx.load((await buildRegistrationDownload(draft, [second.id])).buffer as unknown as ExcelJS.Buffer)
    expect(selected.worksheets.filter(sheet => sheet.name.startsWith('QF_')).map(sheet => sheet.name)).toEqual(['QF_200_worked'])
    const label = { name: '품질표시.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
    draft.labels = [label]
    draft.rows[1] = { ...second, label: label.name }
    const download = await buildRegistrationDownload(draft, [second.id])
    expect(download.contentType).toBe('application/zip')
    const zip = await JSZip.loadAsync(download.buffer)
    expect(zip.file(`품질표시/${label.name}`)).not.toBeNull()
    const zipped = new ExcelJS.Workbook()
    await zipped.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(zipped.worksheets.filter(sheet => sheet.name.startsWith('QF_')).map(sheet => sheet.name)).toEqual(['QF_200_worked'])
    expect(parsed.template.file.data).toBe(savedFile)
    const unchanged = new ExcelJS.Workbook()
    await unchanged.xlsx.load(Buffer.from(savedFile, 'base64') as unknown as ExcelJS.Buffer)
    expect(unchanged.getWorksheet('QF_300_unused')!.getCell('A9').value).toBe('원본 예시 상품')
  })

  it('rejects invalid download selection and rows outside the information stage', async () => {
    const { draft } = await fixture()
    const id = draft.rows[0].id
    await expect(buildRegistrationDownload(draft)).rejects.toThrow('2단계')
    await expect(buildRegistrationDownload(draft, [id])).rejects.toThrow('2단계')
    draft.rows[0].stage = 'information'
    await expect(buildRegistrationDownload(draft, [])).rejects.toThrow('선택해주세요')
    await expect(buildRegistrationDownload(draft, ['missing'])).rejects.toThrow('찾을 수 없습니다')
    await expect(buildRegistrationDownload(draft, [id, id])).rejects.toThrow('중복')
    draft.rows[0].stage = 'registered'
    await expect(buildRegistrationDownload(draft, [id])).rejects.toThrow('2단계')
  })

  it('exports direct price edits and blocks missing or below-supply retail', async () => {
    const { draft } = await fixture()
    Object.assign(draft.rows[0], { manualSupplyPrice: 12000, manualSalePrice: 19000 })
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('QF_100_test')!.getCell('C9').value).toBe(12000)
    expect(workbook.getWorksheet('QF_100_test')!.getCell('D9').value).toBe(19000)
    draft.rows[0].manualSalePrice = null
    await expect(buildRegistrationArchive(draft)).rejects.toThrow('판매가')
    draft.rows[0].manualSalePrice = 11000
    await expect(buildRegistrationArchive(draft)).rejects.toThrow('공급가 이상')
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
  it('puts converted Product Management quality-label JPGs into the Coupang ZIP and worksheet', async () => {
    const { draft } = await fixture()
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')
    const labels = [
      { name: '품질표시-abc-p1of2.jpg', data: jpeg },
      { name: '품질표시-abc-p2of2.jpg', data: jpeg },
    ]
    draft.labels = labels
    draft.rows[0].label = labels.map((label) => label.name).join(',')
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(draft))
    expect(zip.file(`품질표시/${labels[0].name}`)).not.toBeNull()
    expect(zip.file(`품질표시/${labels[1].name}`)).not.toBeNull()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('QF_100_test')!.getCell('H9').value).toBe(labels.map((label) => label.name).join(','))
  })
  it('exports the quantity-weighted set prices as one row after saving and reopening', async () => {
    const { draft } = await fixture()
    Object.assign(draft.rows[0], {
      name: '마미백 베이지 2개입', priceMode: 'wholesale', saleMode: 'auto', bundleReviewed: true,
      bundleComponents: [{
        sourceCode: '1471', optionName: '베이지', name: '마미백 플러스 베이지',
        internalSku: '112361-0001', quantity: 2, unitCost: 8776, unitWholesale: 14500,
      }],
    })
    const reopened = draftSchema.parse(JSON.parse(JSON.stringify(draft)))
    expect(calculatePrice(reopened.rows[0])).toMatchObject({ cost: 17552, wholesale: 29000, supply: 29000, sale: 48334 })
    const zip = await JSZip.loadAsync(await buildRegistrationArchive(reopened))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await zip.file('견적서/sample_등록용.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet('QF_100_test')!
    expect(sheet.getCell('B9').value).toBe('마미백 베이지 2개입')
    expect(sheet.getCell('C9').value).toBe(29000)
    expect(sheet.getCell('D9').value).toBe(48334)
    expect(sheet.getCell('B10').value).toBeNull()
    reopened.rows[0].bundleComponents!.push({
      sourceCode: '1480', optionName: '', name: '파우치', internalSku: 'POUCH-1',
      quantity: 3, unitCost: 500, unitWholesale: 2000,
    })
    expect(calculatePrice(reopened.rows[0], 100)).toMatchObject({ cost: 19052, wholesale: 35000, supply: 35000, sale: 58400 })
    reopened.rows[0].bundleComponents![0].unitCost = null
    expect(calculatePrice(reopened.rows[0]).profit).toBeNull()
    await expect(buildRegistrationArchive(reopened)).rejects.toThrow('구성품 원가')
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

// @vitest-environment node
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { buildCategoryContext } from '@/lib/coupang-registration/category-context'
import { buildIndividualProducts, individualRowIssues } from '@/lib/coupang-registration/individual'
import { blankDraft, createRegistrationRow, registrationFieldKey, type RegistrationDraft, type RegistrationRow, type TemplateSheet } from '@/lib/coupang-registration/model'

const primary = 'https://cdn.tapeoff.kr/products/1583/primary.jpg'
const detail = 'https://cdn.tapeoff.kr/products/1583/detail.jpg'
const jpg = createCanvas(600, 600).encodeSync('jpeg').toString('base64')
const label = { name: '윈터벨 품질표시.jpg', data: jpg }
const confirmedFields = {
  '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입': '해당사항없음',
  '전기용품 및 생활용품, 어린이 (KC) 인증번호': '해당사항없음',
  '방송통신 기자재 (EMC) 인증 번호': '해당사항없음',
  '안전기준적합확인 신고번호': '해당사항없음',
  '인증/허가 사항': '해당사항없음', 제조국: '중국',
  '박스 내 SKU 수량': '20', 유통기간: '0', '취급주의 사유': '해당사항없음',
}

function row(patch: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    ...createRegistrationRow(), id: 'green', sourceCode: '1241', sourceName: '윈터벨 크리스마스 트리 파티모자',
    name: '윈터벨 크리스마스 트리 파티모자 그린트리', optionName: '그린트리', stage: 'information',
    priceConfirmedAt: '2026-11-26T01:00:00.000Z', priceMode: 'manual', manualSupplyPrice: 3300,
    saleMode: 'manual', manualSalePrice: 5500, primaryImage: primary, thumbnails: [primary], detailImages: [detail],
    label: label.name,
    ...patch,
    fields: { ...confirmedFields, ...(patch.fields ?? { 제조사: 'Ningbo Guanghuan Arts & Crafts Co., Ltd.', '한 개 단품 포장 사이즈': '360*390*150', '한 개 단품 포장 무게': '85', 검색태그: '크리스마스용품,크리스마스모자,트리모자' }) },
  }
}

const draft = (...rows: RegistrationRow[]): RegistrationDraft => ({ ...blankDraft(), rows, labels: [label] })

describe('individual Supplier Hub product transfer', () => {
  it('builds the verified green product without any category Excel file', () => {
    const productRow = row()
    const source = draft(productRow)
    const before = structuredClone(source)
    const [product] = buildIndividualProducts(source, ['green'])
    expect(product).toMatchObject({
      id: 'green', name: productRow.name, modelName: productRow.name, brand: '생활살림',
      color: '그린트리', quantity: '1개', supplyPrice: 3300, sellingPrice: 5500,
      coupangBarcode: true, manufacturer: productRow.fields.제조사, importer: '테이포프주식회사',
      tradeType: '기타 도소매업자', taxType: '과세', importType: '수입상품',
      primaryImageUrl: primary, labelFiles: [label], labelImageUrls: [],
      logistics: { boxQuantity: 20, shelfLifeDays: 0, handlingReason: '해당사항없음', weightGrams: 85, dimensionsMm: [360, 390, 150] },
    })
    expect(product.detailHtml).toContain(detail)
    expect(product.detailHtml).not.toContain('base64')
    expect(product.tags).toEqual(['크리스마스용품', '크리스마스모자', '트리모자'])
    expect(product.notices).toEqual({
      '품명 및 모델명': productRow.name, '인증/허가 사항': '해당사항없음', '제조국(원산지)': '중국',
      '제조자(수입자)': `${productRow.fields.제조사} / 테이포프주식회사`, '소비자상담 관련 전화번호': '1577-7011',
    })
    expect(individualRowIssues(productRow, source)).toEqual([])
    expect(source).toEqual(before)
  })

  it('prioritizes the actual B2B classification search hints and preserves an explicit Hub path', () => {
    const context = buildCategoryContext({ code: '1241', name: '윈터벨 트리 파티모자', category: { name: '파티모자', naverCategoryName: '생활/건강 > 이벤트/파티용품 > 파티모자' }, tags: '트리모자' })
    const productRow = row({ fields: { ...row().fields, '쿠팡 카테고리 경로': '문구/오피스 > 파티용품 > 파티모자' } })
    const [product] = buildIndividualProducts(draft(productRow), ['green'], { '1241': context })
    expect(product.category.sourcePath).toBe(context.categoryPath)
    expect(product.category.sourceName).toBe('파티모자')
    expect(product.category.searchTerms[0]).toBe('파티모자')
    expect(product.category.hubPath).toBe('문구/오피스 > 파티용품 > 파티모자')
  })

  it('preserves manual choices and reports deliberate clears instead of restoring defaults', () => {
    const productRow = row({ fields: {
      ...row().fields, 브랜드: '직접 브랜드', 색상: '수정한 색상', 수량: '2개', 제조국: '대한민국',
      '과세 여부': '면세', 거래유형: '공식총판사', '박스 내 SKU 수량': '7',
      유통기간: '300', '취급주의 사유': '유리', 소비자상담관련전화번호: '02-1234-5678',
    } })
    const [product] = buildIndividualProducts(draft(productRow), ['green'])
    expect(product).toMatchObject({ brand: '직접 브랜드', color: '수정한 색상', quantity: '2개', taxType: '면세', tradeType: '공식총판사', logistics: { boxQuantity: 7, shelfLifeDays: 300, handlingReason: '유리' } })
    expect(product.notices['제조국(원산지)']).toBe('대한민국')
    expect(product.notices['소비자상담 관련 전화번호']).toBe('02-1234-5678')
    const cleared = { ...productRow, fields: { ...productRow.fields, 브랜드: '', 검색태그: '', '한 개 단품 포장 사이즈': '' } }
    expect(individualRowIssues(cleared, draft(cleared))).toEqual(expect.arrayContaining(['브랜드 누락', '검색태그 누락', '한 개 단품 포장 사이즈의 가로·세로·높이(mm)를 모두 입력해주세요.']))
  })

  it('resolves duplicate official columns through their scoped keys rather than another color', () => {
    const sheet: TemplateSheet = { name: 'QF_1_상품정보', columns: [
      { column: 1, label: '색상', requirement: '필수', guide: '' }, { column: 2, label: '색상', requirement: '필수', guide: '' },
    ] }
    const productRow = row({ templateId: 'template', sheetName: sheet.name })
    productRow.fields[registrationFieldKey(productRow, sheet, sheet.columns[0])] = '첫 번째 색상'
    productRow.fields[registrationFieldKey(productRow, sheet, sheet.columns[1])] = '두 번째 색상'
    const source = { ...draft(productRow), templates: [{ id: 'template', name: 'file.xlsx', sheets: [sheet], file: { name: 'file.xlsx', data: 'QQ==' } }] }
    expect(buildIndividualProducts(source, ['green'])[0].color).toBe('첫 번째 색상')
    productRow.fields[registrationFieldKey(productRow, sheet, sheet.columns[0])] = ''
    expect(individualRowIssues(productRow, source)).toContain('색상 누락')
  })

  it('uses all three known master dimensions with clearance but never invents a missing height', () => {
    const fields = { 제조사: '공장', 검색태그: '태그' }
    const master = { itemId: 'm', match: 'sku' as const, noticeSize: '34X37(cm)', noticeWeight: '85g', noticeMaterial: 'PET', noticeManufacturer: '공장', noticeCountry: '중국' }
    const incomplete = row({ fields, productMaster: master })
    expect(individualRowIssues(incomplete, draft(incomplete))).toContain('한 개 단품 포장 사이즈의 가로·세로·높이(mm)를 모두 입력해주세요.')
    const complete = { ...incomplete, productMaster: { ...master, noticeSize: '50x40x30cm' } }
    expect(buildIndividualProducts(draft(complete), ['green'])[0].logistics).toMatchObject({ dimensionsMm: [520, 420, 320], boxQuantity: 20, weightGrams: 85 })
  })

  it('requires confirmation for inferred certification, origin and logistics values before creating a job', () => {
    const productRow = row({ defaultedFields: { ...confirmedFields } })
    const issues = individualRowIssues(productRow, draft(productRow))
    expect(issues).toEqual(expect.arrayContaining([
      '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입 누락', '인증/허가 사항 누락', '제조국(원산지) 누락',
      '박스 내 SKU 수량을 입력해주세요.', '유통기간은 0 이상의 일수로 입력해주세요.', '취급주의 사유를 확인해주세요.',
    ]))
    expect(() => buildIndividualProducts(draft(productRow), ['green'])).toThrow('누락')
    const master = { itemId: 'm', match: 'sku' as const, noticeSize: '', noticeWeight: '', noticeMaterial: '', noticeManufacturer: '', noticeCountry: '대한민국' }
    const withMaster = row({ defaultedFields: { 제조국: '중국' }, productMaster: master })
    expect(buildIndividualProducts(draft(withMaster), ['green'])[0].notices['제조국(원산지)']).toBe('대한민국')
  })

  it('uses the explicit individual confirmation ahead of an older scoped template default', () => {
    const sheet: TemplateSheet = { name: 'QF_1', columns: [
      { column: 1, label: '제조국(원산지)', requirement: '필수', guide: '' },
      { column: 2, label: '제조국(원산지)', requirement: '필수', guide: '' },
    ] }
    const productRow = row({ templateId: 'template', sheetName: sheet.name })
    const key = registrationFieldKey(productRow, sheet, sheet.columns[0])
    productRow.fields[key] = '중국'
    productRow.defaultedFields = { [key]: '중국' }
    productRow.fields.제조국 = '대한민국'
    const source = { ...draft(productRow), templates: [{ id: 'template', name: 'file.xlsx', sheets: [sheet], file: { name: 'file.xlsx', data: 'QQ==' } }] }
    expect(buildIndividualProducts(source, ['green'])[0].notices['제조국(원산지)']).toBe('대한민국')
  })

  it('keeps public label URLs separate from small file attachments', () => {
    const productRow = row({ label: 'https://cdn.tapeoff.kr/quality/green.png' })
    const [product] = buildIndividualProducts(draft(productRow), ['green'])
    expect(product.labelFiles).toEqual([])
    expect(product.labelImageUrls).toEqual([productRow.label])
    expect(() => buildIndividualProducts(draft(row({ label: 'missing.jpg' })), ['green'])).toThrow('품질표시')
    expect(() => buildIndividualProducts({ ...draft(row()), labels: [{ name: label.name, data: 'JVBERi0xLjQ=' }] }, ['green'])).toThrow('품질표시 파일 형식')
  })

  it('rejects an unfinished price step, invalid URLs and invalid confirmed prices', () => {
    const unfinished = row({ stage: 'pricing' })
    expect(individualRowIssues(unfinished, draft(unfinished))).toContain('판매가설정을 완료한 상품만 개별등록할 수 있습니다.')
    const invalid = row({ manualSupplyPrice: 3300, manualSalePrice: 2000, primaryImage: 'javascript:alert(1)', detailImages: ['http://host/detail.jpg'] })
    expect(individualRowIssues(invalid, draft(invalid))).toEqual(expect.arrayContaining(['판매가는 공급가 이상으로 입력해주세요.', '대표이미지는 공개 HTTPS JPG·PNG 주소를 입력해주세요.', '상세이미지의 공개 HTTPS JPG·PNG 주소를 입력해주세요.']))
  })

  it('validates selected rows and unique names before transferring a batch', () => {
    expect(() => buildIndividualProducts(draft(row()), [])).toThrow('선택')
    expect(() => buildIndividualProducts(draft(row()), ['unknown'])).toThrow('찾을 수 없습니다')
    expect(() => buildIndividualProducts(draft(row()), ['green', 'green'])).toThrow('선택')
    expect(() => buildIndividualProducts(draft(row()), Array.from({ length: 21 }, (_, index) => String(index)))).toThrow('1~20개')
    expect(() => buildIndividualProducts(draft(row(), row({ id: 'duplicate' })), ['green', 'duplicate'])).toThrow('상품별로 구분')
  })
})

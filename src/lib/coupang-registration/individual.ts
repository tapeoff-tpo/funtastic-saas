import type { CategoryContext } from './category-context'
import {
  AS_CONTACT_DEFAULT, calculatePrice, detailHtml, getRegistrationStage, imageStem, isImageUrl,
  PACKAGING_SIZE_FIELD, PACKAGING_WEIGHT_FIELD, packedSizeFromNoticeSize, packedWeightFromNoticeWeight,
  registrationFieldValue, SEARCH_TAGS_FIELD, type RegistrationDraft, type RegistrationRow, type SavedFile,
} from './model'
import { QUALITY_LABEL_MAX_FILE_BYTES, QUALITY_LABEL_MAX_TOTAL_BYTES } from './quality-labels'

export type IndividualProduct = {
  id: string
  name: string
  sourceCode: string
  category: { sourcePath: string; sourceName: string; searchTerms: string[]; hubPath?: string }
  modelName: string
  brand: string
  color: string
  quantity: string
  supplyPrice: number
  sellingPrice: number
  barcode: string
  coupangBarcode: boolean
  manufacturer: string
  importer: string
  tradeType: string
  taxType: string
  importType: string
  tags: string[]
  size: string
  primaryImageUrl: string
  additionalImageUrls: string[]
  detailHtml: string
  alternativeText: string
  labelFiles: SavedFile[]
  labelImageUrls: string[]
  certifications: Record<string, string>
  notices: Record<string, string>
  logistics: { boxQuantity: number; shelfLifeDays: number; handlingReason: string; weightGrams: number; dimensionsMm: [number, number, number] }
}

export const INDIVIDUAL_MAX_PRODUCTS = 20
export const INDIVIDUAL_MAX_TRANSFER_BYTES = 4_000_000

const normalize = (value: string) => value.normalize('NFKC').replace(/[\s()*·]/g, '')
const distinct = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))]
const certHeaders = [
  '전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입',
  '전기용품 및 생활용품, 어린이 (KC) 인증번호',
  '방송통신 기자재 (EMC) 인증 번호', '안전기준적합확인 신고번호',
]

/** Resolve an official scoped column before a legacy label, preserving explicit clears. */
function fieldsFor(row: RegistrationRow, draft: RegistrationDraft) {
  const sheet = draft.templates.find(template => template.id === row.templateId)?.sheets.find(sheet => sheet.name === row.sheetName)
  return (aliases: string[], fallback = '', requireConfirmed = false, showUnconfirmed = false): string => {
    // An explicit confirmation entered in the individual-registration form
    // takes precedence over any older scoped template default.
    if (requireConfirmed) for (const alias of aliases) {
      const keys = Object.keys(row.fields).filter(key => !key.startsWith('@qf:') && normalize(key) === normalize(alias))
      // The individual form writes its exact label; a differently spaced
      // template label may also exist and retain its automatic default.
      keys.sort((a, b) => Number(b === alias) - Number(a === alias))
      for (const key of keys) {
        const value = row.fields[key].trim()
        if (!value || row.defaultedFields?.[key]?.trim() !== value) return value
      }
    }
    for (const alias of aliases) {
      const column = sheet?.columns.find(column => normalize(column.label) === normalize(alias))
      const scoped = column && registrationFieldValue(row, sheet!, column)
      if (scoped !== undefined) {
        const suggested = registrationFieldValue({ ...row, fields: row.defaultedFields ?? {} }, sheet!, column!)
        if (requireConfirmed && !showUnconfirmed && scoped.trim() && suggested !== undefined && scoped.trim() === suggested.trim()) return fallback.trim()
        return scoped.trim()
      }
      const key = Object.keys(row.fields).find(key => !key.startsWith('@qf:') && normalize(key) === normalize(alias))
      if (key !== undefined) {
        const value = row.fields[key].trim()
        if (requireConfirmed && !showUnconfirmed && value && row.defaultedFields?.[key]?.trim() === value) return fallback.trim()
        return value
      }
    }
    return fallback.trim()
  }
}

function dimensions(value: string): [number, number, number] | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:\(?\s*(mm|cm)\s*\)?)?$/i.exec(value.normalize('NFKC').trim())
  if (!match) return
  const factor = match[4]?.toLowerCase() === 'cm' ? 10 : 1
  const values = match.slice(1, 4).map(value => Number(value) * factor)
  return values.every(value => Number.isFinite(value) && value > 0 && value <= 100_000) ? values as [number, number, number] : undefined
}

function integer(value: string, allowZero = false): number {
  if (!/^\d+$/.test(value.trim())) return NaN
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= (allowZero ? 0 : 1) && number <= 1_000_000 ? number : NaN
}

function weight(value: string): number {
  return /^\d+(?:\.\d+)?\s*(?:kg|g|킬로그램|그램)?$/i.test(value.trim()) ? integer(packedWeightFromNoticeWeight(value)) : NaN
}

function labelFiles(row: RegistrationRow, draft: RegistrationDraft) {
  const references = distinct(row.label.split(','))
  const files: SavedFile[] = []
  const urls: string[] = []
  const missing: string[] = []
  for (const reference of references) {
    if (isImageUrl(reference)) { urls.push(reference); continue }
    const matches = draft.labels.filter(file => imageStem(file.name) === imageStem(reference))
    if (matches.length === 1) files.push(matches[0])
    else missing.push(reference)
  }
  return { files, urls, missing }
}

function validLabelFile(file: SavedFile) {
  if (file.name.length > 250 || !/^[^\\/\x00-\x1f]+\.(?:jpe?g|png)$/i.test(file.name) || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)
    || file.data.length % 4 || file.data.length * 3 / 4 > QUALITY_LABEL_MAX_FILE_BYTES + 2) return false
  const header = atob(file.data.slice(0, 16))
  return header.startsWith('\xff\xd8\xff') || header.startsWith('\x89PNG\r\n\x1a\n')
}

function productValues(row: RegistrationRow, draft: RegistrationDraft, context?: CategoryContext) {
  const field = fieldsFor(row, draft)
  const master = row.bundleComponents ? undefined : row.productMaster
  const prices = calculatePrice(row, draft.rounding)
  const packageDimensions = dimensions(field([PACKAGING_SIZE_FIELD], packedSizeFromNoticeSize(master?.noticeSize ?? '')))
  const manufacturer = field(['제조사', '제조자'], master?.noticeManufacturer ?? '')
  const importer = field(['수입자'], '테이포프주식회사')
  const barcode = field(['상품 바코드'], '바코드 없음(쿠팡 바코드 생성 요청)')
  const tags = distinct(field([SEARCH_TAGS_FIELD, '검색 태그', '상품키워드'], master?.productKeywords ?? '').split(/[,\n]/))
  const sourcePath = context?.categoryPath ?? field(['펀타스틱 카테고리', '펀타 카테고리', 'B2B 카테고리'])
  const sourceName = context?.categoryName ?? sourcePath.split('>').map(part => part.trim()).filter(Boolean).at(-1) ?? ''
  const hubPath = field(['쿠팡 카테고리 경로', '쿠팡 카테고리'])
  const imported = field(['수입여부'], '수입상품')
  const tradeType = field(['거래타입', '거래유형'], '기타 도소매업자')
  const handling = field(['취급주의 사유', '취급주의(사용)'], '', true)
  const size = field(['사이즈', '크기', '치수'], master?.noticeSize ?? '')
  const labels = labelFiles(row, draft)
  const product: IndividualProduct = {
    id: row.id, name: row.name.trim(), sourceCode: row.sourceCode,
    category: {
      sourcePath, sourceName,
      searchTerms: distinct([...(context?.queries ?? []), sourceName, row.sourceName || row.name, ...tags].map(value => value.slice(0, 200))).slice(0, 6),
      ...(hubPath ? { hubPath } : {}),
    },
    modelName: field(['모델명', '품명 및 모델명'], row.name),
    brand: field(['브랜드'], '생활살림'), color: field(['색상'], row.optionName),
    quantity: field(['수량'], row.bundleComponents ? '1세트' : '1개'),
    supplyPrice: prices.supply ?? NaN, sellingPrice: prices.sale ?? NaN,
    barcode, coupangBarcode: /바코드없음|쿠팡바코드생성요청/.test(normalize(barcode)),
    manufacturer, importer,
    tradeType: normalize(tradeType) === '기타도소매업자' ? '기타 도소매업자' : tradeType,
    taxType: field(['과세여부'], '과세'), importType: imported === '병행수입' ? '병행수입상품' : imported,
    tags, size,
    primaryImageUrl: row.primaryImage.trim(),
    additionalImageUrls: distinct(row.thumbnails).filter(url => url !== row.primaryImage.trim()),
    detailHtml: detailHtml(row.detailImages, row.name),
    alternativeText: field(['이미지 대체 텍스트', '대체텍스트'], `${row.name}${size ? `. 사이즈 ${size}` : ''}.`),
    labelFiles: labels.files, labelImageUrls: labels.urls,
    certifications: Object.fromEntries(certHeaders.map(header => [header, field([header], '', true)])),
    notices: {
      '품명 및 모델명': field(['품명 및 모델명'], row.name),
      '인증/허가 사항': field(['인증/허가 사항', '인증허가사항'], '', true),
      '제조국(원산지)': field(['제조국(원산지)', '제조국', '원산지'], master?.noticeCountry ?? '', true),
      '제조자(수입자)': field(['제조자(수입자)'], [manufacturer, importer].filter(Boolean).join(' / ')),
      '소비자상담 관련 전화번호': field(['소비자상담 관련 전화번호', 'A/S 책임자와 전화번호'], AS_CONTACT_DEFAULT),
    },
    logistics: {
      boxQuantity: integer(field(['박스 내 SKU 수량'], '', true)),
      shelfLifeDays: integer(field(['유통기간 *식품의 경우 소비기간 (일수기재)', '유통기간'], '', true), true),
      handlingReason: normalize(handling) === '해당없음' ? '해당사항없음' : handling,
      weightGrams: weight(field([PACKAGING_WEIGHT_FIELD], packedWeightFromNoticeWeight(master?.noticeWeight ?? ''))),
      dimensionsMm: packageDimensions ?? [NaN, NaN, NaN],
    },
  }
  return { product, labels }
}

/** Individual registration validates its own fields, without requiring an Excel template. */
export function individualRowIssues(row: RegistrationRow, draft: RegistrationDraft, context?: CategoryContext): string[] {
  const { product: value, labels } = productValues(row, draft, context)
  const issues: string[] = []
  if (getRegistrationStage(row) !== 'information') issues.push('판매가설정을 완료한 상품만 개별등록할 수 있습니다.')
  if (!value.name || value.name.length > 500) issues.push('등록 상품명을 500자 이내로 입력해주세요.')
  if (!Number.isFinite(value.supplyPrice) || value.supplyPrice < 1) issues.push('공급가를 1원 이상 입력해주세요.')
  if (!Number.isFinite(value.sellingPrice) || value.sellingPrice < value.supplyPrice) issues.push('판매가는 공급가 이상으로 입력해주세요.')
  if (row.bundleComponents && (!row.bundleComponents.length || !row.bundleReviewed)) issues.push('세트 구성과 등록단위 가격을 확인해주세요.')
  for (const [label, text] of Object.entries({ 모델명: value.modelName, 브랜드: value.brand, 색상: value.color, 수량: value.quantity, 제조사: value.manufacturer })) {
    if (!text) issues.push(`${label} 누락`)
  }
  if (!['제조사', '공식총판사', '공식대리점', '기타 도소매업자'].includes(value.tradeType)) issues.push('거래타입을 확인해주세요.')
  if (!['과세', '면세', '영세'].includes(value.taxType)) issues.push('과세여부를 확인해주세요.')
  if (!['수입대상아님', '수입상품', '병행수입상품'].includes(value.importType)) issues.push('수입여부를 확인해주세요.')
  if (value.importType !== '수입대상아님' && !value.importer) issues.push('수입자 누락')
  if (!value.coupangBarcode && !/^[A-Z\d-](?:[A-Z\d-]| (?! )){4,12}[A-Z\d-]$/.test(value.barcode)) issues.push('상품 바코드 또는 쿠팡 바코드 생성 요청을 확인해주세요.')
  if (!value.tags.length) issues.push('검색태그 누락')
  if (value.tags.length > 50 || value.tags.some(tag => tag.length > 200)) issues.push('검색태그 길이와 개수를 확인해주세요.')
  if (!isImageUrl(value.primaryImageUrl)) issues.push('대표이미지는 공개 HTTPS JPG·PNG 주소를 입력해주세요.')
  if (row.thumbnails.some(url => !isImageUrl(url)) || value.additionalImageUrls.length > 9) issues.push('추가이미지는 공개 HTTPS JPG·PNG 주소로 최대 9개까지 입력해주세요.')
  if (!value.detailHtml || row.detailImages.some(url => !isImageUrl(url))) issues.push('상세이미지의 공개 HTTPS JPG·PNG 주소를 입력해주세요.')
  if (!value.alternativeText || value.alternativeText.length > 500) issues.push('이미지 대체 텍스트를 500자 이내로 입력해주세요.')
  if (!row.label.trim() || labels.missing.length) issues.push('상품에 맞는 품질표시 이미지 파일을 연결해주세요.')
  if (labels.files.length + labels.urls.length > 10 || labels.files.some(file => !validLabelFile(file))) issues.push('품질표시 파일 형식 또는 용량을 확인해주세요.')
  if (labels.files.reduce((sum, file) => sum + file.data.length * 3 / 4, 0) > QUALITY_LABEL_MAX_TOTAL_BYTES) issues.push('품질표시 이미지 총용량은 2.4MB 이하여야 합니다.')
  const displayedField = fieldsFor(row, draft)
  for (const [header, text] of Object.entries(value.certifications)) {
    if (!text) issues.push(displayedField([header], '', true, true) ? `${header} 자동 입력값 확인 필요` : `${header} 누락`)
  }
  for (const [header, text] of Object.entries(value.notices)) {
    if (!text) {
      const aliases = header === '인증/허가 사항' ? [header, '인증허가사항']
        : header === '제조국(원산지)' ? [header, '제조국', '원산지'] : [header]
      issues.push(displayedField(aliases, '', true, true) ? `${header} 자동 입력값 확인 필요` : `${header} 누락`)
    }
  }
  if (!Number.isFinite(value.logistics.boxQuantity)) issues.push('박스 내 SKU 수량을 입력해주세요.')
  if (!Number.isFinite(value.logistics.shelfLifeDays)) issues.push('유통기간은 0 이상의 일수로 입력해주세요.')
  if (!['해당사항없음', '유리'].includes(value.logistics.handlingReason)) issues.push('취급주의 사유를 확인해주세요.')
  if (!Number.isFinite(value.logistics.weightGrams)) issues.push('한 개 단품 포장 무게(g)를 입력해주세요.')
  if (value.logistics.dimensionsMm.some(dimension => !Number.isFinite(dimension))) issues.push('한 개 단품 포장 사이즈의 가로·세로·높이(mm)를 모두 입력해주세요.')
  return [...new Set(issues)]
}

export function buildIndividualProducts(draft: RegistrationDraft, rowIds: readonly string[], contextsBySourceCode: Record<string, CategoryContext> = {}): IndividualProduct[] {
  const ids = new Set(rowIds)
  if (!ids.size || ids.size > INDIVIDUAL_MAX_PRODUCTS || ids.size !== rowIds.length) throw new Error('개별등록할 상품을 1~20개 선택해주세요.')
  const rows = draft.rows.filter(row => ids.has(row.id))
  if (rows.length !== ids.size) throw new Error('선택한 상품을 현재 작업에서 찾을 수 없습니다.')
  if (new Set(rows.map(row => row.name.trim())).size !== rows.length) throw new Error('등록 상품명에 옵션을 포함해 상품별로 구분해주세요.')
  const products = rows.map(row => {
    const context = contextsBySourceCode[row.sourceCode]
    const issues = individualRowIssues(row, draft, context)
    if (issues.length) throw new Error(`${row.name}: ${issues.slice(0, 3).join(', ')}`)
    return productValues(row, draft, context).product
  })
  if (new TextEncoder().encode(JSON.stringify(products)).byteLength > INDIVIDUAL_MAX_TRANSFER_BYTES) throw new Error('개별등록 품질표시 파일 용량이 큽니다. 상품을 나누어 등록해주세요.')
  return products
}

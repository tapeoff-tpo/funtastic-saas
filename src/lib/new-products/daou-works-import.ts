import { normalizeNewProductOptionDetails, type NewProductOptionDetail } from './option-details'
import type { NewProductInput } from './workflow'

export const DAOU_WORKS_STAGE_TEMPLATE = [
  { name: '1.제품서치(C)', tone: 'blue' },
  { name: '2.샘플 구매대기(SCM팀)', tone: 'violet' },
  { name: '3.샘플 중국도착 대기(C)', tone: 'cyan' },
  { name: '5.샘플 광주도착&본사검수(MD팀)', tone: 'teal' },
  { name: '6. 정보고시 제작 (디자인)', tone: 'amber' },
  { name: '9.구매대기(SCM팀)', tone: 'indigo' },
  { name: '10.입고대기(SCM팀)', tone: 'purple' },
  { name: '11.확정원가 입력(SCM팀)', tone: 'rose' },
  { name: '12.가격 산정대기(BM팀)', tone: 'orange' },
  { name: '13.상세페이지 완료대기(디자인팀)', tone: 'sky' },
  { name: '14-1.등록대기_자사몰(SCM팀)', tone: 'lime' },
  { name: '14-2.등록대기_도매A', tone: 'emerald' },
  { name: '15.등록완료', tone: 'green' },
  { name: '90. 보류', tone: 'slate' },
  { name: '999-1. 샘플 판매요청', tone: 'violet' },
  { name: '999-2. 샘플 판매완료', tone: 'green' },
  { name: '9999. 진행불가', tone: 'red' },
] as const

export type DaouWorksSourceData = {
  sourceId: string
  sourceStatus: string
  registeredAt: string | null
  registeredBy: string | null
  updatedAt: string | null
  updatedBy: string | null
  rawFields: Record<string, string>
  optionRows: Array<Record<string, string>>
  materialRows: Array<Record<string, string>>
  inquiryRows: Array<Record<string, string>>
}

export type DaouWorksImportValues = Omit<NewProductInput, 'stageId'>

export type DaouWorksImportItem = {
  sourceId: string
  sourceStatus: string
  values: DaouWorksImportValues
  source: DaouWorksSourceData
}

export type DaouWorksCsvParseResult = {
  items: DaouWorksImportItem[]
  rawRowCount: number
  statusCounts: Array<{ status: string; count: number }>
}

const HEADER = {
  id: '*ID',
  status: '상태',
  productNumber: '제품번호',
  productName: '제품명',
  sampleCode: '샘플가칭번호 ( BH-브랜드, PH-플랫폼)',
  requiredChecks: '필수 체크 사항',
  estimatedCost: '예상원가',
  historyNotes: '히스토리',
  referenceNotes: '비고 (참고사항)',
  chinaItemName: '중국사용 항목 (货源调查确认项目) - C',
  plannedSaleDate: '판매예정일',
  detailPageDueDate: '상세페이지 제작완료예정일',
  registeredProductName: '등록 상품명',
  englishName: '제품 영문명',
  packageInfoUrl: '패키지 정보 불러오기',
  packageProgressStatus: '패키지 진행완료 여부',
  packageStatus: '패키지 상태',
  koreanManualStatus: '한글 설명서 유무',
  declaredValue: '신고금액',
  b2bPrice: 'B2B 판매가 (도매)',
  b2cPrice: 'B2C 판매가 (소매)',
  carrier: '택배사',
  b2bShippingFee: 'B2B 택배비',
  b2cShippingFee: 'B2C 택배비',
  qualityNoticeStatus: '품질표시 작업 韩语标签准备',
  packageBoxDesign: '패키지 박스 디자인 定制盒子设计文件',
  packageManufacturer: '패키지 제조 定制生产地方',
  packagePacking: '패키지 포장 包装地方',
  sourceUrl: '제품 URL',
  memo1: '추가확인사항',
  discontinuedReason: '진행불가사유',
  otherNotes: '기타 참고사항',
  noticeMaterial: '재질 (C)',
  noticeManufacturer: '제조사 (C)',
  noticeCountry: '제조국',
  noticeSize: '제품 크기 (C)',
  noticeWeight: '무게 (C)',
  noticeCapacity: '용량 (C)',
  noticeFoodSafety: '[식약처]유리/도자기제품 필수확인 (C)',
  noticeComponents: '구성품',
  noticeSpecialNotes: '특이사항',
  registeredAt: '등록일',
  registeredBy: '등록자',
  updatedAt: '수정일',
  updatedBy: '수정자',
} as const

const OPTION_HEADERS = {
  optionName: '옵션-옵션명',
  sabangnetOptionCode: '옵션-사방넷코드(옵션)',
  sabangnetRegistered: '옵션-사방넷 등록',
  chinaUnitPriceCny: '옵션-원가(위안화) (C2)',
  unitShippingCny: '옵션-운송비 (C3)',
  productSize: '옵션-제품 낱개 패키지 사이즈 (C6)',
  bulkSize: '옵션-벌크 사이즈 (C4)',
  purchaseReferenceNotes: '옵션-구매 참고사항 (C5)',
  costKrw: '옵션-원가(원화)',
  previousCostKrw: '옵션-이전원가(원화)',
  exchangeRateKrw: '옵션-기준환율',
  b2bPrice: '옵션-B2B(도매) 옵션 추가금',
  b2cPrice: '옵션-B2C(소매) 옵션 추가금',
} as const

export async function parseDaouWorksCsvFile(file: File): Promise<DaouWorksCsvParseResult> {
  return parseDaouWorksCsvBuffer(await file.arrayBuffer())
}

export function parseDaouWorksCsvBuffer(buffer: ArrayBuffer): DaouWorksCsvParseResult {
  return parseDaouWorksCsvText(decodeCsv(buffer))
}

export function parseDaouWorksCsvText(text: string): DaouWorksCsvParseResult {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''))
  const [headerRow, ...dataRows] = rows
  if (!headerRow || headerRow.length === 0) throw new Error('CSV 파일에서 헤더를 찾지 못했습니다.')

  const headers = headerRow.map((value) => cleanHeader(value))
  const sourceIdIndex = headers.indexOf(HEADER.id)
  const statusIndex = headers.indexOf(HEADER.status)
  const productNameIndex = headers.indexOf(HEADER.productName)
  if (sourceIdIndex < 0 || statusIndex < 0 || productNameIndex < 0) {
    throw new Error('WORKS CSV에 *ID, 상태, 제품명 열이 모두 필요합니다.')
  }

  const groups = new Map<string, Array<Record<string, string>>>()
  for (const row of dataRows) {
    const values = Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]))
    const sourceId = normalizeSourceId(values[HEADER.id])
    if (!sourceId) continue
    const group = groups.get(sourceId)
    if (group) group.push(values)
    else groups.set(sourceId, [values])
  }

  const items: DaouWorksImportItem[] = []
  const statusCounts = new Map<string, number>()
  for (const [sourceId, sourceRows] of groups) {
    const item = buildImportItem(sourceId, sourceRows)
    if (!item) continue
    items.push(item)
    statusCounts.set(item.sourceStatus, (statusCounts.get(item.sourceStatus) ?? 0) + 1)
  }
  if (items.length === 0) throw new Error('가져올 WORKS 상품을 찾지 못했습니다.')

  return {
    items,
    rawRowCount: dataRows.length,
    statusCounts: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((left, right) => left.status.localeCompare(right.status, 'ko')),
  }
}

export function normalizeDaouWorksImportItems(input: unknown) {
  if (!Array.isArray(input)) return []
  const usedSourceIds = new Set<string>()
  const items: DaouWorksImportItem[] = []

  for (const entry of input.slice(0, 125)) {
    const record = asRecord(entry)
    const sourceId = normalizeSourceId(record.sourceId)
    const sourceStatus = nullableText(record.sourceStatus, 160)
    const values = normalizeImportValues(record.values)
    if (!sourceId || !sourceStatus || !values || usedSourceIds.has(sourceId)) continue
    usedSourceIds.add(sourceId)
    items.push({
      sourceId,
      sourceStatus,
      values,
      source: normalizeSourceData(record.source, { sourceId, sourceStatus }),
    })
  }

  return items
}

function buildImportItem(sourceId: string, rows: Array<Record<string, string>>): DaouWorksImportItem | null {
  const productName = valueFor(rows, HEADER.productName)
  const sourceStatus = valueFor(rows, HEADER.status)
  if (!productName || !sourceStatus) return null

  const optionRows = uniqueRows(rows.map((row) => prefixedValues(row, '옵션-')).filter(hasValues))
  const materialRows = uniqueRows(rows.map((row) => prefixedValues(row, '부자재 정보-')).filter(hasValues))
  const inquiryRows = uniqueRows(rows.map((row) => prefixedValues(row, '상품문의-')).filter(hasValues))
  const optionDetails = normalizeNewProductOptionDetails(optionRows
    .map((row, index) => toOptionDetail(row, sourceId, index))
    .filter((option): option is NewProductOptionDetail => option !== null))
  const optionNames = [...new Set(optionDetails.map((option) => option.optionName).filter((value): value is string => Boolean(value)))]
  const sourceRows = compactProductFields(rows)
  const source = {
    sourceId,
    sourceStatus,
    registeredAt: parseDaouWorksDate(valueFor(rows, HEADER.registeredAt)),
    registeredBy: valueFor(rows, HEADER.registeredBy),
    updatedAt: parseDaouWorksDate(valueFor(rows, HEADER.updatedAt)),
    updatedBy: valueFor(rows, HEADER.updatedBy),
    rawFields: sourceRows,
    optionRows,
    materialRows,
    inquiryRows,
  }

  const stoppedReason = joinNotes([
    ['진행불가사유', valueFor(rows, HEADER.discontinuedReason)],
    ['기타 참고사항', valueFor(rows, HEADER.otherNotes)],
  ])
  const firstOption = optionDetails[0]
  const values: DaouWorksImportValues = {
    sampleCode: valueFor(rows, HEADER.productNumber) ?? valueFor(rows, HEADER.sampleCode),
    productName,
    productOption: optionNames.length > 0 ? optionNames.join(' / ') : null,
    optionDetails,
    chinaUnitPriceCny: firstOption?.chinaUnitPriceCny ?? null,
    unitShippingCny: firstOption?.unitShippingCny ?? null,
    exchangeRateKrw: firstOption?.exchangeRateKrw ?? null,
    calculatedCostKrw: firstOption?.costKrw ?? null,
    domesticSaleUrl: valueFor(rows, '네이버 판매가 URL'),
    domesticSalePrice: null,
    detailPageUrl: null,
    memo1: valueFor(rows, HEADER.memo1),
    memo2: stoppedReason,
    englishName: valueFor(rows, HEADER.englishName),
    sourceUrl: valueFor(rows, HEADER.sourceUrl),
    requiredChecks: valueFor(rows, HEADER.requiredChecks),
    estimatedCost: numberValue(valueFor(rows, HEADER.estimatedCost)),
    historyNotes: valueFor(rows, HEADER.historyNotes),
    referenceNotes: valueFor(rows, HEADER.referenceNotes),
    chinaItemName: valueFor(rows, HEADER.chinaItemName),
    plannedSaleDate: dateOnly(valueFor(rows, HEADER.plannedSaleDate)),
    detailPageDueDate: dateOnly(valueFor(rows, HEADER.detailPageDueDate)),
    registeredProductName: valueFor(rows, HEADER.registeredProductName),
    packageInfoUrl: valueFor(rows, HEADER.packageInfoUrl),
    packageProgressStatus: inputText(valueFor(rows, HEADER.packageProgressStatus), 100),
    packageStatus: inputText(valueFor(rows, HEADER.packageStatus), 100),
    koreanManualStatus: inputText(valueFor(rows, HEADER.koreanManualStatus), 100),
    declaredValue: numberValue(valueFor(rows, HEADER.declaredValue)),
    b2bPrice: integerValue(valueFor(rows, HEADER.b2bPrice)),
    b2cPrice: integerValue(valueFor(rows, HEADER.b2cPrice)),
    carrier: inputText(valueFor(rows, HEADER.carrier), 100),
    b2bShippingFee: integerValue(valueFor(rows, HEADER.b2bShippingFee)),
    b2cShippingFee: integerValue(valueFor(rows, HEADER.b2cShippingFee)),
    qualityNoticeStatus: inputText(valueFor(rows, HEADER.qualityNoticeStatus), 100),
    packageBoxDesign: inputText(valueFor(rows, HEADER.packageBoxDesign), 100),
    packageManufacturer: inputText(valueFor(rows, HEADER.packageManufacturer), 100),
    packagePacking: inputText(valueFor(rows, HEADER.packagePacking), 100),
    sabangnetCode: firstOption?.sabangnetOptionCode ?? null,
    productKeywords: null,
    purchaseReferenceNotes: firstOption?.purchaseReferenceNotes ?? null,
    previousCostKrw: firstOption?.previousCostKrw ?? null,
    b2bOptionSurcharge: firstOption?.b2bPrice ?? null,
    b2cOptionSurcharge: firstOption?.b2cPrice ?? null,
    noticeMaterial: valueFor(rows, HEADER.noticeMaterial),
    noticeSize: valueFor(rows, HEADER.noticeSize),
    noticeManufacturer: valueFor(rows, HEADER.noticeManufacturer),
    noticeWeight: valueFor(rows, HEADER.noticeWeight),
    noticeCountry: valueFor(rows, HEADER.noticeCountry),
    noticeCapacity: valueFor(rows, HEADER.noticeCapacity),
    noticeFoodSafety: valueFor(rows, HEADER.noticeFoodSafety),
    noticeComponents: valueFor(rows, HEADER.noticeComponents),
    noticeSpecialNotes: valueFor(rows, HEADER.noticeSpecialNotes),
  }

  return { sourceId, sourceStatus, values, source }
}

function toOptionDetail(row: Record<string, string>, sourceId: string, index: number): NewProductOptionDetail | null {
  const optionName = nullableText(row[stripPrefix(OPTION_HEADERS.optionName)], 500)
  const sabangnetOptionCode = nullableText(row[stripPrefix(OPTION_HEADERS.sabangnetOptionCode)], 100)
  const chinaUnitPriceCny = numberValue(row[stripPrefix(OPTION_HEADERS.chinaUnitPriceCny)])
  const unitShippingCny = numberValue(row[stripPrefix(OPTION_HEADERS.unitShippingCny)])
  const productSize = nullableText(row[stripPrefix(OPTION_HEADERS.productSize)], 1_000)
  const bulkSize = nullableText(row[stripPrefix(OPTION_HEADERS.bulkSize)], 1_000)
  const purchaseReferenceNotes = nullableText(row[stripPrefix(OPTION_HEADERS.purchaseReferenceNotes)])
  const costKrw = integerValue(row[stripPrefix(OPTION_HEADERS.costKrw)])
  const previousCostKrw = integerValue(row[stripPrefix(OPTION_HEADERS.previousCostKrw)])
  const exchangeRateKrw = numberValue(row[stripPrefix(OPTION_HEADERS.exchangeRateKrw)])
  const b2bPrice = integerValue(row[stripPrefix(OPTION_HEADERS.b2bPrice)])
  const b2cPrice = integerValue(row[stripPrefix(OPTION_HEADERS.b2cPrice)])
  if (!optionName && !sabangnetOptionCode && chinaUnitPriceCny == null && unitShippingCny == null && !productSize && !bulkSize && !purchaseReferenceNotes && costKrw == null && previousCostKrw == null && exchangeRateKrw == null && b2bPrice == null && b2cPrice == null) {
    return null
  }

  const registered = cleanText(row[stripPrefix(OPTION_HEADERS.sabangnetRegistered)]).toUpperCase()
  return {
    id: `works-${sourceId}-${index + 1}`,
    optionName,
    sabangnetOptionCode,
    sabangnetRegistered: registered === 'Y' ? 'Y' : registered === 'N' ? 'N' : null,
    chinaUnitPriceCny,
    unitShippingCny,
    productSize,
    bulkSize,
    purchaseReferenceNotes,
    costKrw,
    previousCostKrw,
    exchangeRateKrw,
    b2bPrice,
    b2cPrice,
  }
}

function normalizeImportValues(input: unknown): DaouWorksImportValues | null {
  const value = asRecord(input)
  const productName = nullableText(value.productName, 500)
  if (!productName) return null
  return {
    sampleCode: nullableText(value.sampleCode, 200),
    productName,
    productOption: nullableText(value.productOption),
    optionDetails: normalizeNewProductOptionDetails(value.optionDetails),
    chinaUnitPriceCny: numberValue(value.chinaUnitPriceCny),
    unitShippingCny: numberValue(value.unitShippingCny),
    exchangeRateKrw: numberValue(value.exchangeRateKrw),
    calculatedCostKrw: integerValue(value.calculatedCostKrw),
    domesticSaleUrl: nullableText(value.domesticSaleUrl),
    domesticSalePrice: integerValue(value.domesticSalePrice),
    detailPageUrl: nullableText(value.detailPageUrl),
    memo1: nullableText(value.memo1),
    memo2: nullableText(value.memo2),
    englishName: nullableText(value.englishName),
    sourceUrl: nullableText(value.sourceUrl),
    requiredChecks: nullableText(value.requiredChecks),
    estimatedCost: numberValue(value.estimatedCost),
    historyNotes: nullableText(value.historyNotes),
    referenceNotes: nullableText(value.referenceNotes),
    chinaItemName: nullableText(value.chinaItemName),
    plannedSaleDate: dateOnly(value.plannedSaleDate),
    detailPageDueDate: dateOnly(value.detailPageDueDate),
    registeredProductName: nullableText(value.registeredProductName),
    packageInfoUrl: nullableText(value.packageInfoUrl),
    packageProgressStatus: inputText(value.packageProgressStatus, 100),
    packageStatus: inputText(value.packageStatus, 100),
    koreanManualStatus: inputText(value.koreanManualStatus, 100),
    declaredValue: numberValue(value.declaredValue),
    b2bPrice: integerValue(value.b2bPrice),
    b2cPrice: integerValue(value.b2cPrice),
    carrier: inputText(value.carrier, 100),
    b2bShippingFee: integerValue(value.b2bShippingFee),
    b2cShippingFee: integerValue(value.b2cShippingFee),
    qualityNoticeStatus: inputText(value.qualityNoticeStatus, 100),
    packageBoxDesign: inputText(value.packageBoxDesign, 100),
    packageManufacturer: inputText(value.packageManufacturer, 100),
    packagePacking: inputText(value.packagePacking, 100),
    sabangnetCode: inputText(value.sabangnetCode, 100),
    productKeywords: nullableText(value.productKeywords),
    purchaseReferenceNotes: nullableText(value.purchaseReferenceNotes),
    previousCostKrw: integerValue(value.previousCostKrw),
    b2bOptionSurcharge: integerValue(value.b2bOptionSurcharge),
    b2cOptionSurcharge: integerValue(value.b2cOptionSurcharge),
    noticeMaterial: nullableText(value.noticeMaterial),
    noticeSize: nullableText(value.noticeSize),
    noticeManufacturer: nullableText(value.noticeManufacturer),
    noticeWeight: nullableText(value.noticeWeight),
    noticeCountry: nullableText(value.noticeCountry),
    noticeCapacity: nullableText(value.noticeCapacity),
    noticeFoodSafety: nullableText(value.noticeFoodSafety),
    noticeComponents: nullableText(value.noticeComponents),
    noticeSpecialNotes: nullableText(value.noticeSpecialNotes),
  }
}

function normalizeSourceData(input: unknown, fallback: Pick<DaouWorksSourceData, 'sourceId' | 'sourceStatus'>): DaouWorksSourceData {
  const value = asRecord(input)
  return {
    sourceId: fallback.sourceId,
    sourceStatus: fallback.sourceStatus,
    registeredAt: dateTimeValue(value.registeredAt),
    registeredBy: nullableText(value.registeredBy, 500),
    updatedAt: dateTimeValue(value.updatedAt),
    updatedBy: nullableText(value.updatedBy, 500),
    rawFields: normalizeRow(value.rawFields, 300),
    optionRows: normalizeRows(value.optionRows, 200),
    materialRows: normalizeRows(value.materialRows, 200),
    inquiryRows: normalizeRows(value.inquiryRows, 200),
  }
}

function compactProductFields(rows: Array<Record<string, string>>) {
  const fieldNames = Object.keys(rows[0] ?? {})
  return Object.fromEntries(fieldNames
    .filter((header) => !header.startsWith('옵션-') && !header.startsWith('부자재 정보-') && !header.startsWith('상품문의-'))
    .map((header) => [header, valueFor(rows, header)])
    .filter((entry): entry is [string, string] => Boolean(entry[1])))
}

function prefixedValues(row: Record<string, string>, prefix: string) {
  return Object.fromEntries(Object.entries(row)
    .filter(([header]) => header.startsWith(prefix))
    .map(([header, value]) => [stripPrefix(header), value]))
}

function stripPrefix(header: string) {
  const separator = header.indexOf('-')
  return separator >= 0 ? header.slice(separator + 1) : header
}

function valueFor(rows: Array<Record<string, string>>, header: string) {
  for (const row of rows) {
    const value = cleanText(row[header])
    if (value && value.toLowerCase() !== 'null') return value
  }
  return null
}

function uniqueRows(rows: Array<Record<string, string>>) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = JSON.stringify(Object.entries(row).filter(([, value]) => cleanText(value)).sort(([left], [right]) => left.localeCompare(right, 'ko')))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasValues(row: Record<string, string>) {
  return Object.values(row).some((value) => Boolean(cleanText(value)))
}

function normalizeRows(input: unknown, maxRows: number) {
  if (!Array.isArray(input)) return []
  return input.slice(0, maxRows).map((row) => normalizeRow(row, 80)).filter(hasValues)
}

function normalizeRow(input: unknown, maxFields: number) {
  const row = asRecord(input)
  return Object.fromEntries(Object.entries(row)
    .slice(0, maxFields)
    .map(([key, value]) => [cleanHeader(key).slice(0, 300), nullableText(value, 20_000)])
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])))
}

function decodeCsv(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8
  if ((utf8.match(/�/g) ?? []).length / Math.max(utf8.length, 1) < 0.005) return utf8
  return new TextDecoder('euc-kr').decode(bytes)
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index]
    const next = text[index + 1]
    if (current === '"') {
      if (quoted && next === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (current === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((current === '\n' || current === '\r') && !quoted) {
      if (current === '\r' && next === '\n') index += 1
      row.push(value)
      value = ''
      if (row.some((cell) => cleanText(cell))) rows.push(row)
      row = []
    } else {
      value += current
    }
  }
  row.push(value)
  if (row.some((cell) => cleanText(cell))) rows.push(row)
  return rows
}

function normalizeSourceId(value: unknown) {
  return nullableText(value, 200)?.replace(/^['"]+|['"]+$/g, '').trim() || null
}

function inputText(value: unknown, maxLength: number) {
  const normalized = nullableText(value, maxLength)
  return normalized === '선택안함' ? null : normalized
}

function numberValue(value: unknown) {
  const normalized = cleanText(value).replace(/,/g, '').replace(/[^0-9.-]/g, '')
  if (!normalized || normalized === '-' || normalized.toLowerCase() === 'null') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function integerValue(value: unknown) {
  const number = numberValue(value)
  return number == null ? null : Math.round(number)
}

function dateOnly(value: unknown) {
  const matched = cleanText(value).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (!matched) return null
  const [, year, month, day] = matched
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseDaouWorksDate(value: unknown) {
  const matched = cleanText(value).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!matched) return null
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = matched
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}+09:00`
}

function dateTimeValue(value: unknown) {
  const normalized = nullableText(value, 100)
  if (!normalized) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return normalized
  return parseDaouWorksDate(normalized) ?? normalized
}

function joinNotes(entries: Array<[string, string | null]>) {
  const values = entries.filter(([, value]) => Boolean(value)).map(([label, value]) => `${label}: ${value}`)
  return values.length > 0 ? values.join('\n\n') : null
}

function cleanHeader(value: unknown) {
  return cleanText(value).replace(/\s+/g, ' ')
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function nullableText(value: unknown, maxLength = 20_000) {
  const normalized = cleanText(value)
  return normalized && normalized.toLowerCase() !== 'null' ? normalized.slice(0, maxLength) : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

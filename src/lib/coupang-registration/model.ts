export type PriceMode = 'wholesale' | 'markup' | 'manual'
export type SavedFile = { name: string; data: string }
export type TemplateColumn = { column: number; label: string; requirement: string; guide: string }
export type TemplateSheet = { name: string; columns: TemplateColumn[] }
export type TemplateInfo = { id: string; name: string; sheets: TemplateSheet[] }
export type RegistrationRow = {
  id: string
  templateId: string
  sheetName: string
  name: string
  optionName: string
  internalSku: string
  costPrice: number | null
  wholesalePrice: number | null
  priceMode: PriceMode
  markupPercent: number
  manualSupplyPrice: number | null
  saleMode?: 'auto' | 'manual'
  manualSalePrice?: number | null
  supplyDeductionPercent?: 0 | 10
  manualSalesVat?: number | null
  sourceCode: string
  sourceName: string
  sourceStatus: string
  bundleReviewed: boolean
  primaryImage: string
  thumbnails: string[]
  detailImages: string[]
  label: string
  fields: Record<string, string>
}
export type RegistrationDraft = {
  name: string
  rounding: number
  rows: RegistrationRow[]
  templates: Array<TemplateInfo & { file: SavedFile }>
  labels: SavedFile[]
}
export type CatalogProduct = {
  code: string
  name: string
  price: number | null
  status: string
  thumbnails: string[]
  detailImages: string[]
  options: Array<{ name: string; addPrice: number }>
  notice: Array<{ label: string; value: string }>
  costCandidates: CostCandidate[]
}
export type CostCandidate = { sku: string; name: string; optionName: string; costPrice: number | null; aliases?: string[] }
export type CostLookup = Pick<RegistrationRow, 'id' | 'internalSku' | 'name' | 'sourceName' | 'optionName'>

export const LABEL_FIELD = '제품 필수 표시사항 (라벨 또는 도안 이미지)'
export const MONEY_LIMIT = 1_000_000_000
export const blankDraft = (): RegistrationDraft => ({ name: '쿠팡 등록 준비', rounding: 1, rows: [], templates: [], labels: [] })

export function money(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const text = String(value).replaceAll(',', '').trim()
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 && number <= MONEY_LIMIT ? number : null
}

export function calculatePrice(row: Pick<RegistrationRow, 'costPrice' | 'wholesalePrice' | 'priceMode' | 'markupPercent' | 'manualSupplyPrice' | 'saleMode' | 'manualSalePrice' | 'supplyDeductionPercent' | 'manualSalesVat'>, rounding = 1) {
  const wholesale = money(row.wholesalePrice)
  const input = row.priceMode === 'manual' ? money(row.manualSupplyPrice)
    : wholesale === null ? null : wholesale * (row.priceMode === 'markup' ? 1 + row.markupPercent / 100 : 1)
  const supply = input === null || !Number.isFinite(input) || input < 1 || input > MONEY_LIMIT
    ? null : row.priceMode === 'manual' ? input : Math.round(input)
  const unit = [1, 10, 100, 1000].includes(rounding) ? rounding : 1
  // Integer arithmetic avoids 15,000 / 0.6 floating-point rounding surprises.
  const manualSale = money(row.manualSalePrice)
  const sale = row.saleMode === 'manual'
    ? manualSale === null || manualSale < 1 ? null : manualSale
    : supply === null ? null : Math.ceil(supply * 5 / (3 * unit)) * unit
  const cost = money(row.costPrice)
  // The 2026 proposal uses both the VAT-only formula and an additional 10% of supply.
  const salesVat = supply === null ? null : money(row.manualSalesVat) ?? supply / 11
  const deduction = supply === null ? null : supply * (row.supplyDeductionPercent === 10 ? 0.1 : 0)
  const profit = supply === null || cost === null || salesVat === null || deduction === null
    ? null : supply - cost - salesVat - deduction
  return { supply, sale, salesVat, deduction, profit, profitRate: profit === null || !supply ? null : profit / supply * 100, coupangRate: sale && supply ? (sale - supply) / sale * 100 : null }
}

export function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && /\.(jpe?g|png)$/i.test(url.pathname)
  } catch { return false }
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;')
}

export function detailHtml(urls: string[], name: string): string {
  const images = [...new Set(urls.map((url) => url.trim()).filter(isImageUrl))]
  if (!images.length) return ''
  return `<div style="max-width:1080px;margin:0 auto;">${images.map((url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)} 상품 상세" style="display:block;max-width:100%;height:auto;" />`).join('')}</div>`
}

export function imageStem(name: string) {
  return name.normalize('NFC').trim().split(/[/\\]/).pop()!.replace(/\.(jpg|jpeg|png)$/i, '')
}

export function rowFields(row: RegistrationRow, rounding: number, labels: SavedFile[] = []): Record<string, string> {
  const prices = calculatePrice(row, rounding)
  const fields: Record<string, string> = { ...row.fields, '상품명': row.name, '공급가': prices.supply === null ? '' : String(prices.supply), '쿠팡 판매가': prices.sale === null ? '' : String(prices.sale) }
  if (row.primaryImage) fields['대표이미지 파일명'] = row.primaryImage
  if (row.thumbnails.length) fields['추가이미지 파일명'] = row.thumbnails.filter((url) => url !== row.primaryImage).join(',')
  if (row.detailImages.length) {
    fields['상세이미지 파일명'] = ''
    fields['HTML 상품 상세 컨텐츠'] = detailHtml(row.detailImages, row.name)
  }
  fields[LABEL_FIELD] = row.label.split(',').map((value) => {
    const name = value.trim()
    return labels.find((file) => imageStem(file.name) === imageStem(name))?.name ?? name
  }).filter(Boolean).join(',')
  return fields
}

export function rowIssues(row: RegistrationRow, draft: RegistrationDraft): string[] {
  const issues: string[] = []
  const template = draft.templates.find((item) => item.id === row.templateId)
  const sheet = template?.sheets.find((item) => item.name === row.sheetName)
  if (!sheet) return ['쿠팡 견적서 카테고리를 선택해주세요.']
  const fields = rowFields(row, draft.rounding, draft.labels)
  const html = fields['HTML 상품 상세 컨텐츠']?.trim()
  for (const column of sheet.columns) {
    if (column.requirement !== '필수') continue
    if (column.label === '상세이미지 파일명' && html) continue
    if (!fields[column.label]?.trim()) issues.push(`${column.label} 누락`)
  }
  const prices = calculatePrice(row, draft.rounding)
  if (prices.supply === null) issues.push('공급가를 1원 이상 입력해주세요.')
  if (prices.sale === null) issues.push('판매가를 1원 이상 입력해주세요.')
  else if (prices.supply !== null && prices.sale < prices.supply) issues.push('판매가는 공급가 이상이어야 합니다.')
  if (/[2-9]\d*개입/.test(row.name) && !row.bundleReviewed) issues.push('묶음 구성과 등록단위 가격 확인 필요')
  for (const field of ['대표이미지 파일명', '추가이미지 파일명', '상세이미지 파일명', LABEL_FIELD]) {
    for (const value of (fields[field] ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
      if (isImageUrl(value)) continue
      if (field === LABEL_FIELD && draft.labels.some((file) => imageStem(file.name) === imageStem(value))) continue
      issues.push(`${field}: ${value} 파일 또는 URL 확인`)
    }
  }
  if (row.detailImages.some((url) => !isImageUrl(url))) issues.push('상세이미지는 공개 HTTPS JPG·PNG 주소를 입력해주세요.')
  if (fields['HTML 상품 상세 컨텐츠'] && fields['HTML 상품 상세 컨텐츠'].length > 32767) issues.push('상세 HTML이 엑셀 셀 길이 제한을 초과합니다.')
  return [...new Set(issues)]
}

export function createRegistrationRow(product?: CatalogProduct, optionName = ''): RegistrationRow {
  const option = product?.options.find((item) => item.name === optionName)
  const cost = product && resolveItemCost({ name: product.name, sourceName: product.name, optionName, internalSku: '' }, product.costCandidates)
  return {
    id: crypto.randomUUID(), templateId: '', sheetName: '', name: [product?.name ?? '', optionName].filter(Boolean).join(' '), optionName,
    internalSku: cost?.sku ?? '', costPrice: cost?.costPrice ?? null, wholesalePrice: product?.price === null || product?.price === undefined ? null : product.price + (option?.addPrice ?? 0),
    priceMode: 'wholesale', markupPercent: 20, manualSupplyPrice: null, saleMode: 'auto', manualSalePrice: null,
    sourceCode: product?.code ?? '', sourceName: product?.name ?? '', sourceStatus: product?.status ?? '', bundleReviewed: false,
    primaryImage: product?.thumbnails[0] ?? '', thumbnails: product?.thumbnails ?? [], detailImages: product?.detailImages ?? [], label: '', fields: {},
  }
}

export function normalizeOption(value: string) {
  return normalizeCostName(value).replaceAll('세트', 'set')
}

export function normalizeCostName(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

export function candidateNames(candidate: CostCandidate) {
  return [candidate.name, ...(candidate.aliases ?? [])].map(normalizeCostName).filter(Boolean)
}

export function resolveItemCost(row: Omit<CostLookup, 'id'>, candidates: CostCandidate[]) {
  if (row.internalSku) return candidates.find((item) => item.sku.toUpperCase() === row.internalSku.trim().toUpperCase())
  const base = normalizeCostName(row.sourceName || row.name)
  if (!base) return undefined
  const option = normalizeOption(row.optionName)
  const genericOption = !option || ['기본', '기본상품', '단품', '옵션없음'].includes(option)
  const exactBase = candidates.filter((item) => candidateNames(item).includes(base))
  const exactOptions = exactBase.filter((item) => normalizeOption(item.optionName) === option)
  const hasExactCost = exactOptions.some((item) => item.costPrice !== null)
  const matches = hasExactCost || !genericOption ? exactOptions : exactBase.filter((item) => normalizeOption(item.optionName))
  if (matches.length === 1) return matches[0]
  if (matches.length || row.sourceName || !genericOption) return undefined
  // A title imported from a quote can include the option even when the option field is empty.
  const withOption = candidates.filter((item) => item.optionName && candidateNames(item).some((name) => normalizeOption(name + item.optionName) === normalizeOption(row.name)))
  return withOption.length === 1 ? withOption[0] : undefined
}

export function matchCatalog(row: RegistrationRow, products: CatalogProduct[]): CatalogProduct | null {
  if (row.sourceCode) return products.find((product) => product.code === row.sourceCode) ?? null
  const matches = products.filter((product) => row.name === product.name || row.name.startsWith(`${product.name} `))
  // Prefer the longest exact base name; equally specific candidates stay unresolved.
  matches.sort((a, b) => b.name.length - a.name.length)
  return matches.length && (matches.length === 1 || matches[0].name.length > matches[1].name.length) ? matches[0] : null
}

export function attachCatalog(row: RegistrationRow, product: CatalogProduct): RegistrationRow {
  const suffix = row.name.slice(product.name.length).trim()
  const options = product.options.filter((option) => normalizeOption(option.name) === normalizeOption(row.optionName || suffix))
  const optionName = options.length === 1 ? options[0].name : row.optionName || suffix
  const cost = resolveItemCost({ ...row, sourceName: product.name, optionName }, product.costCandidates)
  return {
    ...row, sourceCode: product.code, sourceName: product.name, sourceStatus: product.status, optionName,
    // Imported supply prices and manually entered cost/wholesale prices are authoritative.
    costPrice: row.costPrice ?? cost?.costPrice ?? null,
    internalSku: row.internalSku || cost?.sku || '',
    wholesalePrice: row.wholesalePrice ?? (options.length === 1 && product.price !== null ? product.price + options[0].addPrice : null),
    primaryImage: isImageUrl(row.primaryImage) ? row.primaryImage : product.thumbnails[0] ?? '',
    thumbnails: product.thumbnails, detailImages: product.detailImages,
  }
}

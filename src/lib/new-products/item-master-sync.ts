export type NewProductItemMasterStage = {
  name: string
  position: number
  itemMasterStartPosition?: number
}

export type NewProductItemMasterValues = {
  productName: string
  registeredProductName: string | null
  englishName: string | null
  sourceUrl: string | null
  productOption: string | null
  sabangnetCode: string | null
  purchaseReferenceNotes: string | null
  chinaUnitPriceCny: number | null
  calculatedCostKrw: number | null
  previousCostKrw: number | null
  exchangeRateKrw: number | null
  b2bOptionSurcharge: number | null
  b2cOptionSurcharge: number | null
  b2bPrice: number | null
  b2cPrice: number | null
  noticeMaterial: string | null
  noticeSize: string | null
  noticeManufacturer: string | null
  noticeWeight: string | null
  noticeCountry: string | null
  noticeCapacity: string | null
  noticeFoodSafety: string | null
  noticeComponents: string | null
  noticeSpecialNotes: string | null
}

export function shouldSyncNewProductToItemMaster(stage: NewProductItemMasterStage) {
  return stage.position >= (stage.itemMasterStartPosition ?? 5)
    && !stage.name.includes('진행불가')
    && !stage.name.includes('진행보류')
}

export function buildNewProductItemMasterData(values: NewProductItemMasterValues) {
  const data: Record<string, string> = {}
  addText(data, '품목코드', values.sabangnetCode)
  addText(data, '품목명', values.registeredProductName || values.productName)
  addText(data, '규격정보', values.productOption)
  addText(data, '영문명', values.englishName)
  addText(data, '구매 URL', values.sourceUrl)
  addText(data, '구매참고사항', values.purchaseReferenceNotes)
  addNumber(data, '신규원가(元)', values.chinaUnitPriceCny)
  addNumber(data, 'works 신규 원가', values.calculatedCostKrw)
  addNumber(data, 'works 기존 원가', values.previousCostKrw)
  addNumber(data, '기준환율', values.exchangeRateKrw)
  addNumber(data, 'B2B옵션추가금', values.b2bOptionSurcharge)
  addNumber(data, 'B2C옵션추가금', values.b2cOptionSurcharge)
  addText(data, '재질', values.noticeMaterial)
  addText(data, '제품크기', values.noticeSize)
  addText(data, '제조사', values.noticeManufacturer)
  addText(data, '무게', values.noticeWeight)
  addText(data, '제조국', values.noticeCountry)
  addText(data, '용량', values.noticeCapacity)
  addText(data, '[식약처]유리/도자기제품 필수확인', values.noticeFoodSafety)
  addText(data, '구성품', values.noticeComponents)
  addText(data, '특이사항', values.noticeSpecialNotes)
  return data
}

function addText(target: Record<string, string>, key: string, value: string | null) {
  const normalized = value?.trim()
  if (normalized) target[key] = normalized
}

function addNumber(target: Record<string, string>, key: string, value: number | null) {
  if (value != null && Number.isFinite(value)) target[key] = String(value)
}

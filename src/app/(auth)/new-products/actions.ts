'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  createNewProduct,
  deleteNewProduct,
  deleteNewProducts,
  moveNewProducts,
  saveNewProductEditorLayout,
  saveNewProductStages,
  updateNewProduct,
  type NewProductEditorLayout,
  type NewProductInput,
} from '@/lib/new-products/workflow'

async function actionUser() {
  const user = await getCurrentUser()
  if (!user) throw new Error('로그인이 필요합니다.')
  return { userId: user.id, workspaceUserId: await getWorkspaceUserId(user.id) }
}

export async function createNewProductAction(input: {
  values: Record<string, unknown>
}) {
  try {
    const auth = await actionUser()
    const values = newProductValues(input.values)
    if (!values.productName) return { success: false as const, error: '제품명을 입력해주세요.' }
    if (!values.stageId) return { success: false as const, error: '진행 단계를 선택해주세요.' }
    const created = await createNewProduct({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      values,
    })
    revalidatePath('/new-products')
    revalidatePath('/costs')
    return { success: true as const, ...created }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function updateNewProductAction(input: {
  itemId: string
  values: Record<string, unknown>
}) {
  try {
    const auth = await actionUser()
    const values = newProductValues(input.values)
    if (!values.productName) return { success: false as const, error: '제품명을 입력해주세요.' }
    if (!values.stageId) return { success: false as const, error: '진행 단계를 선택해주세요.' }
    const itemMasterSync = await updateNewProduct({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      itemId: input.itemId,
      values,
    })
    revalidatePath('/new-products')
    revalidatePath('/costs')
    return { success: true as const, itemMasterSync }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function deleteNewProductAction(input: { itemId: string }) {
  try {
    const auth = await actionUser()
    const deleted = await deleteNewProduct({
      userId: auth.workspaceUserId,
      itemId: input.itemId,
    })
    if (!deleted) return { success: false as const, error: '삭제할 신상품을 찾을 수 없습니다.' }
    revalidatePath('/new-products')
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function deleteNewProductsAction(input: { itemIds: string[] }) {
  try {
    const auth = await actionUser()
    const itemIds = [...new Set(input.itemIds)].slice(0, 500)
    if (itemIds.length === 0) return { success: false as const, error: '삭제할 상품을 선택해주세요.' }
    const result = await deleteNewProducts({ userId: auth.workspaceUserId, itemIds })
    revalidatePath('/new-products')
    return { success: true as const, ...result }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function moveNewProductsAction(input: {
  itemIds: string[]
  stageId: string
  note?: string | null
}) {
  try {
    const auth = await actionUser()
    const result = await moveNewProducts({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      itemIds: input.itemIds,
      stageId: input.stageId,
      note: nullableText(input.note),
    })
    revalidatePath('/new-products')
    revalidatePath('/costs')
    return { success: true as const, ...result }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function saveNewProductStagesAction(input: {
  stages: Array<{ id?: string; name: string; tone: string }>
}) {
  try {
    const auth = await actionUser()
    await saveNewProductStages({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      stages: input.stages,
    })
    revalidatePath('/new-products')
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

export async function saveNewProductEditorLayoutAction(input: {
  layout: NewProductEditorLayout
}) {
  try {
    const auth = await actionUser()
    const layout = await saveNewProductEditorLayout({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      layout: input.layout,
    })
    revalidatePath('/new-products')
    return { success: true as const, layout }
  } catch (error) {
    return { success: false as const, error: message(error) }
  }
}

function newProductValues(values: Record<string, unknown>): NewProductInput {
  return {
    stageId: text(values.stageId),
    productName: text(values.productName).trim().slice(0, 500),
    sampleCode: nullableText(values.sampleCode, 200),
    productOption: nullableText(values.productOption),
    chinaUnitPriceCny: nullableNumber(values.chinaUnitPriceCny),
    unitShippingCny: nullableNumber(values.unitShippingCny),
    exchangeRateKrw: nullableNumber(values.exchangeRateKrw),
    calculatedCostKrw: nullableInteger(values.calculatedCostKrw),
    domesticSaleUrl: nullableText(values.domesticSaleUrl),
    domesticSalePrice: nullableInteger(values.domesticSalePrice),
    detailPageUrl: nullableText(values.detailPageUrl),
    memo1: nullableText(values.memo1),
    memo2: nullableText(values.memo2),
    englishName: nullableText(values.englishName),
    sourceUrl: nullableText(values.sourceUrl),
    requiredChecks: nullableText(values.requiredChecks),
    estimatedCost: nullableNumber(values.estimatedCost),
    historyNotes: nullableText(values.historyNotes),
    referenceNotes: nullableText(values.referenceNotes),
    chinaItemName: nullableText(values.chinaItemName),
    plannedSaleDate: nullableDate(values.plannedSaleDate),
    detailPageDueDate: nullableDate(values.detailPageDueDate),
    registeredProductName: nullableText(values.registeredProductName),
    packageInfoUrl: nullableText(values.packageInfoUrl),
    packageProgressStatus: nullableText(values.packageProgressStatus, 100),
    packageStatus: nullableText(values.packageStatus, 100),
    koreanManualStatus: nullableText(values.koreanManualStatus, 100),
    declaredValue: nullableNumber(values.declaredValue),
    b2bPrice: nullableInteger(values.b2bPrice),
    b2cPrice: nullableInteger(values.b2cPrice),
    carrier: nullableText(values.carrier, 100),
    b2bShippingFee: nullableInteger(values.b2bShippingFee),
    b2cShippingFee: nullableInteger(values.b2cShippingFee),
    qualityNoticeStatus: nullableText(values.qualityNoticeStatus, 100),
    packageBoxDesign: nullableText(values.packageBoxDesign, 100),
    packageManufacturer: nullableText(values.packageManufacturer, 100),
    packagePacking: nullableText(values.packagePacking, 100),
    sabangnetCode: nullableText(values.sabangnetCode, 100),
    productKeywords: nullableText(values.productKeywords),
    purchaseReferenceNotes: nullableText(values.purchaseReferenceNotes),
    previousCostKrw: nullableInteger(values.previousCostKrw),
    b2bOptionSurcharge: nullableInteger(values.b2bOptionSurcharge),
    b2cOptionSurcharge: nullableInteger(values.b2cOptionSurcharge),
    noticeMaterial: nullableText(values.noticeMaterial),
    noticeSize: nullableText(values.noticeSize),
    noticeManufacturer: nullableText(values.noticeManufacturer),
    noticeWeight: nullableText(values.noticeWeight),
    noticeCountry: nullableText(values.noticeCountry),
    noticeCapacity: nullableText(values.noticeCapacity),
    noticeFoodSafety: nullableText(values.noticeFoodSafety),
    noticeComponents: nullableText(values.noticeComponents),
    noticeSpecialNotes: nullableText(values.noticeSpecialNotes),
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nullableText(value: unknown, maxLength = 20_000) {
  const normalized = text(value).trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function nullableNumber(value: unknown) {
  const normalized = text(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function nullableInteger(value: unknown) {
  const parsed = nullableNumber(value)
  return parsed == null ? null : Math.round(parsed)
}

function nullableDate(value: unknown) {
  const normalized = text(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.'
}

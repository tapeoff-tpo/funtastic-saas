'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  createNewProduct,
  moveNewProducts,
  saveNewProductStages,
  updateNewProduct,
  type NewProductInput,
} from '@/lib/new-products/workflow'

async function actionUser() {
  const user = await getCurrentUser()
  if (!user) throw new Error('로그인이 필요합니다.')
  return { userId: user.id, workspaceUserId: await getWorkspaceUserId(user.id) }
}

export async function createNewProductAction(input: {
  productName: string
  sampleCode?: string | null
  stageId: string
}) {
  try {
    const auth = await actionUser()
    const productName = input.productName.trim()
    if (!productName) return { success: false as const, error: '제품명을 입력해주세요.' }
    const created = await createNewProduct({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      productName: productName.slice(0, 500),
      sampleCode: nullableText(input.sampleCode, 200),
      stageId: input.stageId,
    })
    revalidatePath('/new-products')
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
    const productName = text(input.values.productName).trim()
    const stageId = text(input.values.stageId)
    if (!productName) return { success: false as const, error: '제품명을 입력해주세요.' }
    if (!stageId) return { success: false as const, error: '진행 단계를 선택해주세요.' }

    const values: NewProductInput = {
      stageId,
      productName: productName.slice(0, 500),
      sampleCode: nullableText(input.values.sampleCode, 200),
      englishName: nullableText(input.values.englishName),
      sourceUrl: nullableText(input.values.sourceUrl),
      requiredChecks: nullableText(input.values.requiredChecks),
      estimatedCost: nullableNumber(input.values.estimatedCost),
      historyNotes: nullableText(input.values.historyNotes),
      referenceNotes: nullableText(input.values.referenceNotes),
      chinaItemName: nullableText(input.values.chinaItemName),
      plannedSaleDate: nullableDate(input.values.plannedSaleDate),
      detailPageDueDate: nullableDate(input.values.detailPageDueDate),
      registeredProductName: nullableText(input.values.registeredProductName),
      packageInfoUrl: nullableText(input.values.packageInfoUrl),
      packageProgressStatus: nullableText(input.values.packageProgressStatus, 100),
      packageStatus: nullableText(input.values.packageStatus, 100),
      koreanManualStatus: nullableText(input.values.koreanManualStatus, 100),
      declaredValue: nullableNumber(input.values.declaredValue),
      b2bPrice: nullableInteger(input.values.b2bPrice),
      b2cPrice: nullableInteger(input.values.b2cPrice),
      carrier: nullableText(input.values.carrier, 100),
      b2bShippingFee: nullableInteger(input.values.b2bShippingFee),
      b2cShippingFee: nullableInteger(input.values.b2cShippingFee),
      qualityNoticeStatus: nullableText(input.values.qualityNoticeStatus, 100),
      packageBoxDesign: nullableText(input.values.packageBoxDesign, 100),
      packageManufacturer: nullableText(input.values.packageManufacturer, 100),
      packagePacking: nullableText(input.values.packagePacking, 100),
    }
    await updateNewProduct({
      userId: auth.workspaceUserId,
      requestedByUserId: auth.userId,
      itemId: input.itemId,
      values,
    })
    revalidatePath('/new-products')
    return { success: true as const }
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
    await saveNewProductStages({ userId: auth.workspaceUserId, stages: input.stages })
    revalidatePath('/new-products')
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: message(error) }
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

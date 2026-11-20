'use server'

import { assertMenuAccess } from '@/lib/auth/menu-access'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/auth/server'
import { CHINA_OUTBOUND_DESTINATIONS } from '@/lib/purchasing/china-outbound-destinations'
import type { ChinaOutboundBoxSplitSavedState } from '@/lib/purchasing/china-outbound-save-state'
import {
  applyChinaOutboundInventoryPacking,
  mergeChinaOutboundBoxes,
  saveChinaOutboundPackageWeight,
  saveChinaOutboundItemChineseName,
  addChinaOutboundSample,
  saveChinaOutboundPalletDimensions,
  saveChinaOutboundPalletTareWeight,
  addChinaOutboundShipmentItems,
  addChinaOutboundBox,
  addChinaOutboundBoxItem,
  addChinaOutboundPallet,
  adjustSaasChinaInventory,
  assignChinaOutboundBoxesToPallets,
  cancelChinaOutboundShipment,
  configureChinaOutboundPackaging,
  createSaasChinaOutboundWarehouse,
  createChinaOutboundShipment,
  deleteChinaOutboundShipment,
  dispatchChinaOutboundShipment,
  markChinaOutboundShipmentReady,
  receiveSaasChinaInventory,
  renameSaasChinaOutboundWarehouse,
  removeChinaOutboundBoxItem,
  saveChinaOutboundBoxDimensions,
  saveChinaOutboundBoxesMeasurements,
  saveChinaOutboundBoxCompletionStatuses,
  saveChinaOutboundItemBoxSplits,
  saveChinaOutboundItemPacking,
  saveChinaOutboundPalletCompletionStatuses,
  updateChinaOutboundShipment,
} from '@/lib/purchasing/saas-china-outbound'

type InventoryPackingSummary = Awaited<ReturnType<typeof applyChinaOutboundInventoryPacking>>
type ActionResult = { ok: true; shipmentId?: string; savedState?: ChinaOutboundBoxSplitSavedState; inventoryPacking?: InventoryPackingSummary } | { ok: false; error: string }

const text = (label: string, max = 500) => z.string().trim().min(1, `${label}을(를) 입력해주세요.`).max(max)
const optionalText = (max = 2_000) => z.string().trim().max(max).optional().nullable()
const inventoryId = z.string().uuid('재고 항목을 확인해주세요.')
const shipmentId = z.string().uuid('출고작업을 확인해주세요.')

const receiveSchema = z.object({
  warehouseCode: text('중국창고', 100),
  sku: text('품목코드', 100),
  productName: text('상품명', 1_000),
  optionName: optionalText(200),
  quantity: z.coerce.number().int().positive('수량은 1 이상의 정수여야 합니다.'),
  note: optionalText(),
})

const adjustSchema = z.object({
  inventoryId,
  delta: z.coerce.number().int().refine((value) => value !== 0, '조정 수량은 0이 아니어야 합니다.'),
  note: optionalText(),
})

const createOutboundWarehouseSchema = z.object({
  warehouseCode: text('새 출고창고명', 100),
})

const renameOutboundWarehouseSchema = z.object({
  warehouseCode: text('현재 출고창고명', 100),
  nextWarehouseCode: text('새 출고창고명', 100),
})

const createShipmentSchema = z.object({
  displayName: optionalText(200),
  shipmentNo: optionalText(100),
  destinationName: z.enum(CHINA_OUTBOUND_DESTINATIONS, { error: '도착지를 선택해주세요.' }),
  destinationAddress: optionalText(2_000),
  forwarderName: optionalText(200),
  externalReference: optionalText(200),
  plannedOutboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '출고예정일을 확인해주세요.').optional().nullable(),
  memo: optionalText(),
  lines: z.array(z.object({
    inventoryId,
    quantity: z.coerce.number().int().positive('출고 수량은 1 이상의 정수여야 합니다.'),
  })),
})

const addShipmentItemsSchema = z.object({
  shipmentId,
  lines: z.array(z.object({
    inventoryId,
    quantity: z.coerce.number().int().positive('추가 출고 수량은 1 이상의 정수여야 합니다.'),
  })).min(1, '추가할 상품을 하나 이상 선택해주세요.'),
})

const updateShipmentSchema = z.object({
  shipmentId,
  displayName: optionalText(200),
  plannedOutboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '출고예정일을 확인해주세요.').optional().nullable(),
})

const addPalletSchema = z.object({
  shipmentId,
  palletNo: text('파렛트 번호', 100),
  note: optionalText(),
})

const addBoxSchema = z.object({
  shipmentId,
  palletId: z.string().uuid('파렛트를 먼저 선택해주세요.'),
  boxNo: text('박스 번호', 100),
  note: optionalText(),
})

const addBoxItemSchema = z.object({
  shipmentId,
  boxId: z.string().uuid('박스를 확인해주세요.'),
  shipmentItemId: z.string().uuid('출고 상품을 확인해주세요.'),
  quantity: z.coerce.number().int().positive('박스 적재 수량은 1 이상의 정수여야 합니다.'),
})

const saveItemPackingSchema = z.object({
  shipmentId,
  shipmentItemId: z.string().uuid('출고 상품을 확인해주세요.'),
  allocations: z.array(z.object({
    palletNumber: z.coerce.number().int().positive('파렛트 번호는 1 이상의 정수여야 합니다.'),
    boxNumber: z.coerce.number().int().positive('박스 번호는 1 이상의 정수여야 합니다.'),
    quantity: z.coerce.number().int().positive('박스 적재 수량은 1 이상의 정수여야 합니다.'),
  })).max(5_000, '분할 박스는 5,000개 이하로 입력해주세요.'),
})

const splitDimension = z.coerce.number()
  .finite('박스 규격은 숫자로 입력해주세요.')
  .positive('박스 규격은 0보다 커야 합니다.')
  .max(9_999_999.99, '박스 규격이 너무 큽니다.')
  .nullable()
  .optional()

const manualCbm = z.number().finite('CBM은 숫자로 입력해주세요.').min(0.000001, 'CBM은 0.000001 이상으로 입력해주세요.').max(999_999_999, 'CBM이 너무 큽니다.').nullable().optional()

const saveItemBoxSplitsSchema = z.object({
  shipmentId,
  shipmentItemId: z.string().uuid('출고 상품을 확인해주세요.'),
  returnSavedState: z.boolean().optional(),
  boxSplitStatus: z.enum(['in_progress', 'completed']).optional(),
  allocations: z.array(z.object({
    boxNo: text('박스 번호', 100),
    existingBoxId: z.string().uuid('기존 박스를 확인해주세요.').optional(),
    autoNumber: z.boolean().optional(),
    quantity: z.coerce.number().int().positive('박스 적재 수량은 1 이상의 정수여야 합니다.'),
    lengthCm: splitDimension,
    widthCm: splitDimension,
    heightCm: splitDimension,
    grossWeightKg: z.number().finite('총중량은 숫자로 입력해주세요.').min(0.001, '총중량은 0.001kg 이상으로 입력해주세요.').max(999_999_999, '총중량이 너무 큽니다.').nullable().optional(),
    manualCbm,
  }).superRefine((value, context) => {
    const dimensions = [value.lengthCm, value.widthCm, value.heightCm]
    const filledCount = dimensions.filter((dimension) => dimension != null).length
    if (filledCount > 0 && filledCount < dimensions.length) {
      context.addIssue({ code: 'custom', message: '가로·세로·높이는 모두 입력하거나 모두 비워주세요.' })
    }
  })).max(5_000, '분할 박스는 5,000개 이하로 입력해주세요.'),
})

const assignPalletsSchema = z.object({
  shipmentId,
  assignments: z.array(z.object({
    boxNo: text('박스 번호', 100),
    palletNo: z.string().trim().max(100, '파렛트 번호는 100자 이하로 입력해주세요.').nullable(),
  })).max(5_000, '파렛트 배정은 5,000개 이하로 입력해주세요.'),
})

const completionStatus = z.enum(['in_progress', 'completed'])
const saveBoxCompletionStatusesSchema = z.object({
  shipmentId,
  updates: z.array(z.object({
    boxId: z.string().uuid('박스를 확인해주세요.'),
    status: completionStatus,
  })).min(1, '저장할 박스를 선택해주세요.').max(5_000),
})
const savePalletCompletionStatusesSchema = z.object({
  shipmentId,
  updates: z.array(z.object({
    palletId: z.string().uuid('파렛트를 확인해주세요.'),
    status: completionStatus,
  })).min(1, '저장할 파렛트를 선택해주세요.').max(5_000),
})

const configurePackagingSchema = z.object({
  shipmentId,
  palletCount: z.coerce.number().int().min(1, '파렛트 수는 1개 이상이어야 합니다.').max(500, '파렛트 수는 500개 이하로 입력해주세요.'),
  boxCount: z.coerce.number().int().min(1, '박스 수는 1개 이상이어야 합니다.').max(5_000, '박스 수는 5,000개 이하로 입력해주세요.'),
})

const boxDimension = z.coerce.number().finite('박스 규격은 숫자로 입력해주세요.').positive('박스 규격은 0보다 커야 합니다.').max(9_999_999.99, '박스 규격이 너무 큽니다.').nullable()
const saveBoxDimensionsSchema = z.object({
  shipmentId,
  boxId: z.string().uuid('박스를 확인해주세요.'),
  lengthCm: boxDimension,
  widthCm: boxDimension,
  heightCm: boxDimension,
  manualCbm,
}).superRefine((value, context) => {
  const dimensions = [value.lengthCm, value.widthCm, value.heightCm]
  const filledCount = dimensions.filter((dimension) => dimension != null).length
  if (filledCount > 0 && filledCount < dimensions.length) {
    context.addIssue({ code: 'custom', message: '가로·세로·높이는 모두 입력하거나 모두 비워주세요.' })
  }
})

const saveBoxesMeasurementsSchema = z.object({
  shipmentId,
  boxIds: z.array(z.string().uuid('박스를 확인해주세요.')).min(1, '수정할 박스를 선택해주세요.').max(5_000, '박스는 5,000개 이하로 선택해주세요.'),
  lengthCm: z.number().finite().positive().max(9_999_999.99).optional(),
  widthCm: z.number().finite().positive().max(9_999_999.99).optional(),
  heightCm: z.number().finite().positive().max(9_999_999.99).optional(),
  grossWeightKg: z.number().finite().min(0.001).max(999_999_999).optional(),
  manualCbm,
}).superRefine((value, context) => {
  const count = [value.lengthCm, value.widthCm, value.heightCm].filter((dimension) => dimension !== undefined).length
  if (count > 0 && count < 3) context.addIssue({ code: 'custom', message: '가로·세로·높이는 모두 입력해주세요.' })
  if (count === 0 && value.grossWeightKg === undefined && value.manualCbm === undefined) context.addIssue({ code: 'custom', message: '일괄 적용할 박스 규격, 총중량 또는 CBM을 입력해주세요.' })
})

const removeBoxItemSchema = z.object({
  shipmentId,
  boxItemId: z.string().uuid('박스 적재 항목을 확인해주세요.'),
})

export async function receiveSaasChinaInventoryAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/saas-china-inventory')
  return runAction(async () => {
    const value = receiveSchema.parse(input)
    const actor = await getActor()
    await receiveSaasChinaInventory({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function adjustSaasChinaInventoryAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/saas-china-inventory')
  return runAction(async () => {
    const value = adjustSchema.parse(input)
    const actor = await getActor()
    await adjustSaasChinaInventory({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function createSaasChinaOutboundWarehouseAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/saas-china-inventory', '/purchasing/china-shipments')
  return runAction(async () => {
    const value = createOutboundWarehouseSchema.parse(input)
    const actor = await getActor()
    await createSaasChinaOutboundWarehouse({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function renameSaasChinaOutboundWarehouseAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/saas-china-inventory', '/purchasing/china-shipments')
  return runAction(async () => {
    const value = renameOutboundWarehouseSchema.parse(input)
    const actor = await getActor()
    await renameSaasChinaOutboundWarehouse({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function createChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/saas-china-inventory', '/purchasing/china-shipments')
  return runAction(async () => {
    const value = createShipmentSchema.parse(input)
    const actor = await getActor()
    const shipment = await createChinaOutboundShipment({ ...value, ...actor }, { allowEmpty: true })
    revalidateSaasChinaPaths()
    return { shipmentId: shipment.id }
  })
}

export async function updateChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = updateShipmentSchema.parse(input)
    const actor = await getActor()
    await updateChinaOutboundShipment({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function addChinaOutboundPalletAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = addPalletSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundPallet({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function addChinaOutboundBoxAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = addBoxSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundBox({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function configureChinaOutboundPackagingAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = configurePackagingSchema.parse(input)
    const actor = await getActor()
    await configureChinaOutboundPackaging({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundBoxDimensionsAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = saveBoxDimensionsSchema.parse(input)
    const actor = await getActor()
    await saveChinaOutboundBoxDimensions({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundBoxesMeasurementsAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = saveBoxesMeasurementsSchema.parse(input)
    const actor = await getActor()
    await saveChinaOutboundBoxesMeasurements({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
    revalidatePath('/purchasing/import-documents')
  })
}

export async function addChinaOutboundBoxItemAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = addBoxItemSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundBoxItem({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundItemPackingAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = saveItemPackingSchema.parse(input)
    const actor = await getActor()
    await saveChinaOutboundItemPacking({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundItemBoxSplitsAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const { returnSavedState, ...value } = saveItemBoxSplitsSchema.parse(input)
    const actor = await getActor()
    const savedState = await saveChinaOutboundItemBoxSplits({ ...value, userId: actor.userId })
    // The packing board applies persisted rows directly. Avoid waiting for a
    // second complete server render (photos, labels, catalog and layout reads).
    if (returnSavedState) return { savedState }
    // Packing edits do not change inventory reservations or purchasing status.
    revalidatePath('/purchasing/china-shipments')
  })
}

export async function saveChinaOutboundBoxCompletionStatusesAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = saveBoxCompletionStatusesSchema.parse(input)
    const actor = await getActor()
    await saveChinaOutboundBoxCompletionStatuses({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundPalletCompletionStatusesAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = savePalletCompletionStatusesSchema.parse(input)
    const actor = await getActor()
    await saveChinaOutboundPalletCompletionStatuses({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function addChinaOutboundShipmentItemsAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = addShipmentItemsSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundShipmentItems({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function applyChinaOutboundInventoryPackingAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    const inventoryPacking = await applyChinaOutboundInventoryPacking({ ...value, userId: actor.userId })
    revalidatePath('/purchasing/china-shipments')
    revalidatePath('/purchasing/import-documents')
    return { inventoryPacking }
  })
}

export async function addChinaOutboundSampleAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({
      shipmentId, requestId: z.string().uuid(), productName: text('상품명', 1_000), chineseProductName: optionalText(1000),
      optionName: optionalText(200), warehouseCode: text('출고창고', 100),
      quantity: z.coerce.number().int().positive(), note: optionalText(),
    }).parse(input)
    const actor = await getActor()
    await addChinaOutboundSample({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function mergeChinaOutboundBoxesAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId, boxIds: z.array(z.string().uuid()).min(2).max(5000) }).parse(input)
    const actor = await getActor()
    await mergeChinaOutboundBoxes({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundPalletTareWeightAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId, palletId: z.string().uuid(), tareWeightKg: z.number().finite().min(0).max(999_999_999) }).parse(input)
    const actor = await getActor()
    await saveChinaOutboundPalletTareWeight({ ...value, userId: actor.userId })
    revalidatePath('/purchasing/china-shipments')
    revalidatePath('/purchasing/import-documents')
  })
}

export async function saveChinaOutboundPackageWeightAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId, kind: z.enum(['box', 'pallet']), packageId: z.string().uuid(), grossWeightKg: z.number().finite().positive().max(999_999_999) }).parse(input)
    const actor = await getActor()
    await saveChinaOutboundPackageWeight({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundItemChineseNameAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId, shipmentItemId: z.string().uuid(), chineseProductName: text('중국어 상품명', 1000) }).parse(input)
    const actor = await getActor()
    await saveChinaOutboundItemChineseName({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundPalletDimensionsAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId, palletId: z.string().uuid(), lengthCm: splitDimension, widthCm: splitDimension, heightCm: splitDimension, manualCbm }).superRefine((value, context) => {
      const count = [value.lengthCm, value.widthCm, value.heightCm].filter((dimension) => dimension != null).length
      if (count > 0 && count < 3) context.addIssue({ code: 'custom', message: '가로·세로·높이는 모두 입력하거나 모두 비워주세요.' })
      if ([value.lengthCm, value.widthCm, value.heightCm, value.manualCbm].every((value) => value === undefined)) context.addIssue({ code: 'custom', message: '파렛트 규격 또는 CBM을 입력해주세요.' })
    }).parse(input)
    const actor = await getActor()
    await saveChinaOutboundPalletDimensions({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function assignChinaOutboundBoxesToPalletsAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = assignPalletsSchema.parse(input)
    const actor = await getActor()
    await assignChinaOutboundBoxesToPallets({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function removeChinaOutboundBoxItemAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = removeBoxItemSchema.parse(input)
    const actor = await getActor()
    await removeChinaOutboundBoxItem({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function markChinaOutboundShipmentReadyAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await markChinaOutboundShipmentReady({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function dispatchChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await dispatchChinaOutboundShipment({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function cancelChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await cancelChinaOutboundShipment({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function deleteChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  await assertMenuAccess('/purchasing/china-shipments')
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await deleteChinaOutboundShipment({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

async function getActor() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('로그인이 필요합니다.')
  return {
    userId: await getWorkspaceUserId(user.id),
    createdBy: user.id,
  }
}

function revalidateSaasChinaPaths() {
  revalidatePath('/purchasing/saas-china-inventory')
  revalidatePath('/purchasing/china-shipments')
  // Shipment reservations, dispatches, and cancellations can move a linked
  // purchase row between China-arrived, outbound-requested, and completed.
  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  revalidatePath('/purchasing/overdue')
}

async function runAction(action: () => Promise<{ shipmentId?: string; savedState?: ChinaOutboundBoxSplitSavedState; inventoryPacking?: InventoryPackingSummary } | void>): Promise<ActionResult> {
  try {
    const result = await action()
    return result ? { ok: true, ...result } : { ok: true }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? '입력값을 확인해주세요.' }
    }
    return { ok: false, error: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.' }
  }
}

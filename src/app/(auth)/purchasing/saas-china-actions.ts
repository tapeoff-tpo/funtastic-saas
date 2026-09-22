'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import {
  addChinaOutboundBox,
  addChinaOutboundBoxItem,
  addChinaOutboundPallet,
  adjustSaasChinaInventory,
  cancelChinaOutboundShipment,
  configureChinaOutboundPackaging,
  createChinaOutboundShipment,
  dispatchChinaOutboundShipment,
  markChinaOutboundShipmentReady,
  receiveSaasChinaInventory,
  removeChinaOutboundBoxItem,
  saveChinaOutboundItemPacking,
} from '@/lib/purchasing/saas-china-outbound'

type ActionResult = { ok: true; shipmentId?: string } | { ok: false; error: string }

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

const createShipmentSchema = z.object({
  shipmentNo: optionalText(100),
  destinationName: optionalText(1_000),
  destinationAddress: optionalText(2_000),
  forwarderName: optionalText(200),
  externalReference: optionalText(200),
  plannedOutboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '출고예정일을 확인해주세요.').optional().nullable(),
  memo: optionalText(),
  lines: z.array(z.object({
    inventoryId,
    quantity: z.coerce.number().int().positive('출고 수량은 1 이상의 정수여야 합니다.'),
  })).min(1, '출고할 상품을 하나 이상 선택해주세요.'),
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

const configurePackagingSchema = z.object({
  shipmentId,
  palletCount: z.coerce.number().int().min(1, '파렛트 수는 1개 이상이어야 합니다.').max(500, '파렛트 수는 500개 이하로 입력해주세요.'),
  boxCount: z.coerce.number().int().min(1, '박스 수는 1개 이상이어야 합니다.').max(5_000, '박스 수는 5,000개 이하로 입력해주세요.'),
})

const removeBoxItemSchema = z.object({
  shipmentId,
  boxItemId: z.string().uuid('박스 적재 항목을 확인해주세요.'),
})

export async function receiveSaasChinaInventoryAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = receiveSchema.parse(input)
    const actor = await getActor()
    await receiveSaasChinaInventory({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function adjustSaasChinaInventoryAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = adjustSchema.parse(input)
    const actor = await getActor()
    await adjustSaasChinaInventory({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function createChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = createShipmentSchema.parse(input)
    const actor = await getActor()
    const shipment = await createChinaOutboundShipment({ ...value, ...actor })
    revalidateSaasChinaPaths()
    return { shipmentId: shipment.id }
  })
}

export async function addChinaOutboundPalletAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = addPalletSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundPallet({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function addChinaOutboundBoxAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = addBoxSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundBox({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function configureChinaOutboundPackagingAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = configurePackagingSchema.parse(input)
    const actor = await getActor()
    await configureChinaOutboundPackaging({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function addChinaOutboundBoxItemAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = addBoxItemSchema.parse(input)
    const actor = await getActor()
    await addChinaOutboundBoxItem({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function saveChinaOutboundItemPackingAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = saveItemPackingSchema.parse(input)
    const actor = await getActor()
    await saveChinaOutboundItemPacking({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function removeChinaOutboundBoxItemAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = removeBoxItemSchema.parse(input)
    const actor = await getActor()
    await removeChinaOutboundBoxItem({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function markChinaOutboundShipmentReadyAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await markChinaOutboundShipmentReady({ ...value, userId: actor.userId })
    revalidateSaasChinaPaths()
  })
}

export async function dispatchChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await dispatchChinaOutboundShipment({ ...value, ...actor })
    revalidateSaasChinaPaths()
  })
}

export async function cancelChinaOutboundShipmentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const value = z.object({ shipmentId }).parse(input)
    const actor = await getActor()
    await cancelChinaOutboundShipment({ ...value, ...actor })
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

async function runAction(action: () => Promise<{ shipmentId?: string } | void>): Promise<ActionResult> {
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

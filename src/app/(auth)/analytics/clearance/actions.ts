'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { db } from '@/lib/db'
import { defaultClearanceSettings, ensureClearanceTables } from '@/lib/analytics/clearance'

type Result = { success?: boolean; error?: string; message?: string }
const numeric = (data: FormData, key: string, fallback: number) => { const value = Number(data.get(key)); return Number.isFinite(value) ? value : fallback }

async function workspace() {
  await assertMenuAccess('/analytics')
  const { data: { user } } = await createClient().then((client) => client.auth.getUser())
  if (!user) throw new Error('인증이 필요합니다.')
  return getWorkspaceUserId(user.id)
}

export async function saveClearanceSettings(_prev: Result | null, formData: FormData): Promise<Result> {
  try {
    const userId = await workspace(); await ensureClearanceTables()
    const values = {
      minimumStock: numeric(formData, 'minimum_stock', defaultClearanceSettings.minimumStock), staleDays: numeric(formData, 'stale_days', defaultClearanceSettings.staleDays), maximumSellThroughPercent: numeric(formData, 'maximum_sell_through_percent', defaultClearanceSettings.maximumSellThroughPercent), minimumMarginPercent: numeric(formData, 'minimum_margin_percent', defaultClearanceSettings.minimumMarginPercent), marketplaceFeePercent: numeric(formData, 'marketplace_fee_percent', defaultClearanceSettings.marketplaceFeePercent), packingCost: numeric(formData, 'packing_cost', defaultClearanceSettings.packingCost), shippingCost: numeric(formData, 'shipping_cost', defaultClearanceSettings.shippingCost), defaultDiscountPercent: numeric(formData, 'default_discount_percent', defaultClearanceSettings.defaultDiscountPercent), maximumDiscountPercent: numeric(formData, 'maximum_discount_percent', defaultClearanceSettings.maximumDiscountPercent), roundingUnit: numeric(formData, 'rounding_unit', defaultClearanceSettings.roundingUnit),
    }
    if (values.minimumStock < 1 || values.staleDays < 1 || values.maximumSellThroughPercent < 0 || values.maximumSellThroughPercent > 100 || values.minimumMarginPercent < 0 || values.minimumMarginPercent > 90 || values.marketplaceFeePercent < 0 || values.marketplaceFeePercent > 100 || values.defaultDiscountPercent < 0 || values.maximumDiscountPercent < values.defaultDiscountPercent) return { error: '기준 값을 다시 확인해주세요.' }
    await db.execute(sql`INSERT INTO inventory_clearance_settings (user_id, minimum_stock, stale_days, maximum_sell_through_percent, minimum_margin_percent, marketplace_fee_percent, packing_cost, shipping_cost, default_discount_percent, maximum_discount_percent, rounding_unit, updated_at)
      VALUES (${userId}, ${values.minimumStock}, ${values.staleDays}, ${values.maximumSellThroughPercent}, ${values.minimumMarginPercent}, ${values.marketplaceFeePercent}, ${values.packingCost}, ${values.shippingCost}, ${values.defaultDiscountPercent}, ${values.maximumDiscountPercent}, ${values.roundingUnit}, now())
      ON CONFLICT (user_id) DO UPDATE SET minimum_stock=EXCLUDED.minimum_stock, stale_days=EXCLUDED.stale_days, maximum_sell_through_percent=EXCLUDED.maximum_sell_through_percent, minimum_margin_percent=EXCLUDED.minimum_margin_percent, marketplace_fee_percent=EXCLUDED.marketplace_fee_percent, packing_cost=EXCLUDED.packing_cost, shipping_cost=EXCLUDED.shipping_cost, default_discount_percent=EXCLUDED.default_discount_percent, maximum_discount_percent=EXCLUDED.maximum_discount_percent, rounding_unit=EXCLUDED.rounding_unit, updated_at=now()`)
    revalidatePath('/analytics/clearance'); return { success: true, message: '재고정리 판정 기준을 저장했습니다.' }
  } catch (error) { return { error: error instanceof Error ? error.message : '저장에 실패했습니다.' } }
}

export async function saveClearanceDecision(_prev: Result | null, formData: FormData): Promise<Result> {
  try {
    const userId = await workspace(); await ensureClearanceTables()
    const sku = String(formData.get('sku') ?? '').trim(); const status = String(formData.get('status') ?? 'candidate'); const actionType = String(formData.get('action_type') ?? 'price_drop')
    const proposed = String(formData.get('proposed_price') ?? '').trim(); const discount = String(formData.get('discount_percent') ?? '').trim()
    if (!sku) return { error: '상품 코드가 없습니다.' }
    const proposedPrice = proposed === '' ? null : Number(proposed); const discountPercent = discount === '' ? null : Number(discount)
    if ((proposedPrice != null && (!Number.isFinite(proposedPrice) || proposedPrice <= 0)) || (discountPercent != null && (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100))) return { error: '가격 또는 할인율을 확인해주세요.' }
    await db.execute(sql`INSERT INTO inventory_clearance_decisions (user_id, sku, status, action_type, proposed_price, discount_percent, note, updated_at)
      VALUES (${userId}, ${sku}, ${status}, ${actionType}, ${proposedPrice}, ${discountPercent}, ${String(formData.get('note') ?? '').trim()}, now())
      ON CONFLICT (user_id, sku) DO UPDATE SET status=EXCLUDED.status, action_type=EXCLUDED.action_type, proposed_price=EXCLUDED.proposed_price, discount_percent=EXCLUDED.discount_percent, note=EXCLUDED.note, updated_at=now()`)
    revalidatePath('/analytics/clearance'); updateTag('analytics'); return { success: true, message: '운영 결정을 저장했습니다. 고객몰 가격은 아직 변경되지 않았습니다.' }
  } catch (error) { return { error: error instanceof Error ? error.message : '저장에 실패했습니다.' } }
}

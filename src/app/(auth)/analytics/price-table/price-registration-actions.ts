'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { priceRegistrationProductKey, savePriceRegistrationExclusion } from '@/lib/analytics/price-registration-exclusions'
import { db } from '@/lib/db'
import { analyticsPriceTableRows } from '@/lib/db/schema'

export async function setPriceRegistrationExcluded(rowId: string, excluded: boolean) {
  try {
    await assertMenuAccess('/analytics/price-table')
    const user = await getCurrentUser()
    if (!user || !z.string().uuid().safeParse(rowId).success || typeof excluded !== 'boolean') {
      return { error: '상품을 다시 확인해주세요.' }
    }
    const workspaceId = await getWorkspaceUserId(user.id)
    const table = analyticsPriceTableRows
    const [row] = await db.select({
      productCode: table.productCode, productName: table.productName, registeredProductName: table.registeredProductName,
    }).from(table).where(and(eq(table.id, rowId), eq(table.userId, workspaceId)))
    const productKey = row && priceRegistrationProductKey(row)
    if (!productKey) return { error: '상품코드 또는 상품명이 있는 행을 선택해주세요.' }
    await savePriceRegistrationExclusion(workspaceId, productKey, excluded)
    revalidatePath('/analytics/price-table')
    return {}
  } catch (error) {
    console.error('price registration exclusion error:', error)
    return { error: '등록 대상 변경을 저장하지 못했습니다.' }
  }
}

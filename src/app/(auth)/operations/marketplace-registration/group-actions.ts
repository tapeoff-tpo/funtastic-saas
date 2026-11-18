'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { products, analyticsPriceTableRows } from '@/lib/db/schema'
import { getCurrentUser } from '@/lib/auth/current-user'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { registrationBaseCode } from '@/lib/operations/registration-groups'

export async function ensureManualRegistrationGroup(sku: string) {
  try {
    await assertMenuAccess('/operations/marketplace-registration')
    await assertMenuAccess('/analytics/price-table')
    const user = await getCurrentUser()
    if (!user || user.mustChangePassword) return { error: '다시 로그인해주세요.' }
    if (!z.string().regex(/^[1-9][0-9]{5}(?:-[0-9]{4})?$/).safeParse(sku).success) return { error: '상품코드를 확인해주세요.' }
    const owner = await getWorkspaceUserId(user.id)
    const base = registrationBaseCode(sku)!
    const rowId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`product-link:${owner}`}))`)
      const table = analyticsPriceTableRows
      const existing = await tx.select({ id: table.id }).from(table).where(and(
        eq(table.userId, owner), eq(table.sourceSheetName, '상품등록'),
        sql`regexp_replace(btrim(${table.productCode}), '-[0-9]{4}$', '') = ${base}`,
      )).orderBy(asc(table.productCode)).limit(1)
      if (existing[0]) return existing[0].id
      const items = await tx.select().from(products).where(and(
        eq(products.userId, owner), sql`regexp_replace(${products.internalSku}, '-[0-9]{4}$', '') = ${base}`,
      )).orderBy(asc(products.internalSku))
      if (!items.length) throw new Error('품목을 찾을 수 없습니다.')
      const options = items.some((item) => item.internalSku !== base) ? items.filter((item) => item.internalSku !== base) : items
      const rows = await tx.insert(table).values(options.map((item, index) => {
        const master = item.metadata?.esa009m as Record<string, unknown> | undefined
        const optionName = typeof master?.['규격정보'] === 'string' ? master['규격정보'] : null
        return {
          userId: owner, sourceSheetName: '상품등록', sourceFileName: '상품업무 연계', rowNumber: index + 1,
          productCode: item.internalSku, productName: item.name, optionName,
          rawData: { '상품코드': item.internalSku, '상품명': item.name, ...(optionName ? { '옵션': optionName } : {}) },
        }
      })).returning({ id: table.id })
      return rows[0].id
    })
    revalidatePath('/analytics/price-table')
    revalidatePath('/operations/marketplace-registration')
    return { rowId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '상품을 연결하지 못했습니다.' }
  }
}

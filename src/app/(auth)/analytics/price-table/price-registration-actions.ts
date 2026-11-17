'use server'

import { and, eq, sql } from 'drizzle-orm'
import { getRegistrationTargets, findMarketplaceProductIds } from './price-table-columns'
import { priceTableHref } from './price-table-navigation'
import { formatPriceNumberDate, priceNumberDateKey } from '@/lib/analytics/price-number-date'
import { COMMON_PRICE_KEY, registrationNumberKey, registrationPriceKey, registrationShippingKey } from '@/lib/analytics/price-registration-values'
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

export async function saveLinkedPriceRegistration(form: FormData) {
  await assertMenuAccess('/analytics/price-table')
  await assertMenuAccess('/operations/marketplace-registration')
  const user = await getCurrentUser()
  const rowId = z.string().uuid().parse(form.get('rowId'))
  const mallId = z.string().min(1).max(80).parse(form.get('mall'))
  const updatedAt = z.string().datetime().parse(form.get('updatedAt'))
  const search = z.string().max(500).parse(form.get('search'))
  const malls = z.string().max(2000).parse(form.get('malls')).split(',').filter(Boolean)
  const priceInput = z.string().trim().regex(/^(?:\d{1,10}(?:\.\d{1,2})?)?$/)
  const commonPrice = priceInput.parse(form.get('commonPrice'))
  const override = priceInput.parse(form.get('override'))
  const shipping = priceInput.parse(form.get('shipping'))
  const number = z.string().trim().max(200).parse(form.get('number'))
  if (!user) throw new Error('로그인이 필요합니다.')
  const workspaceId = await getWorkspaceUserId(user.id)
  const table = analyticsPriceTableRows

  const sheetName = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`product-link:${workspaceId}`}))`)
    const [row] = await tx.select().from(table).where(and(eq(table.id, rowId), eq(table.userId, workspaceId))).for('update')
    if (!row || row.updatedAt.toISOString() !== updatedAt) {
      throw new Error('상품이 변경됐습니다. 새로고침 후 다시 저장해주세요.')
    }
    const [column] = getRegistrationTargets(row.sourceSheetName, [mallId])
    if (!mallId || !column) throw new Error('등록할 몰을 확인해주세요.')
    const rawData = { ...row.rawData } as Record<string, string>
    if (commonPrice) rawData[COMMON_PRICE_KEY] = commonPrice
    else delete rawData[COMMON_PRICE_KEY]
    for (const [key, value] of [[registrationPriceKey(mallId), override], [registrationShippingKey(mallId), shipping]]) {
      if (value) rawData[key] = value
      else delete rawData[key]
    }
    const key = registrationNumberKey(mallId)
    const existing = findMarketplaceProductIds(rawData, column)
    if (number && !existing.some((identifier) => identifier.value === number)) {
      rawData[key] = number
      rawData[priceNumberDateKey(key)] = formatPriceNumberDate(new Date())
    }
    await tx.update(table).set({ rawData, updatedAt: new Date() }).where(and(eq(table.id, rowId), eq(table.userId, workspaceId)))
    return row.sourceSheetName
  })
  revalidatePath('/analytics/price-table')
  return priceTableHref({
    sheetName,
    search,
    sortKey: 'importedAt',
    sortOrder: 'desc',
    view: form.get('view') === 'products' ? 'products' : 'compare',
    malls,
  })
}

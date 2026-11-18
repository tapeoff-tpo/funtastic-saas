'use server'

import { and, eq, sql } from 'drizzle-orm'
import { getRegistrationTargets, getInactiveRegistrationMarketplaceColumns, getManualRegistrationTargets, isProductIdentifier, findMarketplaceProductIds } from './price-table-columns'
import { formatPriceNumberDate, priceNumberDateKey } from '@/lib/analytics/price-number-date'
import { REGISTRATION_EDIT_PREFIX, priceAmount, registrationNumberKey, registrationPriceKey, registrationIdentifiersKey, registrationNumberActorKey } from '@/lib/analytics/price-registration-values'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { priceRegistrationProductKey, savePriceRegistrationExclusion } from '@/lib/analytics/price-registration-exclusions'
import { db } from '@/lib/db'
import { registrationBaseCode, groupRegistrationNumbers, registrationGroupSnapshot } from '@/lib/operations/registration-groups'
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

export async function saveMallPrice(input: {
  rowId: string
  mallId: string
  price: string
  previousPrice: number | null
}) {
  try {
    await assertMenuAccess('/analytics/price-table')
    const user = await getCurrentUser()
    if (!user || user.mustChangePassword) return { error: '다시 로그인해주세요.' }
    const parsed = z.object({
      rowId: z.string().uuid(), mallId: z.string().min(1).max(80),
      price: z.string().trim().regex(/^(?:\d{1,10}(?:\.\d{1,2})?)?$/),
      previousPrice: z.number().finite().nonnegative().nullable(),
    }).safeParse(input)
    if (!parsed.success) return { error: '가격은 0 이상의 숫자로 입력해주세요.' }
    const workspaceId = await getWorkspaceUserId(user.id)
    const { rowId, mallId, price, previousPrice } = parsed.data
    await db.transaction(async (tx) => {
      const table = analyticsPriceTableRows
      const [row] = await tx.select().from(table).where(and(eq(table.id, rowId), eq(table.userId, workspaceId))).for('update')
      if (!row) throw new Error('상품을 찾을 수 없습니다.')
      const columns = [...getRegistrationTargets(row.sourceSheetName, []), ...getInactiveRegistrationMarketplaceColumns()]
      if (!columns.some((column) => column.id === mallId)) throw new Error('쇼핑몰을 확인해주세요.')
      const key = registrationPriceKey(mallId)
      if (priceAmount(row.rawData[key]) !== previousPrice) throw new Error('다른 사용자가 가격을 수정했습니다. 새로고침 후 다시 확인해주세요.')
      const raw = { ...row.rawData }
      if (price !== '') {
        raw[key] = price
        raw[`__registrationEdit:priceActor:${mallId}`] = user.id
        raw[`__registrationEdit:priceDate:${mallId}`] = new Date().toISOString()
      } else {
        delete raw[key]
        delete raw[`__registrationEdit:priceActor:${mallId}`]
        delete raw[`__registrationEdit:priceDate:${mallId}`]
      }
      await tx.update(table).set({ rawData: raw, updatedAt: new Date() }).where(and(eq(table.id, rowId), eq(table.userId, workspaceId)))
    })
    revalidatePath('/analytics/price-table')
    return { saved: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '판매가를 저장하지 못했습니다.' }
  }
}


export async function saveManualRegistrationNumber(input: {
  rowId: string
  mallId: string
  identifierKey: string | null
  previousValue: string | null
  number: string
  groupSnapshot?: string
}) {
  try {
    await assertMenuAccess('/operations/marketplace-registration')
    await assertMenuAccess('/analytics/price-table')
    const user = await getCurrentUser()
    if (!user || user.mustChangePassword) return { error: '다시 로그인해주세요.' }
    const parsed = z.object({
      rowId: z.string().uuid(), mallId: z.string().min(1).max(80), groupSnapshot: z.string().length(64).optional(),
      identifierKey: z.string().min(1).max(500).nullable(),
      previousValue: z.string().max(200).nullable(),
      number: z.string().trim().min(1).max(200).refine(isProductIdentifier, '유효한 상품등록번호를 입력해주세요.'),
    }).safeParse(input)
    if (!parsed.success) return { error: '유효한 상품등록번호를 200자 이내로 입력해주세요.' }
    const workspaceId = await getWorkspaceUserId(user.id)
    const { rowId, mallId, identifierKey, previousValue, number, groupSnapshot } = parsed.data
    await db.transaction(async (tx) => {
      if (groupSnapshot) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId + ':manual-registration'}))`)
      const table = analyticsPriceTableRows
      const [row] = await tx.select().from(table).where(and(eq(table.id, rowId), eq(table.userId, workspaceId))).for('update')
      if (!row) throw new Error('상품을 찾을 수 없습니다.')
      const target = getManualRegistrationTargets(row.sourceSheetName).find((column) => column.id === mallId)
      if (!target) throw new Error('등록할 몰을 확인해주세요.')
      let rows: Array<{ id: string; rawData: Record<string, unknown> }> = [row]
      const base = registrationBaseCode(row.productCode)
      if (groupSnapshot && base) rows = await tx.execute<{ id: string; rawData: Record<string, unknown> }>(sql`
        SELECT id, raw_data AS "rawData" FROM analytics_price_table_rows
        WHERE user_id = ${workspaceId}::uuid AND source_sheet_name = ${row.sourceSheetName}
          AND regexp_replace(btrim(product_code), '-[0-9]{4}$', '') = ${base}
        ORDER BY id FOR UPDATE
      `)
      if (groupSnapshot && registrationGroupSnapshot(rows, target) !== groupSnapshot) {
        throw new Error('상품의 옵션 또는 등록번호가 변경되었습니다. 새로고침 후 다시 확인해주세요.')
      }
      const numbers = groupSnapshot ? groupRegistrationNumbers(rows, target)
        : findMarketplaceProductIds(row.rawData as Record<string, string>, target)
      const current = numbers.find((entry) => entry.key === identifierKey && (!groupSnapshot || entry.value === previousValue))
      if (identifierKey !== null && (!current || current.value !== previousValue)) {
        throw new Error('다른 사용자가 번호를 수정했습니다. 새로고침 후 다시 확인해주세요.')
      }
      if (identifierKey === null && numbers.length > 0) throw new Error('등록번호가 추가되었습니다. 새로고침 후 다시 확인해주세요.')
      if (!groupSnapshot && current?.value === number) return
      if (!groupSnapshot && numbers.some((entry) => entry.key !== identifierKey && entry.value === number)) throw new Error('이미 입력된 등록번호입니다.')
      let key = identifierKey ?? registrationNumberKey(mallId)
      if (groupSnapshot) key = registrationNumberKey(mallId)
      if (current && !key.startsWith(REGISTRATION_EDIT_PREFIX)) key = registrationNumberKey(mallId) + ':' + key
      const next = groupSnapshot ? [{ key, value: number }] : current ? numbers.map((entry) => entry.key === identifierKey ? { key, value: number } : entry)
        : [{ key, value: number }]
      for (const option of rows) {
        const raw = { ...option.rawData } as Record<string, string>
        raw[registrationIdentifiersKey(mallId)] = JSON.stringify(next)
        raw[registrationNumberActorKey(mallId, key)] = user.id
        raw[priceNumberDateKey(key)] = formatPriceNumberDate(new Date())
        await tx.update(table).set({ rawData: raw, updatedAt: new Date() })
          .where(and(eq(table.id, option.id), eq(table.userId, workspaceId)))
      }
    })
    revalidatePath('/operations/marketplace-registration')
    revalidatePath('/analytics/price-table')
    return { saved: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '상품등록번호를 저장하지 못했습니다.' }
  }
}


export async function saveMallDisplayedPrice(input: { rowId: string; mallId: string; price: string; previousPrice: number | null }) {
  try {
    await assertMenuAccess('/operations/marketplace-registration')
    await assertMenuAccess('/analytics/price-table')
    const user = await getCurrentUser()
    if (!user || user.mustChangePassword) return { error: '다시 로그인해주세요.' }
    const parsed = z.object({
      rowId: z.string().uuid(), mallId: z.string().min(1).max(80),
      price: z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/),
      previousPrice: z.number().finite().nonnegative().nullable(),
    }).safeParse(input)
    if (!parsed.success) return { error: '몰에서 확인한 금액을 숫자로 입력해주세요.' }
    const owner = await getWorkspaceUserId(user.id)
    const { rowId, mallId, price, previousPrice } = parsed.data
    await db.transaction(async (tx) => {
      const table = analyticsPriceTableRows
      const [row] = await tx.select().from(table).where(and(eq(table.id, rowId), eq(table.userId, owner))).for('update')
      if (!row || !getManualRegistrationTargets(row.sourceSheetName).some((mall) => mall.id === mallId)) throw new Error('상품과 몰을 확인해주세요.')
      const key = '__registrationEdit:displayPrice:' + mallId
      if (priceAmount(row.rawData[key]) !== previousPrice) throw new Error('다른 사용자가 표시가를 수정했습니다. 새로고침해주세요.')
      await tx.update(table).set({ rawData: {
        ...row.rawData, [key]: price,
        ['__registrationEdit:displayDate:' + mallId]: formatPriceNumberDate(new Date()),
      }, updatedAt: new Date() }).where(and(eq(table.id, rowId), eq(table.userId, owner)))
    })
    revalidatePath('/operations/marketplace-registration')
    return { saved: true }
  } catch (error) { return { error: error instanceof Error ? error.message : '몰 표시가를 저장하지 못했습니다.' } }
}

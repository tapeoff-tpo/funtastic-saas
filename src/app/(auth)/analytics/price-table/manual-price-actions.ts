'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/current-user'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { analyticsPriceTableRows } from '@/lib/db/schema'
import { formatPriceNumberDate, priceNumberDateKey } from '@/lib/analytics/price-number-date'
import { getPriceTableDisplayColumns } from './price-table-columns'

export async function addManualPriceProduct(form: FormData): Promise<{ error?: string }> {
  try {
    await assertMenuAccess('/analytics/price-table')
    const user = await getCurrentUser()
    if (!user) return { error: '로그인이 필요합니다.' }
    const text = (key: string, max = 500) => String(form.get(key) ?? '').trim().slice(0, max)
    const productCode = text('productCode', 100)
    const productName = text('productName')
    const sheetName = text('sheetName')
    if (!productCode || !productName) return { error: '상품코드와 상품명을 입력해주세요.' }
    if (!['상품등록', '메인', '뉴도매'].includes(sheetName)) return { error: '시트가 올바르지 않습니다.' }
    const enteredAt = new Date()
    const enteredDate = formatPriceNumberDate(enteredAt)
    const rawData: Record<string, string> = { 상품코드: productCode, 상품명: productName }
    for (const column of getPriceTableDisplayColumns(sheetName)) {
      const price = text(`price:${column.id}`, 40).replace(/,/g, '')
      if (price && (!Number.isFinite(Number(price)) || Number(price) < 0)) return { error: `${column.label} 판매가를 확인해주세요.` }
      if (price) rawData[column.valueKey] = price
      const identifier = text(`identifier:${column.id}`, 200)
      if (identifier) {
        const key = column.productIdKeys?.[0] ?? `${column.label} 상품번호`
        rawData[key] = identifier
        rawData[priceNumberDateKey(key)] = enteredDate
      }
    }
    await db.insert(analyticsPriceTableRows).values({
      userId: await getWorkspaceUserId(user.id), sourceFileName: '직접 등록',
      sourceSheetName: sheetName, rowNumber: 0, productCode, productName,
      optionName: text('optionName') || null, rawData, importedAt: enteredAt, updatedAt: enteredAt,
    })
    revalidatePath('/analytics/price-table')
    return {}
  } catch (error) {
    console.error('manual price product error:', error)
    return { error: '상품 추가에 실패했습니다. 권한과 입력값을 확인해주세요.' }
  }
}

import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { chinaOutboundShipmentItems, products, productVariants, purchaseRequestItems } from '@/lib/db/schema'
import { resolvePurchasingProductImages } from '@/lib/purchasing/product-image-catalogue'
import { findSavedNewProductImages } from '@/lib/new-products/catalogue-images'

export const runtime = 'nodejs'

const querySchema = z.object({ purchaseItemId: z.string().uuid().optional(), shipmentItemId: z.string().uuid().optional(), catalogue: z.enum(['1']).optional() })
  .refine((query) => Boolean(query.purchaseItemId) !== Boolean(query.shipmentItemId))

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: '이미지를 확인할 품목을 선택해주세요.' }, { status: 400 })
  const userId = await getWorkspaceUserId(user.id)
  const table = parsed.data.purchaseItemId ? purchaseRequestItems : chinaOutboundShipmentItems
  const [item] = await db.select({ sku: table.sku, productName: table.productName }).from(table)
    .where(and(eq(table.userId, userId), eq(table.id, (parsed.data.purchaseItemId ?? parsed.data.shipmentItemId)!))).limit(1)
  if (!item) return NextResponse.json({ error: '해당 품목을 찾을 수 없습니다.' }, { status: 404 })
  const savedImages = parsed.data.catalogue === '1' ? [] : await findSavedNewProductImages(userId, item.sku, item.productName)
  if (savedImages.length) return NextResponse.json({ ...item, imageUrls: savedImages.map((image) => image.url), source: 'product-management' }, { headers: { 'Cache-Control': 'private, no-store' } })
  const [product] = await db.select({ images: products.images }).from(products)
    .where(and(eq(products.userId, userId), eq(products.internalSku, item.sku))).limit(1)
  const [variantProduct] = product?.images?.length ? [] : await db.select({ images: products.images }).from(productVariants)
    .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.userId, userId)))
    .where(eq(productVariants.sku, item.sku)).limit(1)
  try {
    const result = await resolvePurchasingProductImages({ ...item, localImages: product?.images?.length ? product.images : variantProduct?.images ?? null, catalogueOnly: parsed.data.catalogue === '1' })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: '상품 이미지를 불러오지 못했습니다. 다시 불러오기를 눌러주세요.' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } })
  }
}

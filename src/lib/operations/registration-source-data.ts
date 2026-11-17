import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, purchaseRequestItems } from '@/lib/db/schema'

export async function getRegistrationSourceData(userId: string, sku: string) {
  const purchases = purchaseRequestItems
  const [[item], [purchase], workflows] = await Promise.all([
    db.select({
      name: products.name, cost: products.costPrice, shipping: products.shippingCost, metadata: products.metadata,
    }).from(products).where(and(eq(products.userId, userId), eq(products.internalSku, sku))).limit(1),
    db.select({
      status: purchases.status, requestDate: purchases.requestDate,
      managementCode: purchases.purchaseManagementCode, supplierOrderNumber: purchases.supplierOrderNumber,
      requestedQuantity: purchases.requestedQuantity, actualQuantity: purchases.actualPurchaseQuantity,
      receivedQuantity: purchases.chinaReceivedQuantity,
    }).from(purchases).where(and(eq(purchases.userId, userId), eq(purchases.sku, sku)))
      .orderBy(desc(sql`COALESCE(${purchases.requestDate}, ${purchases.createdAt}::date)`), desc(purchases.createdAt), desc(purchases.id)).limit(1),
    db.execute<{ id: string; name: string | null; option: string | null; url: string | null; purchaseUrl: string | null }>(sql`
      SELECT id, registered_product_name AS name, product_option AS option, detail_page_url AS url, source_url AS "purchaseUrl"
      FROM new_product_workflow_items
      WHERE user_id = ${userId}::uuid AND sabangnet_code = ${sku}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `),
  ])
  const master = item?.metadata?.esa009m as Record<string, unknown> | undefined
  function masterText(key: string) {
    const value = master?.[key]
    return typeof value === 'string' ? value.trim() || undefined : undefined
  }
  return {
    item, purchase, workflow: workflows[0],
    purchaseUrl: masterText('구매 URL'),
    manufacturer: masterText('제조사'),
    countryOfOrigin: masterText('제조국'),
  }
}

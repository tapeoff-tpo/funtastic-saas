import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { registrationBaseCode } from './registration-groups'
import { db } from '@/lib/db'
import { products, purchaseRequestItems } from '@/lib/db/schema'

export async function getRegistrationSourceData(userId: string, sku: string) {
  const purchases = purchaseRequestItems
  const codes = [...new Set([sku, registrationBaseCode(sku) ?? sku])]
  const [[item], [purchase], workflows] = await Promise.all([
    db.select({
      name: products.name, cost: products.costPrice, shipping: products.shippingCost, metadata: products.metadata,
    }).from(products).where(and(eq(products.userId, userId), inArray(products.internalSku, codes))).orderBy(sql`CASE WHEN ${products.internalSku} = ${sku} THEN 0 ELSE 1 END`).limit(1),
    db.select({
      status: purchases.status, requestDate: purchases.requestDate,
      managementCode: purchases.purchaseManagementCode, supplierOrderNumber: purchases.supplierOrderNumber,
      requestedQuantity: purchases.requestedQuantity, actualQuantity: purchases.actualPurchaseQuantity,
      receivedQuantity: purchases.chinaReceivedQuantity,
    }).from(purchases).where(and(eq(purchases.userId, userId), eq(purchases.sku, sku)))
      .orderBy(desc(sql`COALESCE(${purchases.requestDate}, ${purchases.createdAt}::date)`), desc(purchases.createdAt), desc(purchases.id)).limit(1),
    db.execute<{ id: string; name: string | null; option: string | null; url: string | null; purchaseUrl: string | null; b2bPrice: number | null; b2cPrice: number | null;
      material: string | null; size: string | null; manufacturer: string | null; country: string | null;
      weight: string | null; capacity: string | null; components: string | null; specialNotes: string | null;
    }>(sql`
      SELECT id, registered_product_name AS name, product_option AS option, detail_page_url AS url, source_url AS "purchaseUrl",
        b2b_price AS "b2bPrice", b2c_price AS "b2cPrice", notice_material AS material, notice_size AS size,
        notice_manufacturer AS manufacturer, notice_country AS country, notice_weight AS weight,
        notice_capacity AS capacity, notice_components AS components, notice_special_notes AS "specialNotes"
      FROM new_product_workflow_items
      WHERE user_id = ${userId}::uuid AND sabangnet_code IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})
      ORDER BY CASE WHEN sabangnet_code = ${sku} THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 1
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
    manufacturer: masterText('제조사') || workflows[0]?.manufacturer || undefined,
    countryOfOrigin: masterText('제조국') || workflows[0]?.country || undefined,
    material: masterText('재질') || workflows[0]?.material || undefined,
    size: masterText('제품크기') || workflows[0]?.size || undefined,
    weight: masterText('무게') || workflows[0]?.weight || undefined,
    capacity: masterText('용량') || workflows[0]?.capacity || undefined,
    components: masterText('구성품') || workflows[0]?.components || undefined,
    specialNotes: masterText('특이사항') || workflows[0]?.specialNotes || undefined,
  }
}

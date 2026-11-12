import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { insertPurchaseRequest } from '@/lib/purchasing/purchase-request-create'

export async function requestWorkflowPurchase(input: {
  userId: string
  actorId: string
  itemId: string
  quantity: number
  sampleDecision: 'approved' | 'skipped'
}) {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 1_000_000
  ) {
    throw new Error('발주 수량을 확인해주세요.')
  }
  if (
    input.sampleDecision !== 'approved' &&
    input.sampleDecision !== 'skipped'
  ) {
    throw new Error('샘플 합격 또는 샘플 생략을 선택해주세요.')
  }

  return db.transaction(async (tx) => {
    const result = await tx.execute<{
      registered_product_name: string | null
      sabangnet_code: string | null
      product_option: string | null
      source_url: string | null
      request_id: string | null
      stage_name: string
    }>(sql`
      SELECT i.registered_product_name, i.sabangnet_code, i.product_option, i.source_url,
        i.metadata->'purchaseLink'->>'requestId' AS request_id, s.name AS stage_name
      FROM new_product_workflow_items i
      JOIN new_product_workflow_stages s ON s.id = i.stage_id AND s.user_id = i.user_id
      WHERE i.id = ${input.itemId}::uuid AND i.user_id = ${input.userId}::uuid
      FOR UPDATE OF i
    `)
    const item = result[0]
    if (!item) throw new Error('발주할 상품을 찾을 수 없습니다.')
    if (item.request_id) return { id: item.request_id, existing: true }
    if (/진행불가|진행보류/.test(item.stage_name))
      throw new Error('보류 또는 진행불가 상품은 발주할 수 없습니다.')
    const sku = item.sabangnet_code?.trim()
    const name = item.registered_product_name?.trim()
    const purchaseUrl = item.source_url?.trim()
    if (!sku || !name || !purchaseUrl)
      throw new Error(
        '확정 상품명, 사방넷코드, 선택한 구매처 URL을 먼저 저장해주세요.',
      )
    const url = URL.parse(purchaseUrl)
    if (!url || !['https:', 'http:'].includes(url.protocol))
      throw new Error('구매처 URL을 확인해주세요.')
    const requestDate = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
    }).format(new Date())
    const row = await insertPurchaseRequest(tx, {
      userId: input.userId,
      sku,
      productName: name,
      optionName: item.product_option,
      requestedQuantity: input.quantity,
      requestDate,
      createdFrom: 'product_workflow',
      memo: `${input.sampleDecision === 'skipped' ? '샘플 생략' : '샘플 합격'} · ${purchaseUrl}`,
      workflow: {
        itemId: input.itemId,
        actorId: input.actorId,
        sampleDecision: input.sampleDecision,
        purchaseUrl,
      },
    })
    await tx.execute(sql`
      UPDATE new_product_workflow_items
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'purchaseLink', jsonb_build_object('requestId', ${row.id}::text, 'sampleDecision', ${input.sampleDecision}::text, 'actorId', ${input.actorId}::text, 'at', now())
      ), updated_at = now()
      WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
    `)
    return { id: row.id, existing: false }
  })
}

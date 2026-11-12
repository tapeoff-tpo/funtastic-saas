import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { buildLinkChanges, type LinkState, type LinkTarget } from './plan'
const rows = <T>(result: unknown): T[] =>
  (result as { rows?: T[] }).rows ?? (result as T[])
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function load(
  tx: Tx,
  userId: string,
  itemId: string,
  lock: boolean,
): Promise<LinkState> {
  const [source] = rows<NonNullable<LinkState['source']>>(
    await tx.execute(
      sql`SELECT * FROM new_product_workflow_items WHERE id=${itemId}::uuid AND user_id=${userId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`,
    ),
  )
  if (!source) throw new Error('연결할 상품관리 항목을 찾을 수 없습니다.')
  const code = String(source.sabangnet_code ?? '').trim()
  const linkedCode = source.metadata?.linkedSync?.item?.code
  if (linkedCode && linkedCode !== code) {
    throw new Error(
      `이미 연결된 품목코드는 ${linkedCode}입니다. 연결한 코드를 확인해주세요.`,
    )
  }
  const items = rows<NonNullable<LinkState['item']>>(
    await tx.execute(
      sql`SELECT id,name,internal_sku,cost_price,metadata,updated_at FROM products WHERE user_id=${userId}::uuid AND internal_sku=${code} ${lock ? sql`FOR UPDATE` : sql``}`,
    ),
  )
  const prices = rows<NonNullable<LinkState['price']>>(
    await tx.execute(
      sql`SELECT id,product_name,option_name,raw_data,updated_at FROM analytics_price_table_rows WHERE user_id=${userId}::uuid AND product_code=${code} AND source_sheet_name='상품등록' ${lock ? sql`FOR UPDATE` : sql``}`,
    ),
  )
  if (items.length > 1 || prices.length > 1)
    throw new Error(
      '같은 품목코드의 행이 여러 개입니다. 옵션별 코드를 정리한 뒤 연결해주세요.',
    )
  const [registration] = rows<NonNullable<LinkState['registration']>>(
    await tx.execute(
      sql`SELECT * FROM marketplace_registration_profiles WHERE user_id=${userId}::uuid AND product_code=${code} ${lock ? sql`FOR UPDATE` : sql``}`,
    ),
  )
  const linkedIds = [
    items[0]?.metadata?.newProductWorkflow?.itemId,
    registration?.detail_notice?.linkedWorkflow?.itemId,
  ]
  if (linkedIds.some((linkedId) => linkedId && linkedId !== itemId)) {
    throw new Error(
      '이 품목코드는 다른 상품관리 항목에 이미 연결되어 있습니다.',
    )
  }
  return {
    source,
    item: items[0] ?? null,
    price: prices[0] ?? null,
    registration: registration ?? null,
  }
}
function token(state: LinkState, target: LinkTarget) {
  return createHash('sha256')
    .update(JSON.stringify({ state, target }))
    .digest('hex')
}
export async function previewProductLink(
  userId: string,
  itemId: string,
  target: LinkTarget,
) {
  return db.transaction(async (tx) => {
    const state = await load(tx, userId, itemId, false)
    return {
      itemId,
      target,
      productName:
        state.source.registered_product_name || state.source.product_name,
      changes: buildLinkChanges(state, target),
      token: token(state, target),
    }
  })
}
export async function applyProductLink(
  userId: string,
  actorId: string,
  itemId: string,
  target: LinkTarget,
  expectedToken: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`product-link:${userId}`}))`,
    )
    const state = await load(tx, userId, itemId, true)
    if (token(state, target) !== expectedToken)
      throw new Error('비교 후 상품정보가 변경됐습니다. 다시 비교해주세요.')
    const changes = buildLinkChanges(state, target)
    if (!changes.length) return { changed: 0 }
    const values = Object.fromEntries(changes.map((c) => [c.key, c.after])),
      s = state.source,
      code = String(s.sabangnet_code).trim()
    if (target === 'item') {
      const esa = Object.fromEntries(
        changes
          .filter((c) => c.key.startsWith('esa:'))
          .map((c) => [c.key.slice(4), c.after]),
      )
      const meta = {
        ...(state.item?.metadata ?? {}),
        esa009m: { ...(state.item?.metadata?.esa009m ?? {}), ...esa },
        newProductWorkflow: { itemId, syncedAt: new Date().toISOString() },
      }
      await tx.execute(
        sql`INSERT INTO products(user_id,internal_sku,name,base_price,status,metadata) VALUES(${userId}::uuid,${code},${s.registered_product_name || s.product_name},0,'draft',${JSON.stringify(meta)}::jsonb) ON CONFLICT(user_id,internal_sku) DO UPDATE SET name=EXCLUDED.name,metadata=EXCLUDED.metadata,updated_at=now()`,
      )
    } else if (target === 'cost') {
      const raw = {
        ...(state.price?.raw_data ?? {}),
        ...Object.fromEntries(
          changes
            .filter((c) => c.key.startsWith('raw:'))
            .map((c) => [c.key.slice(4), c.after]),
        ),
      }
      if (state.price)
        await tx.execute(
          sql`UPDATE analytics_price_table_rows SET product_name=${s.registered_product_name || s.product_name},option_name=COALESCE(${s.product_option},option_name),raw_data=${JSON.stringify(raw)}::jsonb,updated_at=now() WHERE id=${state.price.id}::uuid AND user_id=${userId}::uuid`,
        )
      else
        await tx.execute(
          sql`INSERT INTO analytics_price_table_rows(user_id,source_file_name,source_sheet_name,row_number,product_code,product_name,option_name,raw_data) VALUES(${userId}::uuid,'상품업무 연계','상품등록',0,${code},${s.registered_product_name || s.product_name},${s.product_option},${JSON.stringify(raw)}::jsonb)`,
        )
    } else if (target === 'price') {
      await tx.execute(
        sql`UPDATE new_product_workflow_items SET b2b_price=COALESCE(${values.b2b_price ?? null}::integer,b2b_price),b2c_price=COALESCE(${values.b2c_price ?? null}::integer,b2c_price),updated_at=now() WHERE id=${itemId}::uuid AND user_id=${userId}::uuid`,
      )
    } else {
      const notice = {
        ...(state.registration?.detail_notice ?? {}),
        linkedWorkflow: {
          itemId,
          detailPageUrl: s.detail_page_url,
          syncedAt: new Date().toISOString(),
        },
      }
      if (!state.registration)
        await tx.execute(
          sql`INSERT INTO marketplace_registration_profiles(user_id,product_code,source_type,source_product_id,product_name) VALUES(${userId}::uuid,${code},'product-workflow',${itemId},${s.registered_product_name || s.product_name})`,
        )
      const allowed = [
        'product_name',
        'source_cost_price',
        'source_price',
        'source_retail_price',
        'manufacturer',
        'country_of_origin',
        'source_product_notice',
        'source_options',
      ]
      const sets = changes
        .filter((c) => allowed.includes(c.key))
        .map(
          (c) =>
            sql`${sql.identifier(c.key)}=${c.key === 'source_product_notice' || c.key === 'source_options' ? sql`${JSON.stringify(c.after)}::jsonb` : sql`${c.after}`}`,
        )
      sets.push(
        sql`detail_notice=${JSON.stringify(notice)}::jsonb`,
        sql`last_synced_at=now()`,
        sql`updated_at=now()`,
      )
      await tx.execute(
        sql`UPDATE marketplace_registration_profiles SET ${sql.join(sets, sql`, `)} WHERE user_id=${userId}::uuid AND product_code=${code}`,
      )
    }
    await tx.execute(
      sql`UPDATE new_product_workflow_items SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('linkedSync',COALESCE(metadata->'linkedSync','{}'::jsonb)||jsonb_build_object(${target}::text,jsonb_build_object('at',now(),'actorId',${actorId}::text,'code',${code}::text,'changes',${JSON.stringify(changes)}::jsonb))),updated_at=now() WHERE id=${itemId}::uuid AND user_id=${userId}::uuid`,
    )
    return { changed: changes.length }
  })
}

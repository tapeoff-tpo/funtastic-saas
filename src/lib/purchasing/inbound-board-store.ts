import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { ImportDocumentDetail } from './china-import-document'

export type InboundPostSummary = {
  id: string; shipmentId: string; title: string; expectedDate: string; receivedDate: string | null
  memoOwnerId?: string | null
  memoAuthor?: { account: string | null; name: string | null; date: string; savedAt: string } | null
  note: string; freightKrw?: number | null; quantity: number; revision: number; createdAt: string
}
export type InboundPost = InboundPostSummary & { detail: ImportDocumentDetail }
let ready: Promise<unknown> | undefined
async function exists() {
  const [row] = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('purchasing_inbound_posts') IS NOT NULL AS exists`)
  return row?.exists
}
function ensureTable() {
  return ready ??= (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS purchasing_inbound_posts (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, shipment_id uuid NOT NULL, actor_id uuid NOT NULL,
      title text NOT NULL, expected_date date NOT NULL, received_date date,
      note text NOT NULL DEFAULT '', quantity integer NOT NULL, search_text text NOT NULL,
      detail jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, shipment_id)
    )`)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS purchasing_inbound_posts_date_idx ON purchasing_inbound_posts (user_id, expected_date DESC, created_at DESC)`)
    await db.execute(sql`ALTER TABLE purchasing_inbound_posts ENABLE ROW LEVEL SECURITY`)
    await db.execute(sql`REVOKE ALL ON purchasing_inbound_posts FROM PUBLIC`)
  })().catch((error) => { ready = undefined; throw error })
}
const memoOwner = sql`coalesce(detail->'memoAuthor'->>'actorId', CASE WHEN note <> '' OR detail->>'freightKrw' IS NOT NULL OR detail ? 'memoAuthor' THEN actor_id::text END)`
const columns = sql`id, shipment_id AS "shipmentId", title, expected_date::text AS "expectedDate", received_date::text AS "receivedDate", note, (detail->>'freightKrw')::integer AS "freightKrw", detail->'memoAuthor' AS "memoAuthor", ${memoOwner} AS "memoOwnerId", quantity, revision, created_at::text AS "createdAt"`
export function inboundSearchText(detail: ImportDocumentDetail, title: string, note: string) {
  const allocated = new Set(detail.boxItems.filter((line) => line.quantity > 0).map((line) => line.shipmentItemId))
  return [title, note, detail.shipment.shipmentNo, ...detail.items.filter((item) => allocated.has(item.id)).flatMap((item) => [item.sku, item.productName, item.optionName ?? '', item.location ?? ''])].join('\n').normalize('NFKC').toLocaleLowerCase('ko-KR')
}
export async function listInboundPosts(userId: string, query: string) {
  if (!await exists()) return []
  const terms = query.normalize('NFKC').toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean)
  const filter = terms.length ? sql.join(terms.map((term) => sql`position(${term} in search_text || E'\n' || lower(note)) > 0`), sql` AND `) : sql`true`
  return db.execute<InboundPostSummary>(sql`SELECT ${columns} FROM purchasing_inbound_posts WHERE user_id=${userId} AND ${filter} ORDER BY expected_date DESC, created_at DESC LIMIT 100`)
}
export async function getInboundPost(userId: string, id: string) {
  if (!await exists()) return null
  const [post] = await db.execute<InboundPost>(sql`SELECT ${columns}, detail FROM purchasing_inbound_posts WHERE user_id=${userId} AND id=${id}`)
  return post ?? null
}

export type ScheduledDomesticInbound = { sku: string; daysUntilArrival: number; quantity: number }

export async function listScheduledDomesticInbound(userId: string, today: string) {
  if (!await exists()) return []
  return db.execute<ScheduledDomesticInbound>(sql`
    SELECT item->>'sku' AS sku, (post.expected_date - ${today}::date) AS "daysUntilArrival",
      SUM((box_line->>'quantity')::integer)::integer AS quantity
    FROM purchasing_inbound_posts post
    CROSS JOIN LATERAL jsonb_array_elements(post.detail->'boxItems') AS box_line
    JOIN LATERAL jsonb_array_elements(post.detail->'items') AS item
      ON item->>'id' = box_line->>'shipmentItemId'
    WHERE post.user_id = ${userId} AND post.received_date IS NULL
      AND post.expected_date >= ${today}::date
      AND (box_line->>'quantity')::integer > 0
    GROUP BY item->>'sku', post.expected_date
    ORDER BY post.expected_date
  `)
}
export async function publishInboundPost(input: {
  userId: string; actorId: string; shipmentId: string; title: string; expectedDate: string; receivedDate: string | null; note: string; detail: ImportDocumentDetail
}) {
  const quantity = input.detail.boxItems.reduce((sum, line) => sum + Math.max(0, line.quantity), 0)
  if (!quantity) throw new Error('포장된 상품이 없어 입고리스트를 게시할 수 없습니다.')
  await ensureTable()
  const id = randomUUID()
  const [post] = await db.execute<InboundPostSummary>(sql`
    INSERT INTO purchasing_inbound_posts (id,user_id,shipment_id,actor_id,title,expected_date,received_date,note,quantity,search_text,detail)
    VALUES (${id},${input.userId},${input.shipmentId},${input.actorId},${input.title},${input.expectedDate},${input.receivedDate},${input.note},${quantity},${inboundSearchText(input.detail,input.title,'')},${JSON.stringify(input.detail)}::jsonb)
    ON CONFLICT (user_id,shipment_id) DO NOTHING RETURNING ${columns}`)
  if (post) return { post, created: true }
  const [existing] = await db.execute<InboundPostSummary>(sql`SELECT ${columns} FROM purchasing_inbound_posts WHERE user_id=${input.userId} AND shipment_id=${input.shipmentId}`)
  return { post: existing, created: false }
}
export async function updateInboundDates(input: { userId: string; actorId: string; id: string; revision: number; expectedDate: string; receivedDate: string | null; note?: string; freightKrw?: number | null; memoName?: string; isAdmin?: boolean }) {
  if (!await exists()) return null
  const noteUpdate = input.note === undefined ? sql`` : sql`note=${input.note},`
  const memoChanged = input.note !== undefined || input.freightKrw !== undefined
  const freight = input.freightKrw === undefined ? sql`detail` : sql`jsonb_set(detail, '{freightKrw}', ${JSON.stringify(input.freightKrw)}::jsonb)`
  const memoUpdate = memoChanged ? sql`detail=jsonb_set(${freight}, '{memoAuthor}', jsonb_build_object(
    'actorId', coalesce(${memoOwner}, ${input.actorId}::text),
    'account', (SELECT email FROM user_profiles WHERE id=${input.actorId}),
    'name', coalesce(nullif(${input.memoName ?? ''}, ''), (SELECT display_name FROM user_profiles WHERE id=${input.actorId})),
    'date', (now() AT TIME ZONE 'Asia/Seoul')::date::text,
    'savedAt', now()
  )),` : sql``
  const allowed = memoChanged && !input.isAdmin
    ? sql`AND (${memoOwner} IS NULL OR ${memoOwner}=${input.actorId}::text)` : sql``
  const [post] = await db.execute<InboundPostSummary>(sql`UPDATE purchasing_inbound_posts SET ${noteUpdate} ${memoUpdate} expected_date=${input.expectedDate},received_date=${input.receivedDate},revision=revision+1,updated_at=now() WHERE user_id=${input.userId} AND id=${input.id} AND revision=${input.revision} ${allowed} RETURNING ${columns}`)
  return post ?? null
}

export async function deleteInboundMemo(input: { userId: string; actorId: string; id: string; revision: number; isAdmin: boolean }) {
  if (!await exists()) return null
  const [post] = await db.execute<InboundPostSummary>(sql`
    UPDATE purchasing_inbound_posts
    SET note='', detail=detail-'freightKrw'-'memoAuthor', revision=revision+1, updated_at=now()
    WHERE user_id=${input.userId} AND id=${input.id} AND revision=${input.revision}
      AND ${memoOwner} IS NOT NULL AND (${input.isAdmin} OR ${memoOwner}=${input.actorId}::text)
    RETURNING ${columns}`)
  return post ?? null
}

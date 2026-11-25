import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type NoticeCategory = 'sold-out' | 'inbound-info' | `custom-${string}`
export type BoardNotice = {
  id: string
  title: string
  body: string
  filename: string | null
  date: string
}

export async function readBoardNotices(owner: string, category: NoticeCategory, query: string, attachmentId: string | null) {
  const [table] = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('purchasing_board_notices') IS NOT NULL AS exists`)
  if (!table?.exists) return { posts: [] }
  if (attachmentId) {
    const [attachment] = await db.execute<{ filename: string; attachment: string }>(sql`
      SELECT filename, attachment FROM purchasing_board_notices
      WHERE user_id=${owner} AND category=${category} AND id=${attachmentId} AND attachment IS NOT NULL`)
    return { posts: [], attachment }
  }
  const posts = await db.execute<BoardNotice>(sql`
    SELECT id, title, body, filename, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date
    FROM purchasing_board_notices WHERE user_id=${owner} AND category=${category}
      AND position(lower(${query}) in lower(title || ' ' || body || ' ' || coalesce(filename,''))) > 0
    ORDER BY created_at DESC LIMIT 100`)
  return { posts }
}

export async function listBoardCategories(owner: string) {
  const [table] = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('purchasing_board_notices') IS NOT NULL AS exists`)
  if (!table?.exists) return []
  return db.execute<{ id: `custom-${string}`; name: string }>(sql`
    SELECT 'custom-' || id::text AS id, title AS name FROM purchasing_board_notices
    WHERE user_id=${owner} AND category='board-category' ORDER BY created_at, id`)
}

export async function writeBoardNotice(input: {
  owner: string; actor: string; category: NoticeCategory | 'board-category'; title: string; body: string
  filename: string | null; attachment: Buffer | null
}) {
  const id = randomUUID()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('purchasing_board_notices_schema'))`)
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS purchasing_board_notices (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, actor_id uuid NOT NULL,
      category text NOT NULL, title text NOT NULL, body text NOT NULL,
      filename text, attachment text, created_at timestamptz NOT NULL DEFAULT now()
    )`)
    await tx.execute(sql`ALTER TABLE purchasing_board_notices ENABLE ROW LEVEL SECURITY`)
    await tx.execute(sql`REVOKE ALL ON purchasing_board_notices FROM PUBLIC`)
    if (input.category === 'board-category') {
      const [existing] = await tx.execute<{ id: string }>(sql`
        SELECT id FROM purchasing_board_notices WHERE user_id=${input.owner} AND category='board-category' AND lower(title)=lower(${input.title})`)
      if (existing) return existing.id
    } else if (input.category.startsWith('custom-')) {
      const [category] = await tx.execute(sql`SELECT id FROM purchasing_board_notices
        WHERE user_id=${input.owner} AND category='board-category' AND id=${input.category.slice(7)}::uuid`)
      if (!category) throw new Error('게시판 분류가 없습니다.')
    }
    await tx.execute(sql`
      INSERT INTO purchasing_board_notices (id,user_id,actor_id,category,title,body,filename,attachment)
      VALUES (${id},${input.owner},${input.actor},${input.category},${input.title},${input.body},${input.filename},${input.attachment?.toString('base64') ?? null})`)
    return id
  })
}

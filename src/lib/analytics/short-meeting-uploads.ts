import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { ShortMeetingUploadItem } from './short-meeting-upload-parser'

export type ShortMeetingUpload = {
  fileName: string
  meetingDate: string
  appliedAt: string
  rowCount: number
  items: ShortMeetingUploadItem[]
}

let schemaPromise: Promise<void> | null = null
export function ensureShortMeetingUploadSchema() {
  schemaPromise ??= db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('short_meeting_uploads_schema'))`)
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS short_meeting_uploads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      applied_by uuid NOT NULL,
      meeting_date date NOT NULL,
      file_name text NOT NULL,
      file_hash text NOT NULL,
      row_count integer NOT NULL,
      items jsonb NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS short_meeting_uploads_user_date_idx ON short_meeting_uploads (user_id, meeting_date, applied_at DESC)`)
    await tx.execute(sql`ALTER TABLE short_meeting_uploads ENABLE ROW LEVEL SECURITY`)
  }).catch((error) => { schemaPromise = null; throw error })
  return schemaPromise
}

export async function getLatestShortMeetingUpload(userId: string, meetingDate: string): Promise<ShortMeetingUpload | null> {
  await ensureShortMeetingUploadSchema()
  const result = await db.execute<ShortMeetingUpload>(sql`
    SELECT file_name AS "fileName", meeting_date::text AS "meetingDate", applied_at::text AS "appliedAt",
           row_count AS "rowCount", items
    FROM short_meeting_uploads
    WHERE user_id = ${userId}::uuid AND meeting_date = ${meetingDate}::date
    ORDER BY applied_at DESC, id DESC LIMIT 1
  `)
  return resultRows(result)[0] ?? null
}

export async function saveShortMeetingUpload(input: {
  userId: string; actorId: string; meetingDate: string; fileName: string; buffer: Buffer;
  rowCount: number; items: ShortMeetingUploadItem[]
}) {
  await ensureShortMeetingUploadSchema()
  const hash = createHash('sha256').update(input.buffer).digest('hex')
  await db.execute(sql`INSERT INTO short_meeting_uploads
    (user_id, applied_by, meeting_date, file_name, file_hash, row_count, items)
    VALUES (${input.userId}::uuid, ${input.actorId}::uuid, ${input.meetingDate}::date,
      ${input.fileName.slice(0, 255)}, ${hash}, ${input.rowCount}, ${JSON.stringify(input.items)}::jsonb)`)
}

export function isMeetingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export function todayInSeoul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function resultRows<T>(result: T[] | { rows?: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows ?? []
}

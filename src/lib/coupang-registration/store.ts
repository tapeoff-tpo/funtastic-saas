import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { RegistrationDraft } from './model'

const rows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : (result as { rows?: T[] }).rows ?? []

export async function ensureCoupangDrafts() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS coupang_registration_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    name text NOT NULL, payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS coupang_registration_drafts_workspace ON coupang_registration_drafts (user_id, updated_at DESC)`)
  await db.execute(sql`ALTER TABLE coupang_registration_drafts ENABLE ROW LEVEL SECURITY`)
}

export async function listDrafts(userId: string) {
  await ensureCoupangDrafts()
  return rows<{ id: string; name: string; revision: number; updatedAt: string }>(await db.execute(sql`
    SELECT id, name, revision, updated_at::text AS "updatedAt" FROM coupang_registration_drafts
    WHERE user_id = ${userId}::uuid ORDER BY updated_at DESC LIMIT 100
  `))
}

export async function loadDraft(userId: string, id: string) {
  await ensureCoupangDrafts()
  return rows<{ id: string; name: string; payload: RegistrationDraft; revision: number }>(await db.execute(sql`
    SELECT id, name, payload, revision FROM coupang_registration_drafts WHERE user_id = ${userId}::uuid AND id = ${id}::uuid
  `))[0] ?? null
}

export async function saveDraft(userId: string, draft: RegistrationDraft, id?: string, revision?: number) {
  await ensureCoupangDrafts()
  const payload = JSON.stringify(draft)
  const result = id ? await db.execute(sql`
    UPDATE coupang_registration_drafts SET name = ${draft.name}, payload = ${payload}::jsonb, revision = revision + 1, updated_at = now()
    WHERE user_id = ${userId}::uuid AND id = ${id}::uuid AND revision = ${revision ?? 0}
    RETURNING id, revision
  `) : await db.execute(sql`
    INSERT INTO coupang_registration_drafts (user_id, name, payload) VALUES (${userId}::uuid, ${draft.name}, ${payload}::jsonb)
    RETURNING id, revision
  `)
  return rows<{ id: string; revision: number }>(result)[0] ?? null
}

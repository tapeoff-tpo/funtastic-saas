import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ensureCoupangDrafts } from './store'
import { readTemplate } from './excel'

const rows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : (result as { rows?: T[] }).rows ?? []
const templateId = z.string().regex(/^[a-f0-9]{64}$/)
const summarySchema = z.object({ id: templateId, name: z.string().min(1).max(500), sheets: z.array(z.object({ name: z.string().min(1).max(100) })).min(1).max(20) })
export type RegistrationTemplateSummary = z.infer<typeof summarySchema>

/** Reuse official files already saved by this workspace without loading its other draft rows. */
export async function listRegistrationTemplates(workspace: string): Promise<RegistrationTemplateSummary[]> {
  await ensureCoupangDrafts()
  const result = await db.execute(sql`
    SELECT DISTINCT ON (template->>'id') template->>'id' AS id, template->>'name' AS name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name', sheet->>'name'))
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(template->'sheets')='array' THEN template->'sheets' ELSE '[]'::jsonb END) sheet), '[]'::jsonb) AS sheets
    FROM coupang_registration_drafts draft
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(draft.payload->'templates')='array' THEN draft.payload->'templates' ELSE '[]'::jsonb END) template
    WHERE draft.user_id=${workspace}::uuid
    ORDER BY template->>'id', draft.updated_at DESC, draft.id
    LIMIT 100
  `)
  return rows<unknown>(result).flatMap((item) => { const parsed = summarySchema.safeParse(item); return parsed.success ? [parsed.data] : [] })
}

export async function loadRegistrationTemplate(workspace: string, id: string) {
  templateId.parse(id)
  await ensureCoupangDrafts()
  const [stored] = rows<{ template: { file?: { name?: string; data?: string } } }>(await db.execute(sql`
    SELECT template FROM coupang_registration_drafts draft
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(draft.payload->'templates')='array' THEN draft.payload->'templates' ELSE '[]'::jsonb END) template
    WHERE draft.user_id=${workspace}::uuid AND template->>'id'=${id}
    ORDER BY draft.updated_at DESC, draft.id LIMIT 1
  `))
  const file = stored?.template?.file
  if (!file?.name || !file.data) return null
  const parsed = await readTemplate(Buffer.from(file.data, 'base64'), file.name)
  if (parsed.template.id !== id) throw new Error('저장된 카테고리 양식이 변경되었습니다. 쿠팡 최신 양식을 다시 연결해주세요.')
  return parsed.template
}

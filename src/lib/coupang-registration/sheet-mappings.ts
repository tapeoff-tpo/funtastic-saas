import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'

export const sheetMappingCode = z.string().regex(/^\d{1,100}$/)
export const mappedSheetName = z.string().min(1).max(100).regex(/^QF_\d+_.+/)

const mappingSchema = z.object({
  sourceCode: sheetMappingCode,
  sourceCategoryName: z.string().max(200),
  sourceCategoryPath: z.string().max(1000),
  targetSheetName: mappedSheetName,
  updatedAt: z.string().min(1).max(100),
})

export type StoredSheetMapping = z.infer<typeof mappingSchema>
export type SheetMappingInput = Omit<StoredSheetMapping, 'updatedAt'>

const resultRows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : (result as { rows?: T[] }).rows ?? []

/** One explicit worksheet choice per source product, shared by the workspace owner. */
async function ensureSheetMappings() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS coupang_registration_sheet_mappings (
    user_id uuid NOT NULL,
    source_code text NOT NULL,
    source_category_name text NOT NULL DEFAULT '',
    source_category_path text NOT NULL DEFAULT '',
    target_sheet_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source_code)
  )`)
  await db.execute(sql`ALTER TABLE coupang_registration_sheet_mappings ENABLE ROW LEVEL SECURITY`)
}

/** No draft, file hash or login identity is part of this stable product choice. */
export async function listSheetMappings(workspace: string, sourceCode?: string): Promise<StoredSheetMapping[]> {
  if (sourceCode !== undefined) sheetMappingCode.parse(sourceCode)
  await ensureSheetMappings()
  const result = sourceCode === undefined ? await db.execute(sql`
    SELECT source_code AS "sourceCode", source_category_name AS "sourceCategoryName",
      source_category_path AS "sourceCategoryPath", target_sheet_name AS "targetSheetName",
      updated_at::text AS "updatedAt"
    FROM coupang_registration_sheet_mappings
    WHERE user_id = ${workspace}::uuid
    ORDER BY updated_at DESC, source_code
    LIMIT 5000
  `) : await db.execute(sql`
    SELECT source_code AS "sourceCode", source_category_name AS "sourceCategoryName",
      source_category_path AS "sourceCategoryPath", target_sheet_name AS "targetSheetName",
      updated_at::text AS "updatedAt"
    FROM coupang_registration_sheet_mappings
    WHERE user_id = ${workspace}::uuid AND source_code = ${sourceCode}
  `)
  return resultRows<unknown>(result).flatMap((row) => {
    const parsed = mappingSchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

/** Called only after the route verifies the chosen sheet and current B2B category. */
export async function saveSheetMapping(workspace: string, input: SheetMappingInput): Promise<StoredSheetMapping> {
  const checked = mappingSchema.omit({ updatedAt: true }).parse(input)
  await ensureSheetMappings()
  const result = await db.execute(sql`
    INSERT INTO coupang_registration_sheet_mappings
      (user_id, source_code, source_category_name, source_category_path, target_sheet_name)
    VALUES (${workspace}::uuid, ${checked.sourceCode}, ${checked.sourceCategoryName}, ${checked.sourceCategoryPath}, ${checked.targetSheetName})
    ON CONFLICT (user_id, source_code) DO UPDATE SET
      source_category_name = EXCLUDED.source_category_name,
      source_category_path = EXCLUDED.source_category_path,
      target_sheet_name = EXCLUDED.target_sheet_name,
      updated_at = now()
    RETURNING source_code AS "sourceCode", source_category_name AS "sourceCategoryName",
      source_category_path AS "sourceCategoryPath", target_sheet_name AS "targetSheetName",
      updated_at::text AS "updatedAt"
  `)
  const saved = resultRows<unknown>(result)[0]
  return mappingSchema.parse(saved)
}

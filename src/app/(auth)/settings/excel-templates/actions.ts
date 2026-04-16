'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { excelImportTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

export type ExcelMapping = { field: string; excelColumn: string }

export async function getTemplates() {
  const userId = await requireUser()
  return db
    .select()
    .from(excelImportTemplates)
    .where(eq(excelImportTemplates.userId, userId))
    .orderBy(excelImportTemplates.createdAt)
}

export async function createTemplate(name: string, mappings: ExcelMapping[]) {
  const userId = await requireUser()
  if (!name.trim()) throw new Error('양식 이름을 입력해주세요.')
  if (mappings.length === 0) throw new Error('매핑을 하나 이상 추가해주세요.')
  if (!mappings.some((m) => m.field === 'internal_sku')) {
    throw new Error('상품코드(internal_sku) 매핑은 필수입니다.')
  }

  const [created] = await db
    .insert(excelImportTemplates)
    .values({ userId, name: name.trim(), mappings })
    .returning({ id: excelImportTemplates.id })

  return created
}

export async function updateTemplate(id: string, name: string, mappings: ExcelMapping[], isDefault: boolean) {
  const userId = await requireUser()
  if (!mappings.some((m) => m.field === 'internal_sku')) {
    throw new Error('상품코드(internal_sku) 매핑은 필수입니다.')
  }

  // If setting as default, clear other defaults first
  if (isDefault) {
    await db
      .update(excelImportTemplates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(excelImportTemplates.userId, userId))
  }

  await db
    .update(excelImportTemplates)
    .set({ name: name.trim(), mappings, isDefault, updatedAt: new Date() })
    .where(and(eq(excelImportTemplates.id, id), eq(excelImportTemplates.userId, userId)))
}

export async function deleteTemplate(id: string) {
  const userId = await requireUser()
  await db
    .delete(excelImportTemplates)
    .where(and(eq(excelImportTemplates.id, id), eq(excelImportTemplates.userId, userId)))
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { excelImportTemplates, marketplaceConnections } from '@/lib/db/schema'
import { revalidatePath, revalidateTag } from 'next/cache'
import { nanoid } from 'nanoid'
import { and, eq } from 'drizzle-orm'
import type { OrderImportMapping } from '@/lib/orders/excel-import-fields'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

interface ActionResult {
  success?: boolean
  error?: string
}

export interface ExcelImportTemplateView {
  id: string
  name: string
  mappings: OrderImportMapping[]
  isDefault: boolean
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return null
  return getWorkspaceUserId(user.id)
}

function normalizeMappings(raw: string): OrderImportMapping[] {
  const parsed = JSON.parse(raw) as OrderImportMapping[]
  return parsed
    .map((m) => ({
      field: String(m.field ?? '').trim(),
      excelColumn: String(m.excelColumn ?? '').trim(),
      fixedValue: m.fixedValue ? String(m.fixedValue).trim() : undefined,
      extraColumns: Array.isArray(m.extraColumns)
        ? m.extraColumns.map((col) => String(col).trim()).filter(Boolean)
        : undefined,
      joinSeparator: m.joinSeparator ? String(m.joinSeparator) : undefined,
    }))
    .filter((m) => m.field && (m.excelColumn || m.fixedValue))
}

async function listTemplatesForUser(userId: string): Promise<ExcelImportTemplateView[]> {
  const templates = await db
    .select({
      id: excelImportTemplates.id,
      name: excelImportTemplates.name,
      mappings: excelImportTemplates.mappings,
      isDefault: excelImportTemplates.isDefault,
    })
    .from(excelImportTemplates)
    .where(eq(excelImportTemplates.userId, userId))

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    mappings: t.mappings,
    isDefault: t.isDefault,
  }))
}

export async function addManualChannel(
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }

  const rawName = formData.get('displayName') as string
  if (!rawName || rawName.trim() === '') {
    return { error: '쇼핑몰 이름을 입력해주세요.' }
  }

  const displayName = rawName.trim()
  if (displayName.length > 100) {
    return { error: '쇼핑몰 이름은 100자 이내로 입력해주세요.' }
  }

  const marketplaceId = `manual-${nanoid(6)}`

  try {
    await db.insert(marketplaceConnections).values({
      userId: await getWorkspaceUserId(user.id),
      marketplaceId,
      storeAlias: 'default',
      displayName,
      authType: 'api_key',
      status: 'connected',
      isManual: true,
      vaultSecretNames: [],
    })
  } catch (err) {
    return {
      error: `채널 추가 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/orders/collect')
  revalidateTag('orders', 'max')
  return { success: true }
}

export async function createExcelImportTemplate(
  formData: FormData,
): Promise<{ templates?: ExcelImportTemplateView[]; error?: string }> {
  const userId = await getCurrentUserId()
  if (!userId) return { error: '인증이 필요합니다.' }

  const name = String(formData.get('name') ?? '').trim()
  const mappingsRaw = String(formData.get('mappings') ?? '')
  if (!name) return { error: '양식 이름을 입력해주세요.' }

  let mappings: OrderImportMapping[]
  try {
    mappings = normalizeMappings(mappingsRaw)
  } catch {
    return { error: '양식 매핑 정보가 올바르지 않습니다.' }
  }

  if (mappings.length === 0) {
    return { error: '엑셀 컬럼 매핑을 1개 이상 입력해주세요.' }
  }

  await db.insert(excelImportTemplates).values({
    userId,
    name,
    mappings,
    isDefault: false,
  })

  revalidatePath('/orders/collect')
  return { templates: await listTemplatesForUser(userId) }
}

export async function updateExcelImportTemplate(
  formData: FormData,
): Promise<{ templates?: ExcelImportTemplateView[]; error?: string }> {
  const userId = await getCurrentUserId()
  if (!userId) return { error: '인증이 필요합니다.' }

  const templateId = String(formData.get('templateId') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const mappingsRaw = String(formData.get('mappings') ?? '')
  if (!templateId) return { error: '수정할 양식을 찾을 수 없습니다.' }
  if (!name) return { error: '양식 이름을 입력해주세요.' }

  let mappings: OrderImportMapping[]
  try {
    mappings = normalizeMappings(mappingsRaw)
  } catch {
    return { error: '양식 매핑 정보가 올바르지 않습니다.' }
  }

  if (mappings.length === 0) {
    return { error: '엑셀 컬럼 매핑을 1개 이상 입력해주세요.' }
  }

  await db
    .update(excelImportTemplates)
    .set({ name, mappings, updatedAt: new Date() })
    .where(and(eq(excelImportTemplates.id, templateId), eq(excelImportTemplates.userId, userId)))

  revalidatePath('/orders/collect')
  return { templates: await listTemplatesForUser(userId) }
}

export async function deleteExcelImportTemplate(
  templateId: string,
): Promise<{ templates?: ExcelImportTemplateView[]; error?: string }> {
  const userId = await getCurrentUserId()
  if (!userId) return { error: '인증이 필요합니다.' }

  await db
    .delete(excelImportTemplates)
    .where(and(eq(excelImportTemplates.id, templateId), eq(excelImportTemplates.userId, userId)))

  revalidatePath('/orders/collect')
  return { templates: await listTemplatesForUser(userId) }
}

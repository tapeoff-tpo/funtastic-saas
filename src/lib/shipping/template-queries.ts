/**
 * CRUD queries for carrier_templates table.
 *
 * Manages custom and default carrier Excel templates per user.
 * Follows the established Drizzle query pattern from shipping/queries.ts.
 */

import { db } from '@/lib/db'
import { carrierTemplates } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CarrierTemplate } from './types'
import { BUILT_IN_CARRIER_TEMPLATES, DEFAULT_CARRIER_TEMPLATES } from './excel/templates'

function builtInTemplateForUser(template: (typeof BUILT_IN_CARRIER_TEMPLATES)[number], userId = ''): CarrierTemplate {
  return {
    id: template.id,
    userId,
    carrierId: template.carrierId,
    name: template.name,
    columns: template.columns,
    isDefault: template.isDefault,
  }
}

/**
 * Get carrier templates filtered by userId and optional carrierId.
 */
export async function getCarrierTemplates(
  userId: string,
  carrierId?: string,
): Promise<CarrierTemplate[]> {
  const conditions = [eq(carrierTemplates.userId, userId)]
  if (carrierId) {
    conditions.push(eq(carrierTemplates.carrierId, carrierId))
  }

  const rows = await db
    .select()
    .from(carrierTemplates)
    .where(and(...conditions))

  const templates = rows as unknown as CarrierTemplate[]
  if (carrierId) return templates

  const existingNames = new Set(templates.map((template) => template.name))
  return [
    ...templates,
    ...BUILT_IN_CARRIER_TEMPLATES
      .filter((template) => !existingNames.has(template.name))
      .map((template) => builtInTemplateForUser(template, userId)),
  ]
}

/**
 * Get a single carrier template by ID.
 */
export async function getCarrierTemplateById(
  templateId: string,
): Promise<CarrierTemplate | null> {
  const builtIn = BUILT_IN_CARRIER_TEMPLATES.find((template) => template.id === templateId)
  if (builtIn) return builtInTemplateForUser(builtIn)

  const [row] = await db
    .select()
    .from(carrierTemplates)
    .where(eq(carrierTemplates.id, templateId))

  return (row as unknown as CarrierTemplate) ?? null
}

/**
 * Create a new carrier template.
 */
export async function createCarrierTemplate(
  data: Omit<CarrierTemplate, 'id'>,
): Promise<{ id: string }> {
  const [created] = await db
    .insert(carrierTemplates)
    .values({
      userId: data.userId,
      // carrierId 가 null 이면 그대로 NULL 저장 — 자유 양식
      carrierId: data.carrierId ?? null,
      name: data.name,
      columns: data.columns,
      isDefault: data.isDefault,
    })
    .returning({ id: carrierTemplates.id })

  return { id: created.id }
}

/**
 * Update a carrier template's name, columns, or isDefault flag.
 */
export async function updateCarrierTemplate(
  templateId: string,
  data: Partial<Pick<CarrierTemplate, 'name' | 'columns' | 'isDefault'>>,
): Promise<void> {
  await db
    .update(carrierTemplates)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(carrierTemplates.id, templateId))
}

/**
 * Delete a carrier template.
 */
export async function deleteCarrierTemplate(
  templateId: string,
): Promise<void> {
  await db
    .delete(carrierTemplates)
    .where(eq(carrierTemplates.id, templateId))
}

/**
 * Seed default carrier templates for a new user.
 * Skips if the user already has default templates.
 */
export async function seedDefaultTemplates(
  userId: string,
): Promise<void> {
  // Check if user already has default templates
  const existing = await db
    .select()
    .from(carrierTemplates)
    .where(
      and(
        eq(carrierTemplates.userId, userId),
        eq(carrierTemplates.isDefault, true),
      ),
    )

  if (existing.length > 0) {
    return
  }

  // Insert all default templates for this user
  await db.insert(carrierTemplates).values(
    DEFAULT_CARRIER_TEMPLATES.map((template) => ({
      userId,
      carrierId: template.carrierId,
      name: template.name,
      columns: template.columns,
      isDefault: true,
    })),
  )
}

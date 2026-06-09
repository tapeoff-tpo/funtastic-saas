import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boxCostRates } from '@/lib/db/schema'

export interface BoxCostRateInput {
  packageName: string
  unitCost: number
  effectiveFrom: string
  isActive: boolean
}

export function parseBoxCostRateInput(body: unknown): BoxCostRateInput {
  const value = body as Record<string, unknown>
  const packageName = String(value?.packageName ?? '').trim()
  const unitCost = Number(value?.unitCost)
  const effectiveFrom = String(value?.effectiveFrom ?? '').trim()
  const isActive = value?.isActive !== false

  if (!packageName) throw new Error('박스명을 입력해주세요.')
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('박스 단가를 확인해주세요.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new Error('적용 시작일을 확인해주세요.')
  return { packageName, unitCost, effectiveFrom, isActive }
}

export async function ensureBoxCostRatesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS box_cost_rates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      package_name varchar(100) NOT NULL,
      unit_cost numeric(12, 2) NOT NULL,
      effective_from date NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS box_cost_rates_user_package_effective_unique
      ON box_cost_rates(user_id, package_name, effective_from)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS box_cost_rates_user_active_idx
      ON box_cost_rates(user_id, is_active)
  `)
}

export async function listBoxCostRates(userId: string) {
  await ensureBoxCostRatesTable()
  return db
    .select()
    .from(boxCostRates)
    .where(eq(boxCostRates.userId, userId))
    .orderBy(boxCostRates.packageName, desc(boxCostRates.effectiveFrom))
}

export async function createBoxCostRate(userId: string, input: BoxCostRateInput) {
  await ensureBoxCostRatesTable()
  const [created] = await db
    .insert(boxCostRates)
    .values({
      userId,
      packageName: input.packageName,
      unitCost: String(input.unitCost),
      effectiveFrom: input.effectiveFrom,
      isActive: input.isActive,
    })
    .returning()
  return created
}

export async function updateBoxCostRate(userId: string, id: string, input: BoxCostRateInput) {
  await ensureBoxCostRatesTable()
  const [updated] = await db
    .update(boxCostRates)
    .set({
      packageName: input.packageName,
      unitCost: String(input.unitCost),
      effectiveFrom: input.effectiveFrom,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(boxCostRates.id, id), eq(boxCostRates.userId, userId)))
    .returning()
  return updated
}

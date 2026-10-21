import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseBudgetComparisons } from '@/lib/db/schema'
import type { PurchaseBudgetComparison } from './purchase-budget-comparison'

let ensureSchemaPromise: Promise<void> | null = null

export function ensurePurchaseBudgetComparisonSchema() {
  ensureSchemaPromise ??= db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('purchase-budget-comparisons-schema'))`)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS public.purchase_budget_comparisons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        snapshot jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await tx.execute(sql`ALTER TABLE public.purchase_budget_comparisons ENABLE ROW LEVEL SECURITY`)
    await tx.execute(sql`REVOKE ALL ON public.purchase_budget_comparisons FROM PUBLIC, anon, authenticated`)
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS purchase_budget_comparisons_user_created
      ON public.purchase_budget_comparisons (user_id, created_at)
    `)
  }).catch((error) => {
    ensureSchemaPromise = null
    throw error
  })
  return ensureSchemaPromise
}

export async function getLatestPurchaseBudgetComparison(userId: string) {
  await ensurePurchaseBudgetComparisonSchema()
  const [row] = await db
    .select({ snapshot: purchaseBudgetComparisons.snapshot })
    .from(purchaseBudgetComparisons)
    .where(eq(purchaseBudgetComparisons.userId, userId))
    .orderBy(desc(purchaseBudgetComparisons.createdAt), desc(purchaseBudgetComparisons.id))
    .limit(1)
  if (!row || row.snapshot.version !== 1 || !Array.isArray(row.snapshot.rows)) return null
  return row.snapshot as PurchaseBudgetComparison
}

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { giftRules, inventory } from '@/lib/db/schema'

export type GiftConditionType = 'amount' | 'sku' | 'marketplaceProductCode'
export interface GiftRuleCondition {
  type: GiftConditionType
  value: string
}

export interface GiftRuleInput {
  name: string
  marketplaceId?: string | null
  conditionType: GiftConditionType
  minAmount?: string | null
  triggerSku?: string | null
  conditions?: GiftRuleCondition[]
  giftSku: string
  giftQuantity: number
  isActive?: boolean
}

export async function ensureGiftRulesTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gift_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "name" varchar(200) NOT NULL,
      "marketplace_id" varchar(50),
      "condition_type" varchar(20) NOT NULL,
      "min_amount" numeric(12, 2),
      "trigger_sku" varchar(100),
      "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "gift_sku" varchar(100) NOT NULL,
      "gift_quantity" integer DEFAULT 1 NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`ALTER TABLE "gift_rules" ADD COLUMN IF NOT EXISTS "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gift_rules_user_active" ON "gift_rules" ("user_id", "is_active")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gift_rules_user_marketplace" ON "gift_rules" ("user_id", "marketplace_id")`)
}

export async function listGiftRules(userId: string) {
  await ensureGiftRulesTable()
  return db
    .select({
      id: giftRules.id,
      name: giftRules.name,
      marketplaceId: giftRules.marketplaceId,
      conditionType: giftRules.conditionType,
      minAmount: giftRules.minAmount,
      triggerSku: giftRules.triggerSku,
      conditions: giftRules.conditions,
      giftSku: giftRules.giftSku,
      giftQuantity: giftRules.giftQuantity,
      isActive: giftRules.isActive,
      giftProductName: inventory.productName,
      giftOptionName: inventory.optionName,
      createdAt: giftRules.createdAt,
      updatedAt: giftRules.updatedAt,
    })
    .from(giftRules)
    .leftJoin(
      inventory,
      and(eq(inventory.userId, giftRules.userId), eq(inventory.sku, giftRules.giftSku)),
    )
    .where(eq(giftRules.userId, userId))
    .orderBy(sql`${giftRules.updatedAt} DESC`)
}

export async function createGiftRule(userId: string, input: GiftRuleInput) {
  await ensureGiftRulesTable()
  const [created] = await db
    .insert(giftRules)
    .values({
      userId,
      name: input.name,
      marketplaceId: input.marketplaceId || null,
      conditionType: input.conditionType,
      minAmount: input.conditionType === 'amount' ? input.minAmount ?? '0' : null,
      triggerSku: input.conditionType === 'sku' ? input.triggerSku ?? null : null,
      conditions: input.conditions ?? [],
      giftSku: input.giftSku,
      giftQuantity: input.giftQuantity,
      isActive: input.isActive ?? true,
    })
    .returning({ id: giftRules.id })
  return created
}

export async function deleteGiftRule(userId: string, id: string) {
  await ensureGiftRulesTable()
  const deleted = await db
    .delete(giftRules)
    .where(and(eq(giftRules.userId, userId), eq(giftRules.id, id)))
    .returning({ id: giftRules.id })
  return deleted.length
}

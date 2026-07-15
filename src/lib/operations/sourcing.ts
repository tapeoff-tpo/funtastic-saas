import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sourcingCandidates, sourcingItems } from '@/lib/db/schema'

export const SOURCING_STATUS_LABELS: Record<string, string> = {
  captured: '쿠팡 기록',
  searching: '1688 검색중',
  candidate_review: '후보 검토',
  selected: '소싱 확정',
  ignored: '보류',
}

export const SOURCING_STATUS_OPTIONS = Object.keys(SOURCING_STATUS_LABELS)

function cleanText(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text.length ? text : null
}

function cleanNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

export async function ensureSourcingTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sourcing_items" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "source_platform" varchar(30) NOT NULL DEFAULT 'coupang',
      "source_title" text NOT NULL,
      "source_url" text,
      "image_url" text,
      "category" varchar(120),
      "source_rank" integer,
      "source_price" integer,
      "keyword" varchar(200),
      "status" varchar(30) NOT NULL DEFAULT 'captured',
      "selected_1688_url" text,
      "selected_at" timestamp with time zone,
      "memo" text,
      "raw_data" jsonb DEFAULT '{}'::jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "source_platform" varchar(30) NOT NULL DEFAULT 'coupang'`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "source_url" text`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "image_url" text`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "category" varchar(120)`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "source_rank" integer`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "source_price" integer`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "keyword" varchar(200)`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "selected_1688_url" text`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "selected_at" timestamp with time zone`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "memo" text`)
  await db.execute(sql`ALTER TABLE "sourcing_items" ADD COLUMN IF NOT EXISTS "raw_data" jsonb DEFAULT '{}'::jsonb`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_items_user_status_idx" ON "sourcing_items" ("user_id", "status")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_items_user_updated_idx" ON "sourcing_items" ("user_id", "updated_at")`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sourcing_candidates" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "item_id" uuid NOT NULL REFERENCES "sourcing_items"("id") ON DELETE cascade,
      "platform" varchar(30) NOT NULL DEFAULT '1688',
      "title" text,
      "candidate_url" text NOT NULL,
      "image_url" text,
      "price_text" varchar(100),
      "supplier_name" varchar(200),
      "match_score" integer,
      "is_selected" boolean NOT NULL DEFAULT false,
      "memo" text,
      "raw_data" jsonb DEFAULT '{}'::jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "image_url" text`)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "price_text" varchar(100)`)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "supplier_name" varchar(200)`)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "match_score" integer`)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "is_selected" boolean NOT NULL DEFAULT false`)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "memo" text`)
  await db.execute(sql`ALTER TABLE "sourcing_candidates" ADD COLUMN IF NOT EXISTS "raw_data" jsonb DEFAULT '{}'::jsonb`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_candidates_item_created_idx" ON "sourcing_candidates" ("item_id", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_candidates_user_created_idx" ON "sourcing_candidates" ("user_id", "created_at")`)
}

export async function listSourcingBoard(userId: string) {
  await ensureSourcingTables()
  const items = await db
    .select()
    .from(sourcingItems)
    .where(eq(sourcingItems.userId, userId))
    .orderBy(desc(sourcingItems.updatedAt), desc(sourcingItems.createdAt))
    .limit(300)

  if (!items.length) return []

  const itemIds = items.map((item) => item.id)
  const candidates = await db
    .select()
    .from(sourcingCandidates)
    .where(and(eq(sourcingCandidates.userId, userId), inArray(sourcingCandidates.itemId, itemIds)))
    .orderBy(desc(sourcingCandidates.isSelected), desc(sourcingCandidates.createdAt))

  const candidatesByItem = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const list = candidatesByItem.get(candidate.itemId) ?? []
    list.push(candidate)
    candidatesByItem.set(candidate.itemId, list)
  }

  return items.map((item) => ({
    ...item,
    candidates: candidatesByItem.get(item.id) ?? [],
  }))
}

export async function createSourcingItem(input: {
  userId: string
  sourceTitle: string
  sourceUrl?: string | null
  imageUrl?: string | null
  category?: string | null
  sourceRank?: number | null
  sourcePrice?: number | null
  keyword?: string | null
  memo?: string | null
}) {
  await ensureSourcingTables()
  const sourceTitle = input.sourceTitle.trim()
  if (!sourceTitle) return { error: '상품명을 입력해 주세요.' as const }
  const sourceUrl = cleanText(input.sourceUrl)
  const values = {
    sourcePlatform: 'coupang',
    sourceTitle,
    sourceUrl,
    imageUrl: cleanText(input.imageUrl),
    category: cleanText(input.category),
    sourceRank: cleanNumber(input.sourceRank),
    sourcePrice: cleanNumber(input.sourcePrice),
    keyword: cleanText(input.keyword),
    memo: cleanText(input.memo),
    rawData: {},
    updatedAt: new Date(),
  }

  if (sourceUrl) {
    const [existing] = await db
      .select({ id: sourcingItems.id })
      .from(sourcingItems)
      .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.sourceUrl, sourceUrl)))
      .limit(1)

    if (existing) {
      await db
        .update(sourcingItems)
        .set(values)
        .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, existing.id)))
      return { id: existing.id, updated: true }
    }
  }

  const [row] = await db
    .insert(sourcingItems)
    .values({
      userId: input.userId,
      status: 'captured',
      ...values,
    })
    .returning({ id: sourcingItems.id })

  return { id: row.id }
}

export async function updateSourcingItemStatus(input: {
  userId: string
  itemId: string
  status: string
}) {
  await ensureSourcingTables()
  const status = SOURCING_STATUS_OPTIONS.includes(input.status) ? input.status : 'captured'
  await db
    .update(sourcingItems)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, input.itemId)))
  return { success: true }
}

export async function addSourcingCandidate(input: {
  userId: string
  itemId: string
  title?: string | null
  candidateUrl: string
  imageUrl?: string | null
  priceText?: string | null
  supplierName?: string | null
  matchScore?: number | null
  memo?: string | null
}) {
  await ensureSourcingTables()
  const candidateUrl = input.candidateUrl.trim()
  if (!candidateUrl) return { error: '1688 후보 URL을 입력해 주세요.' as const }

  const [item] = await db
    .select({ id: sourcingItems.id, status: sourcingItems.status })
    .from(sourcingItems)
    .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, input.itemId)))
    .limit(1)
  if (!item) return { error: '소싱 상품을 찾을 수 없습니다.' as const }

  const candidateValues = {
    title: cleanText(input.title),
    imageUrl: cleanText(input.imageUrl),
    priceText: cleanText(input.priceText),
    supplierName: cleanText(input.supplierName),
    matchScore: cleanNumber(input.matchScore),
    memo: cleanText(input.memo),
    updatedAt: new Date(),
  }

  const [existingCandidate] = await db
    .select({ id: sourcingCandidates.id })
    .from(sourcingCandidates)
    .where(and(
      eq(sourcingCandidates.userId, input.userId),
      eq(sourcingCandidates.itemId, input.itemId),
      eq(sourcingCandidates.candidateUrl, candidateUrl),
    ))
    .limit(1)

  const [row] = existingCandidate
    ? await db
      .update(sourcingCandidates)
      .set(candidateValues)
      .where(eq(sourcingCandidates.id, existingCandidate.id))
      .returning({ id: sourcingCandidates.id })
    : await db
      .insert(sourcingCandidates)
      .values({
        userId: input.userId,
        itemId: input.itemId,
        platform: '1688',
        candidateUrl,
        ...candidateValues,
        rawData: {},
      })
      .returning({ id: sourcingCandidates.id })

  if (item.status !== 'selected') {
    await db
      .update(sourcingItems)
      .set({ status: 'candidate_review', updatedAt: new Date() })
      .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, input.itemId)))
  }

  return { id: row.id }
}

export async function selectSourcingCandidate(input: {
  userId: string
  itemId: string
  candidateId: string
}) {
  await ensureSourcingTables()
  const [candidate] = await db
    .select({
      id: sourcingCandidates.id,
      itemId: sourcingCandidates.itemId,
      candidateUrl: sourcingCandidates.candidateUrl,
    })
    .from(sourcingCandidates)
    .where(and(
      eq(sourcingCandidates.userId, input.userId),
      eq(sourcingCandidates.itemId, input.itemId),
      eq(sourcingCandidates.id, input.candidateId),
    ))
    .limit(1)

  if (!candidate) return { error: '1688 후보를 찾을 수 없습니다.' as const }

  await db
    .update(sourcingCandidates)
    .set({ isSelected: false, updatedAt: new Date() })
    .where(and(eq(sourcingCandidates.userId, input.userId), eq(sourcingCandidates.itemId, input.itemId)))

  await db
    .update(sourcingCandidates)
    .set({ isSelected: true, updatedAt: new Date() })
    .where(and(eq(sourcingCandidates.userId, input.userId), eq(sourcingCandidates.id, candidate.id)))

  await db
    .update(sourcingItems)
    .set({
      status: 'selected',
      selected1688Url: candidate.candidateUrl,
      selectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, candidate.itemId)))

  return { success: true }
}

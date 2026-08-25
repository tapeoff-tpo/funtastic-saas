import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getProfile } from '@/lib/admin-accounts/queries'
import { products, sourcingCandidates, sourcingItems } from '@/lib/db/schema'
import { calculateCnyCostKrw } from '@/lib/new-products/cny-cost'
import { ensureNewProductWorkflowTables } from '@/lib/new-products/workflow'
import { ESA009M_HEADERS } from '@/lib/purchasing/items'

export const SOURCING_STATUS_LABELS: Record<string, string> = {
  draft: '작성 중',
  passed: '1차 통과',
  hold: '보류',
  captured: '쿠팡 기록',
  searching: '1688 검색중',
  candidate_review: '후보 검토',
  selected: '소싱 확정',
  ignored: '보류',
}

export const SOURCING_STATUS_OPTIONS = Object.keys(SOURCING_STATUS_LABELS)

export type SourcingOperator = {
  id: string
  memberUserId: string
  displayName: string
  position: number
  isActive: boolean
}

export type SourcingViewer = {
  isMain: boolean
  operatorId: string | null
}

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
    CREATE TABLE IF NOT EXISTS sourcing_operators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      member_user_id uuid NOT NULL,
      display_name varchar(100) NOT NULL,
      position integer NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sourcing_operators_workspace_member_unique UNIQUE (user_id, member_user_id)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS sourcing_operators_workspace_active_idx
    ON sourcing_operators(user_id, is_active, position)
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS sourcing_operators_workspace_active_position_unique
    ON sourcing_operators(user_id, position)
    WHERE is_active = TRUE
  `)
  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.new_product_workflow_operators') IS NOT NULL THEN
        INSERT INTO sourcing_operators (
          id, user_id, member_user_id, display_name, position, is_active, created_at, updated_at
        )
        SELECT
          id, user_id, member_user_id, display_name, position, is_active, created_at, updated_at
        FROM new_product_workflow_operators
        ON CONFLICT (id) DO NOTHING;
      END IF;
    END $$
  `)
  await db.execute(sql`ALTER TABLE sourcing_operators ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`REVOKE ALL ON TABLE sourcing_operators FROM anon, authenticated`)
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
  await db.execute(sql`
    ALTER TABLE "sourcing_items"
      ADD COLUMN IF NOT EXISTS "meeting_id" uuid,
      ADD COLUMN IF NOT EXISTS "owner_operator_id" uuid,
      ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
      ADD COLUMN IF NOT EXISTS "product_option" text,
      ADD COLUMN IF NOT EXISTS "china_unit_price_cny" numeric(14, 2),
      ADD COLUMN IF NOT EXISTS "unit_shipping_cny" numeric(14, 2),
      ADD COLUMN IF NOT EXISTS "exchange_rate_krw" numeric(14, 4),
      ADD COLUMN IF NOT EXISTS "calculated_cost_krw" integer,
      ADD COLUMN IF NOT EXISTS "domestic_sale_url" text,
      ADD COLUMN IF NOT EXISTS "domestic_sale_price" integer,
      ADD COLUMN IF NOT EXISTS "detail_page_url" text,
      ADD COLUMN IF NOT EXISTS "memo_1" text,
      ADD COLUMN IF NOT EXISTS "memo_2" text,
      ADD COLUMN IF NOT EXISTS "passed_at" timestamp with time zone,
      ADD COLUMN IF NOT EXISTS "passed_new_product_id" uuid,
      ADD COLUMN IF NOT EXISTS "image_file_name" text,
      ADD COLUMN IF NOT EXISTS "image_content_type" varchar(160),
      ADD COLUMN IF NOT EXISTS "image_file_size" integer,
      ADD COLUMN IF NOT EXISTS "image_file_data" bytea
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_items_user_status_idx" ON "sourcing_items" ("user_id", "status")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_items_user_updated_idx" ON "sourcing_items" ("user_id", "updated_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_items_workspace_owner_updated_idx" ON "sourcing_items" ("user_id", "owner_operator_id", "updated_at")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sourcing_meetings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "meeting_date" date NOT NULL DEFAULT CURRENT_DATE,
      "title" text NOT NULL,
      "status" varchar(30) NOT NULL DEFAULT 'open',
      "created_by_user_id" uuid,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_meetings_workspace_date_idx" ON "sourcing_meetings" ("user_id", "meeting_date" DESC, "created_at" DESC)`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "sourcing_meetings_workspace_legacy_unique" ON "sourcing_meetings" ("user_id") WHERE "title" = '이전 수집 데이터'`)
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sourcing_items_meeting_id_fkey'
      ) THEN
        ALTER TABLE "sourcing_items"
          ADD CONSTRAINT sourcing_items_meeting_id_fkey
          FOREIGN KEY (meeting_id)
          REFERENCES "sourcing_meetings"(id)
          ON DELETE SET NULL;
      END IF;
    END $$
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sourcing_items_workspace_meeting_owner_updated_idx" ON "sourcing_items" ("user_id", "meeting_id", "owner_operator_id", "updated_at" DESC)`)
  await db.execute(sql`
    INSERT INTO sourcing_meetings (user_id, meeting_date, title, status)
    SELECT item.user_id, COALESCE(MIN(item.created_at)::date, CURRENT_DATE), '이전 수집 데이터', 'archived'
    FROM sourcing_items item
    WHERE item.meeting_id IS NULL
    GROUP BY item.user_id
    ON CONFLICT DO NOTHING
  `)
  await db.execute(sql`
    UPDATE sourcing_items item
    SET meeting_id = meeting.id
    FROM sourcing_meetings meeting
    WHERE item.meeting_id IS NULL
      AND meeting.user_id = item.user_id
      AND meeting.title = '이전 수집 데이터'
  `)
  await db.execute(sql`ALTER TABLE "sourcing_meetings" ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`REVOKE ALL ON TABLE "sourcing_meetings" FROM anon, authenticated`)

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

export async function listSourcingOperators(userId: string): Promise<SourcingOperator[]> {
  await ensureSourcingTables()
  return resultRows<SourcingOperator>(await db.execute(sql`
    SELECT
      id,
      member_user_id AS "memberUserId",
      display_name AS "displayName",
      position,
      is_active AS "isActive"
    FROM sourcing_operators
    WHERE user_id = ${userId}::uuid
      AND is_active = TRUE
    ORDER BY position, created_at
  `))
}

export async function getSourcingViewer(input: { userId: string; actorUserId: string }): Promise<SourcingViewer> {
  await ensureSourcingTables()
  const profile = await getProfile(input.actorUserId)
  const isMain = profile?.role === 'super_admin' && !profile.deactivatedAt
  if (isMain) return { isMain: true, operatorId: null }

  const [operator] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM sourcing_operators
    WHERE user_id = ${input.userId}::uuid
      AND member_user_id = ${input.actorUserId}::uuid
      AND is_active = TRUE
    LIMIT 1
  `))
  return { isMain: false, operatorId: operator?.id ?? null }
}

export async function saveSourcingOperators(input: {
  userId: string
  actorUserId: string
  operators: Array<{ memberUserId: string; displayName: string }>
}) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.actorUserId })
  if (!viewer.isMain) throw new Error('소싱 등록자 설정은 메인만 변경할 수 있습니다.')

  const operators = input.operators
    .map((operator) => ({
      memberUserId: operator.memberUserId.trim(),
      displayName: operator.displayName.trim().slice(0, 100),
    }))
    .filter((operator) => operator.memberUserId && operator.displayName)
  if (operators.length === 0) throw new Error('소싱 등록자를 1명 이상 설정해주세요.')
  if (new Set(operators.map((operator) => operator.memberUserId)).size !== operators.length) {
    throw new Error('같은 계정을 소싱 등록자에 중복으로 지정할 수 없습니다.')
  }

  const memberRows = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM user_profiles
    WHERE id IN (${sql.join(operators.map((operator) => sql`${operator.memberUserId}::uuid`), sql`, `)})
      AND deactivated_at IS NULL
  `))
  if (memberRows.length !== operators.length) throw new Error('활성 계정만 소싱 등록자로 지정할 수 있습니다.')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sourcing-operators:${input.userId}`}))`)
    await tx.execute(sql`
      UPDATE sourcing_operators
      SET is_active = FALSE, updated_at = now()
      WHERE user_id = ${input.userId}::uuid
    `)
    for (const [index, operator] of operators.entries()) {
      await tx.execute(sql`
        INSERT INTO sourcing_operators (
          user_id, member_user_id, display_name, position, is_active, updated_at
        ) VALUES (
          ${input.userId}::uuid, ${operator.memberUserId}::uuid, ${operator.displayName}, ${index + 1}, TRUE, now()
        )
        ON CONFLICT (user_id, member_user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          position = EXCLUDED.position,
          is_active = TRUE,
          updated_at = now()
      `)
    }
  })
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

export async function promoteSourcingItemToPurchasingItem(input: {
  userId: string
  itemId: string
  sku: string
  name?: string | null
  optionName?: string | null
  data?: Partial<Record<(typeof ESA009M_HEADERS)[number], string | null>>
}) {
  await ensureSourcingTables()
  const sku = input.sku.trim()
  const name = cleanText(input.name)
  if (!sku || !name) return { error: '품목코드와 품목명을 입력해 주세요.' as const }

  const [source] = await db
    .select()
    .from(sourcingItems)
    .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, input.itemId)))
    .limit(1)

  if (!source) return { error: '소싱 상품을 찾을 수 없습니다.' as const }
  if (source.status !== 'selected' || !source.selected1688Url) {
    return { error: '1688 후보를 확정한 소싱 상품만 품목으로 등록할 수 있습니다.' as const }
  }

  const sourceData = isRecord(source.rawData) ? source.rawData : {}
  const priorPromotion = isRecord(sourceData.purchasingItem) ? sourceData.purchasingItem : null
  if (typeof priorPromotion?.productId === 'string' && typeof priorPromotion.sku === 'string') {
    return { productId: priorPromotion.productId, sku: priorPromotion.sku, existing: true }
  }

  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.userId, input.userId), eq(products.internalSku, sku)))
    .limit(1)
  if (existing) return { error: '이미 같은 품목코드가 있습니다. 기존 품목을 사용하거나 다른 코드를 입력해 주세요.' as const }

  const esa009m = Object.fromEntries(ESA009M_HEADERS.map((header) => [header, null])) as Record<string, string | null>
  esa009m['품목코드'] = sku
  esa009m['품목명'] = name
  esa009m['규격정보'] = cleanText(input.optionName)
  for (const header of ESA009M_HEADERS) {
    if (header === '품목코드' || header === '품목명' || header === '규격정보') continue
    const value = input.data?.[header]
    if (value !== undefined) esa009m[header] = cleanText(value)
  }
  esa009m['구매 URL'] = cleanText(input.data?.['구매 URL']) ?? source.selected1688Url

  const [product] = await db
    .insert(products)
    .values({
      userId: input.userId,
      internalSku: sku,
      name,
      basePrice: '0',
      costPrice: wonNumber(esa009m['works 신규 원가'] ?? esa009m['works 기존 원가']),
      status: 'draft',
      manageInventory: false,
      images: source.imageUrl ? [{ url: source.imageUrl, sortOrder: 0 }] : null,
      metadata: {
        esa009m,
        sourcing: {
          sourcingItemId: source.id,
          sourcePlatform: source.sourcePlatform,
          sourceTitle: source.sourceTitle,
          sourceUrl: source.sourceUrl,
          selected1688Url: source.selected1688Url,
          promotedAt: new Date().toISOString(),
        },
      },
    })
    .returning({ id: products.id })

  await db
    .update(sourcingItems)
    .set({
      rawData: {
        ...sourceData,
        purchasingItem: { productId: product.id, sku, promotedAt: new Date().toISOString() },
      },
      updatedAt: new Date(),
    })
    .where(and(eq(sourcingItems.userId, input.userId), eq(sourcingItems.id, source.id)))

  return { productId: product.id, sku, existing: false }
}

export type ManualSourcingItem = {
  id: string
  meetingId: string | null
  ownerOperatorId: string | null
  ownerName: string | null
  productName: string
  productOption: string | null
  chinaPurchaseUrl: string | null
  chinaUnitPriceCny: number | null
  unitShippingCny: number | null
  exchangeRateKrw: number | null
  calculatedCostKrw: number | null
  domesticSaleUrl: string | null
  domesticSalePrice: number | null
  detailPageUrl: string | null
  memo1: string | null
  memo2: string | null
  status: string
  hasImageFile: boolean
  legacyImageUrl: string | null
  passedNewProductId: string | null
  createdAt: string
  updatedAt: string
}

export type SourcingMeeting = {
  id: string
  meetingDate: string
  title: string
  status: 'open' | 'closed' | 'archived'
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
  items: ManualSourcingItem[]
}

export type SourcingMeetingInput = {
  meetingDate: string
  title?: string | null
  status?: 'open' | 'closed' | 'archived'
}

export type ManualSourcingInput = {
  meetingId?: string | null
  productName: string
  productOption?: string | null
  chinaPurchaseUrl?: string | null
  chinaUnitPriceCny?: number | null
  unitShippingCny?: number | null
  exchangeRateKrw?: number | null
  domesticSaleUrl?: string | null
  domesticSalePrice?: number | null
  detailPageUrl?: string | null
  memo1?: string | null
  memo2?: string | null
  ownerOperatorId?: string | null
}

export async function listManualSourcingItems(input: { userId: string; actorUserId: string }) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer(input)
  return resultRows<ManualSourcingItem>(await db.execute(sql`
    SELECT
      item.id,
      item.meeting_id AS "meetingId",
      item.owner_operator_id AS "ownerOperatorId",
      operator.display_name AS "ownerName",
      item.source_title AS "productName",
      item.product_option AS "productOption",
      item.source_url AS "chinaPurchaseUrl",
      item.china_unit_price_cny::float8 AS "chinaUnitPriceCny",
      item.unit_shipping_cny::float8 AS "unitShippingCny",
      item.exchange_rate_krw::float8 AS "exchangeRateKrw",
      item.calculated_cost_krw AS "calculatedCostKrw",
      item.domestic_sale_url AS "domesticSaleUrl",
      item.domestic_sale_price AS "domesticSalePrice",
      item.detail_page_url AS "detailPageUrl",
      item.memo_1 AS "memo1",
      item.memo_2 AS "memo2",
      item.status,
      (item.image_file_data IS NOT NULL) AS "hasImageFile",
      item.image_url AS "legacyImageUrl",
      item.passed_new_product_id AS "passedNewProductId",
      item.created_at::text AS "createdAt",
      item.updated_at::text AS "updatedAt"
    FROM sourcing_items item
    LEFT JOIN sourcing_operators operator ON operator.id = item.owner_operator_id
    WHERE item.user_id = ${input.userId}::uuid
      AND (${viewer.isMain
        ? sql`TRUE`
        : viewer.operatorId
          ? sql`item.owner_operator_id = ${viewer.operatorId}::uuid`
          : sql`FALSE`})
    ORDER BY item.updated_at DESC, item.created_at DESC
    LIMIT 300
  `))
}

export async function listSourcingMeetings(input: { userId: string; actorUserId: string }): Promise<SourcingMeeting[]> {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer(input)
  const meetings = resultRows<Omit<SourcingMeeting, 'items'>>(await db.execute(sql`
    SELECT
      meeting.id,
      meeting.meeting_date::text AS "meetingDate",
      meeting.title,
      meeting.status,
      meeting.created_by_user_id AS "createdByUserId",
      meeting.created_at::text AS "createdAt",
      meeting.updated_at::text AS "updatedAt"
    FROM sourcing_meetings meeting
    WHERE meeting.user_id = ${input.userId}::uuid
    ORDER BY meeting.meeting_date DESC, meeting.created_at DESC
    LIMIT 100
  `))
  if (meetings.length === 0) return []

  const meetingIds = meetings.map((meeting) => meeting.id)
  const items = resultRows<ManualSourcingItem>(await db.execute(sql`
    SELECT
      item.id,
      item.meeting_id AS "meetingId",
      item.owner_operator_id AS "ownerOperatorId",
      operator.display_name AS "ownerName",
      item.source_title AS "productName",
      item.product_option AS "productOption",
      item.source_url AS "chinaPurchaseUrl",
      item.china_unit_price_cny::float8 AS "chinaUnitPriceCny",
      item.unit_shipping_cny::float8 AS "unitShippingCny",
      item.exchange_rate_krw::float8 AS "exchangeRateKrw",
      item.calculated_cost_krw AS "calculatedCostKrw",
      item.domestic_sale_url AS "domesticSaleUrl",
      item.domestic_sale_price AS "domesticSalePrice",
      item.detail_page_url AS "detailPageUrl",
      item.memo_1 AS "memo1",
      item.memo_2 AS "memo2",
      item.status,
      (item.image_file_data IS NOT NULL) AS "hasImageFile",
      item.image_url AS "legacyImageUrl",
      item.passed_new_product_id AS "passedNewProductId",
      item.created_at::text AS "createdAt",
      item.updated_at::text AS "updatedAt"
    FROM sourcing_items item
    LEFT JOIN sourcing_operators operator ON operator.id = item.owner_operator_id
    WHERE item.user_id = ${input.userId}::uuid
      AND item.meeting_id IN (${sql.join(meetingIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND (${viewer.isMain
        ? sql`TRUE`
        : viewer.operatorId
          ? sql`item.owner_operator_id = ${viewer.operatorId}::uuid`
          : sql`FALSE`})
    ORDER BY operator.position NULLS LAST, item.updated_at DESC, item.created_at DESC
  `))
  const itemsByMeeting = new Map<string, ManualSourcingItem[]>()
  for (const item of items) {
    if (!item.meetingId) continue
    const list = itemsByMeeting.get(item.meetingId) ?? []
    list.push(item)
    itemsByMeeting.set(item.meetingId, list)
  }
  return meetings.map((meeting) => ({ ...meeting, status: sourcingMeetingStatus(meeting.status), items: itemsByMeeting.get(meeting.id) ?? [] }))
}

export async function createSourcingMeeting(input: SourcingMeetingInput & {
  userId: string
  requestedByUserId: string
}) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain && !viewer.operatorId) throw new Error('등록자로 설정된 계정만 소싱회의를 만들 수 있습니다.')
  const meetingDate = normalizedMeetingDate(input.meetingDate)
  if (!meetingDate) throw new Error('소싱회의 날짜를 확인해주세요.')
  const title = cleanText(input.title)?.slice(0, 300) ?? formatSourcingMeetingTitle(meetingDate)
  const status = sourcingMeetingStatus(input.status)
  const [meeting] = resultRows<{ id: string }>(await db.execute(sql`
    INSERT INTO sourcing_meetings (
      user_id, meeting_date, title, status, created_by_user_id
    ) VALUES (
      ${input.userId}::uuid, ${meetingDate}::date, ${title}, ${status}, ${input.requestedByUserId}::uuid
    )
    RETURNING id
  `))
  if (!meeting) throw new Error('소싱회의를 만들지 못했습니다.')
  return meeting
}

export async function updateSourcingMeeting(input: SourcingMeetingInput & {
  userId: string
  requestedByUserId: string
  meetingId: string
}) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('소싱회의 날짜와 제목은 메인만 수정할 수 있습니다.')
  const meetingDate = normalizedMeetingDate(input.meetingDate)
  if (!meetingDate) throw new Error('소싱회의 날짜를 확인해주세요.')
  const title = cleanText(input.title)?.slice(0, 300) ?? formatSourcingMeetingTitle(meetingDate)
  const result = await db.execute(sql`
    UPDATE sourcing_meetings
    SET meeting_date = ${meetingDate}::date,
        title = ${title},
        status = ${sourcingMeetingStatus(input.status)},
        updated_at = now()
    WHERE id = ${input.meetingId}::uuid
      AND user_id = ${input.userId}::uuid
    RETURNING id
  `)
  if (resultRows(result).length === 0) throw new Error('소싱회의를 찾을 수 없습니다.')
}

export async function deleteSourcingMeeting(input: {
  userId: string
  requestedByUserId: string
  meetingId: string
}) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('소싱회의 삭제는 메인만 할 수 있습니다.')
  if (!isUuid(input.meetingId)) throw new Error('소싱회의를 찾을 수 없습니다.')

  return db.transaction(async (tx) => {
    const [meeting] = resultRows<{ id: string }>(await tx.execute(sql`
      SELECT id
      FROM sourcing_meetings
      WHERE id = ${input.meetingId}::uuid
        AND user_id = ${input.userId}::uuid
      FOR UPDATE
    `))
    if (!meeting) throw new Error('소싱회의를 찾을 수 없습니다.')

    const items = resultRows<{ id: string; passedNewProductId: string | null; status: string }>(await tx.execute(sql`
      SELECT
        id,
        passed_new_product_id AS "passedNewProductId",
        status
      FROM sourcing_items
      WHERE user_id = ${input.userId}::uuid
        AND meeting_id = ${meeting.id}::uuid
      FOR UPDATE
    `))
    const passedCount = items.filter((item) => item.passedNewProductId || item.status === 'passed').length
    if (passedCount > 0) {
      throw new Error(`1차 통과로 신상품 진행관리에 연결된 상품이 ${passedCount}개 있어 이 회의는 삭제할 수 없습니다.`)
    }

    await tx.execute(sql`
      DELETE FROM sourcing_items
      WHERE user_id = ${input.userId}::uuid
        AND meeting_id = ${meeting.id}::uuid
    `)
    await tx.execute(sql`
      DELETE FROM sourcing_meetings
      WHERE id = ${meeting.id}::uuid
        AND user_id = ${input.userId}::uuid
    `)
    return { deletedItems: items.length }
  })
}

export async function createManualSourcingItem(input: ManualSourcingInput & {
  userId: string
  requestedByUserId: string
}) {
  await ensureSourcingTables()
  const meetingId = await assertSourcingMeeting(input.userId, input.meetingId)
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  const ownerOperatorId = await resolveManualOwner({
    userId: input.userId,
    viewer,
    requestedOwnerOperatorId: input.ownerOperatorId ?? null,
  })
  const values = normalizeManualSourcingInput(input)
  if (!values.productName) return { error: '상품명을 입력해 주세요.' as const }

  const [row] = resultRows<{ id: string }>(await db.execute(sql`
    INSERT INTO sourcing_items (
      user_id, meeting_id, owner_operator_id, created_by_user_id, source_platform, source_title, product_option, source_url,
      china_unit_price_cny, unit_shipping_cny, exchange_rate_krw, calculated_cost_krw,
      domestic_sale_url, domestic_sale_price, detail_page_url, memo_1, memo_2, status, raw_data, updated_at
    ) VALUES (
      ${input.userId}::uuid, ${meetingId}::uuid, ${ownerOperatorId}::uuid, ${input.requestedByUserId}::uuid, 'manual',
      ${values.productName}, ${values.productOption}, ${values.chinaPurchaseUrl},
      ${values.chinaUnitPriceCny}, ${values.unitShippingCny}, ${values.exchangeRateKrw}, ${values.calculatedCostKrw},
      ${values.domesticSaleUrl}, ${values.domesticSalePrice}, ${values.detailPageUrl}, ${values.memo1}, ${values.memo2},
      'draft', '{}'::jsonb, now()
    )
    RETURNING id
  `))
  return { id: row!.id }
}

export async function updateManualSourcingItem(input: ManualSourcingInput & {
  userId: string
  requestedByUserId: string
  itemId: string
}) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  const [current] = resultRows<{ meetingId: string | null; ownerOperatorId: string | null; passedNewProductId: string | null }>(await db.execute(sql`
    SELECT meeting_id AS "meetingId", owner_operator_id AS "ownerOperatorId", passed_new_product_id AS "passedNewProductId"
    FROM sourcing_items
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
    LIMIT 1
  `))
  if (!current) return { error: '소싱 상품을 찾을 수 없습니다.' as const }
  if (!canWriteManualItem(viewer, current.ownerOperatorId)) {
    return { error: '다른 등록자의 소싱 상품은 수정할 수 없습니다.' as const }
  }

  const ownerOperatorId = viewer.isMain
    ? await resolveManualOwner({ userId: input.userId, viewer, requestedOwnerOperatorId: input.ownerOperatorId ?? current.ownerOperatorId })
    : viewer.operatorId
  if (!ownerOperatorId) return { error: '담당 등록자를 먼저 지정해주세요.' as const }
  const meetingId = await assertSourcingMeeting(input.userId, input.meetingId ?? current.meetingId)

  const values = normalizeManualSourcingInput(input)
  if (!values.productName) return { error: '상품명을 입력해 주세요.' as const }
  await db.execute(sql`
    UPDATE sourcing_items SET
      meeting_id = ${meetingId}::uuid,
      owner_operator_id = ${ownerOperatorId}::uuid,
      source_title = ${values.productName},
      product_option = ${values.productOption},
      source_url = ${values.chinaPurchaseUrl},
      china_unit_price_cny = ${values.chinaUnitPriceCny},
      unit_shipping_cny = ${values.unitShippingCny},
      exchange_rate_krw = ${values.exchangeRateKrw},
      calculated_cost_krw = ${values.calculatedCostKrw},
      domestic_sale_url = ${values.domesticSaleUrl},
      domestic_sale_price = ${values.domesticSalePrice},
      detail_page_url = ${values.detailPageUrl},
      memo_1 = ${values.memo1},
      memo_2 = ${values.memo2},
      updated_at = now()
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
  `)
  return { success: true as const, passedNewProductId: current.passedNewProductId }
}

export async function saveSourcingMeetingRows(input: {
  userId: string
  requestedByUserId: string
  meetingId: string
  rows: Array<ManualSourcingInput & { clientId: string; itemId?: string | null }>
}) {
  await ensureSourcingTables()
  await assertSourcingMeeting(input.userId, input.meetingId)
  const rows = input.rows.slice(0, 100)
  const saved: Array<{ clientId: string; id: string }> = []
  for (const row of rows) {
    if (!row.productName.trim()) {
      if (row.itemId) throw new Error('기존 상품의 상품명은 비워둘 수 없습니다.')
      continue
    }
    if (row.itemId) {
      const result = await updateManualSourcingItem({
        ...row,
        userId: input.userId,
        requestedByUserId: input.requestedByUserId,
        itemId: row.itemId,
        meetingId: input.meetingId,
      })
      if ('error' in result) throw new Error(result.error)
      saved.push({ clientId: row.clientId, id: row.itemId })
      continue
    }
    const result = await createManualSourcingItem({
      ...row,
      userId: input.userId,
      requestedByUserId: input.requestedByUserId,
      meetingId: input.meetingId,
    })
    if ('error' in result) throw new Error(result.error)
    saved.push({ clientId: row.clientId, id: result.id })
  }
  return { saved }
}

export async function addManualSourcingImage(input: {
  userId: string
  requestedByUserId: string
  itemId: string
  fileName: string
  contentType: string
  fileBuffer: ArrayBuffer
}) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  const [item] = resultRows<{ ownerOperatorId: string | null }>(await db.execute(sql`
    SELECT owner_operator_id AS "ownerOperatorId"
    FROM sourcing_items
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
    LIMIT 1
  `))
  if (!item) throw new Error('소싱 상품을 찾을 수 없습니다.')
  if (!canWriteManualItem(viewer, item.ownerOperatorId)) throw new Error('다른 등록자의 소싱 상품에는 사진을 추가할 수 없습니다.')

  const base64 = Buffer.from(input.fileBuffer).toString('base64')
  await db.execute(sql`
    UPDATE sourcing_items SET
      image_file_name = ${input.fileName},
      image_content_type = ${input.contentType},
      image_file_size = ${input.fileBuffer.byteLength},
      image_file_data = decode(${base64}, 'base64'),
      updated_at = now()
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
  `)
}

export async function getManualSourcingImage(input: { userId: string; actorUserId: string; itemId: string }) {
  await ensureSourcingTables()
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.actorUserId })
  const [image] = resultRows<{ fileName: string; contentType: string; fileDataBase64: string }>(await db.execute(sql`
    SELECT
      image_file_name AS "fileName",
      image_content_type AS "contentType",
      encode(image_file_data, 'base64') AS "fileDataBase64"
    FROM sourcing_items
    WHERE id = ${input.itemId}::uuid
      AND user_id = ${input.userId}::uuid
      AND image_file_data IS NOT NULL
      AND (${viewer.isMain
        ? sql`TRUE`
        : viewer.operatorId
          ? sql`owner_operator_id = ${viewer.operatorId}::uuid`
          : sql`FALSE`})
  `))
  return image ?? null
}

export async function passManualSourcingToNewProduct(input: {
  userId: string
  requestedByUserId: string
  itemId: string
}) {
  await ensureSourcingTables()
  await ensureNewProductWorkflowTables(input.userId)
  const viewer = await getSourcingViewer({ userId: input.userId, actorUserId: input.requestedByUserId })

  return db.transaction(async (tx) => {
    const [source] = resultRows<{
      id: string
      ownerOperatorId: string | null
      productName: string
      productOption: string | null
      chinaPurchaseUrl: string | null
      chinaUnitPriceCny: number | null
      unitShippingCny: number | null
      exchangeRateKrw: number | null
      calculatedCostKrw: number | null
      domesticSaleUrl: string | null
      domesticSalePrice: number | null
      detailPageUrl: string | null
      memo1: string | null
      memo2: string | null
      passedNewProductId: string | null
    }>(await tx.execute(sql`
      SELECT
        id,
        owner_operator_id AS "ownerOperatorId",
        source_title AS "productName",
        product_option AS "productOption",
        source_url AS "chinaPurchaseUrl",
        china_unit_price_cny::float8 AS "chinaUnitPriceCny",
        unit_shipping_cny::float8 AS "unitShippingCny",
        exchange_rate_krw::float8 AS "exchangeRateKrw",
        calculated_cost_krw AS "calculatedCostKrw",
        domestic_sale_url AS "domesticSaleUrl",
        domestic_sale_price AS "domesticSalePrice",
        detail_page_url AS "detailPageUrl",
        memo_1 AS "memo1",
        memo_2 AS "memo2",
        passed_new_product_id AS "passedNewProductId"
      FROM sourcing_items
      WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
      FOR UPDATE
    `))
    if (!source) throw new Error('소싱 상품을 찾을 수 없습니다.')
    if (!canWriteManualItem(viewer, source.ownerOperatorId)) {
      throw new Error('다른 등록자의 소싱 상품은 1차 통과 처리할 수 없습니다.')
    }
    if (!source.ownerOperatorId) throw new Error('담당 등록자를 먼저 지정해주세요.')
    if (source.passedNewProductId) return { id: source.passedNewProductId, existing: true }

    const [stage] = resultRows<{ id: string }>(await tx.execute(sql`
      SELECT id
      FROM new_product_workflow_stages
      WHERE user_id = ${input.userId}::uuid
      ORDER BY position
      LIMIT 1
    `))
    if (!stage) throw new Error('신상품 1단계를 찾을 수 없습니다.')

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-number:${input.userId}`}))`)
    const [{ nextNumber } = { nextNumber: 1 }] = resultRows<{ nextNumber: number }>(await tx.execute(sql`
      SELECT COALESCE(MAX(product_number), 0)::int + 1 AS "nextNumber"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
    `))
    const [created] = resultRows<{ id: string }>(await tx.execute(sql`
      INSERT INTO new_product_workflow_items (
        user_id, product_number, stage_id, owner_operator_id, sourcing_item_id,
        product_name, product_option, source_url,
        china_unit_price_cny, unit_shipping_cny, exchange_rate_krw, calculated_cost_krw,
        domestic_sale_url, domestic_sale_price, detail_page_url, memo_1, memo_2,
        estimated_cost, created_by_user_id
      ) VALUES (
        ${input.userId}::uuid, ${nextNumber}, ${stage.id}::uuid, NULL::uuid, ${source.id}::uuid,
        ${source.productName}, ${source.productOption}, ${source.chinaPurchaseUrl},
        ${source.chinaUnitPriceCny}, ${source.unitShippingCny}, ${source.exchangeRateKrw}, ${source.calculatedCostKrw},
        ${source.domesticSaleUrl}, ${source.domesticSalePrice}, ${source.detailPageUrl}, ${source.memo1}, ${source.memo2},
        ${source.calculatedCostKrw}, ${input.requestedByUserId}::uuid
      )
      RETURNING id
    `))
    await tx.execute(sql`
      INSERT INTO new_product_workflow_stage_history (
        user_id, item_id, to_stage_id, note, changed_by_user_id
      ) VALUES (
        ${input.userId}::uuid, ${created!.id}::uuid, ${stage.id}::uuid,
        '소싱 1차 통과 자동 등록', ${input.requestedByUserId}::uuid
      )
    `)
    await tx.execute(sql`
      INSERT INTO new_product_workflow_attachments (
        user_id, item_id, kind, file_name, content_type, file_size, file_data, uploaded_by_user_id
      )
      SELECT
        ${input.userId}::uuid, ${created!.id}::uuid, 'product_image', image_file_name,
        image_content_type, image_file_size, image_file_data, ${input.requestedByUserId}::uuid
      FROM sourcing_items
      WHERE id = ${source.id}::uuid
        AND image_file_data IS NOT NULL
    `)
    await tx.execute(sql`
      UPDATE sourcing_items SET
        status = 'passed',
        passed_at = now(),
        passed_new_product_id = ${created!.id}::uuid,
        updated_at = now()
      WHERE id = ${source.id}::uuid AND user_id = ${input.userId}::uuid
    `)
    return { id: created!.id, existing: false }
  })
}

function normalizeManualSourcingInput(input: ManualSourcingInput) {
  const chinaUnitPriceCny = decimal(input.chinaUnitPriceCny)
  const unitShippingCny = decimal(input.unitShippingCny)
  const exchangeRateKrw = decimal(input.exchangeRateKrw)
  return {
    productName: cleanText(input.productName),
    productOption: cleanText(input.productOption),
    chinaPurchaseUrl: cleanText(input.chinaPurchaseUrl),
    chinaUnitPriceCny,
    unitShippingCny,
    exchangeRateKrw,
    calculatedCostKrw: calculateCnyCostKrw({ chinaUnitPriceCny, unitShippingCny, exchangeRateKrw }),
    domesticSaleUrl: cleanText(input.domesticSaleUrl),
    domesticSalePrice: wholeNumber(input.domesticSalePrice),
    detailPageUrl: cleanText(input.detailPageUrl),
    memo1: cleanText(input.memo1),
    memo2: cleanText(input.memo2),
  }
}

async function resolveManualOwner(input: {
  userId: string
  viewer: SourcingViewer
  requestedOwnerOperatorId: string | null
}) {
  const ownerOperatorId = input.viewer.isMain
    ? input.requestedOwnerOperatorId ?? input.viewer.operatorId
    : input.viewer.operatorId
  if (!ownerOperatorId) throw new Error('등록자로 설정된 계정만 소싱 상품을 추가할 수 있습니다.')

  const [operator] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM sourcing_operators
    WHERE id = ${ownerOperatorId}::uuid
      AND user_id = ${input.userId}::uuid
      AND is_active = TRUE
    LIMIT 1
  `))
  if (!operator) throw new Error('담당 등록자를 찾을 수 없습니다.')
  return operator.id
}

async function assertSourcingMeeting(userId: string, meetingId: string | null | undefined) {
  if (!meetingId || !isUuid(meetingId)) throw new Error('소싱회의를 먼저 선택해주세요.')
  const [meeting] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM sourcing_meetings
    WHERE id = ${meetingId}::uuid
      AND user_id = ${userId}::uuid
    LIMIT 1
  `))
  if (!meeting) throw new Error('소싱회의를 찾을 수 없습니다.')
  return meeting.id
}

function canWriteManualItem(viewer: SourcingViewer, ownerOperatorId: string | null) {
  return viewer.isMain || (Boolean(viewer.operatorId) && viewer.operatorId === ownerOperatorId)
}

export function formatSourcingMeetingTitle(meetingDate: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate)
  if (!matched) return '소싱회의'
  return `${Number(matched[1])}년 ${Number(matched[2])}월 ${Number(matched[3])}일 소싱회의`
}

function normalizedMeetingDate(value: string | null | undefined) {
  const date = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function sourcingMeetingStatus(value: unknown): SourcingMeeting['status'] {
  return value === 'closed' || value === 'archived' ? value : 'open'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function decimal(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value * 100) / 100)
}

function wholeNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return (result as { rows?: T[] }).rows ?? []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function wonNumber(value: string | null): string | null {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  if (!normalized) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount >= 0 ? String(Math.trunc(amount)) : null
}

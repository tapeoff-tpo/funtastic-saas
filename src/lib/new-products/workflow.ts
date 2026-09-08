import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getProfile } from '@/lib/admin-accounts/queries'
import { calculateCnyCostKrw } from './cny-cost'
import {
  buildNewProductItemMasterData,
  shouldSyncNewProductToItemMaster,
  type NewProductItemMasterStage,
  type NewProductItemMasterValues,
} from './item-master-sync'
import {
  normalizeNewProductOptionDetails,
  type NewProductOptionDetail,
} from './option-details'
import {
  normalizeDaouWorksImportItems,
  splitDaouWorksRequiredChecks,
  type DaouWorksImportItem,
  type DaouWorksSourceData,
} from './daou-works-import'

export type { NewProductOptionDetail } from './option-details'

export const DEFAULT_NEW_PRODUCT_STAGES = [
  { name: '1차 통과 상품 등록', tone: 'blue' },
  { name: '샘플 구매', tone: 'violet' },
  { name: '샘플 국내 도착·최종 미팅', tone: 'cyan' },
  { name: '사방넷 상품등록', tone: 'orange' },
  { name: '상품정보고시 제작', tone: 'amber' },
  { name: '상품 구매 대기', tone: 'indigo' },
  { name: '상품 입고 대기', tone: 'purple' },
  { name: '원가 입력', tone: 'rose' },
  { name: '판매가·상품정보 입력', tone: 'teal' },
  { name: '상세페이지 완료 대기', tone: 'sky' },
  { name: '등록대기 1순위', tone: 'lime' },
  { name: '등록대기 2순위', tone: 'emerald' },
  { name: '등록완료', tone: 'green' },
  { name: '진행불가', tone: 'red' },
  { name: '진행보류', tone: 'slate' },
] as const

export const NEW_PRODUCT_STAGE_TONES = [
  'slate', 'blue', 'violet', 'cyan', 'amber', 'orange', 'indigo', 'purple',
  'rose', 'teal', 'sky', 'lime', 'emerald', 'green', 'red',
] as const

export type NewProductStageTone = (typeof NEW_PRODUCT_STAGE_TONES)[number]

export type NewProductStage = {
  id: string
  name: string
  position: number
  tone: NewProductStageTone
  itemCount: number
}

export type NewProductOperator = {
  id: string
  memberUserId: string
  displayName: string
  position: number
  isActive: boolean
}

export type NewProductViewer = {
  isMain: boolean
  operatorId: string | null
}

export type NewProductAttachment = {
  id: string
  kind: 'product_image' | 'sample_china_image' | 'final_sample_image' | 'quality_pdf'
  fileName: string
  contentType: string
  fileSize: number
  createdAt: string
}

export type NewProductStageHistory = {
  id: string
  fromStageName: string | null
  toStageName: string
  note: string | null
  changedAt: string
}

export type NewProductDaouWorksSourceSummary = Pick<
  DaouWorksSourceData,
  'sourceId' | 'sourceStatus' | 'registeredAt' | 'registeredBy' | 'updatedAt' | 'updatedBy'
>

export type NewProductItem = {
  id: string
  productNumber: number
  stageId: string
  stageName: string
  stagePosition: number
  stageTone: NewProductStageTone
  ownerOperatorId: string | null
  ownerName: string | null
  sourcingItemId: string | null
  sampleCode: string | null
  productName: string
  productOption: string | null
  optionDetails: NewProductOptionDetail[]
  daouWorks: NewProductDaouWorksSourceSummary | null
  chinaUnitPriceCny: number | null
  unitShippingCny: number | null
  exchangeRateKrw: number | null
  calculatedCostKrw: number | null
  domesticSaleUrl: string | null
  domesticSalePrice: number | null
  detailPageUrl: string | null
  memo1: string | null
  memo2: string | null
  englishName: string | null
  sourceUrl: string | null
  requiredChecks: string | null
  estimatedCost: number | null
  historyNotes: string | null
  referenceNotes: string | null
  chinaItemName: string | null
  plannedSaleDate: string | null
  detailPageDueDate: string | null
  registeredProductName: string | null
  packageInfoUrl: string | null
  packageProgressStatus: string | null
  packageStatus: string | null
  koreanManualStatus: string | null
  declaredValue: number | null
  b2bPrice: number | null
  b2cPrice: number | null
  carrier: string | null
  b2bShippingFee: number | null
  b2cShippingFee: number | null
  qualityNoticeStatus: string | null
  packageBoxDesign: string | null
  packageManufacturer: string | null
  packagePacking: string | null
  sabangnetCode: string | null
  productKeywords: string | null
  purchaseReferenceNotes: string | null
  previousCostKrw: number | null
  b2bOptionSurcharge: number | null
  b2cOptionSurcharge: number | null
  noticeMaterial: string | null
  noticeSize: string | null
  noticeManufacturer: string | null
  noticeWeight: string | null
  noticeCountry: string | null
  noticeCapacity: string | null
  noticeFoodSafety: string | null
  noticeComponents: string | null
  noticeSpecialNotes: string | null
  attachments: NewProductAttachment[]
  stageHistory: NewProductStageHistory[]
  createdAt: string
  updatedAt: string
}

export type NewProductInput = {
  stageId: string
  sampleCode: string | null
  productName: string
  productOption: string | null
  optionDetails?: NewProductOptionDetail[]
  chinaUnitPriceCny: number | null
  unitShippingCny: number | null
  exchangeRateKrw: number | null
  calculatedCostKrw: number | null
  domesticSaleUrl: string | null
  domesticSalePrice: number | null
  detailPageUrl: string | null
  memo1: string | null
  memo2: string | null
  englishName: string | null
  sourceUrl: string | null
  requiredChecks: string | null
  estimatedCost: number | null
  historyNotes: string | null
  referenceNotes: string | null
  chinaItemName: string | null
  plannedSaleDate: string | null
  detailPageDueDate: string | null
  registeredProductName: string | null
  packageInfoUrl: string | null
  packageProgressStatus: string | null
  packageStatus: string | null
  koreanManualStatus: string | null
  declaredValue: number | null
  b2bPrice: number | null
  b2cPrice: number | null
  carrier: string | null
  b2bShippingFee: number | null
  b2cShippingFee: number | null
  qualityNoticeStatus: string | null
  packageBoxDesign: string | null
  packageManufacturer: string | null
  packagePacking: string | null
  sabangnetCode: string | null
  productKeywords: string | null
  purchaseReferenceNotes: string | null
  previousCostKrw: number | null
  b2bOptionSurcharge: number | null
  b2cOptionSurcharge: number | null
  noticeMaterial: string | null
  noticeSize: string | null
  noticeManufacturer: string | null
  noticeWeight: string | null
  noticeCountry: string | null
  noticeCapacity: string | null
  noticeFoodSafety: string | null
  noticeComponents: string | null
  noticeSpecialNotes: string | null
}

// Item master has one representative set of values; use the first option for it.
export function applyPrimaryOptionValues(values: NewProductInput): NewProductInput {
  const primaryOption = values.optionDetails?.[0]
  if (!primaryOption) return values

  return {
    ...values,
    sabangnetCode: primaryOption.sabangnetOptionCode ?? values.sabangnetCode,
    chinaUnitPriceCny: primaryOption.chinaUnitPriceCny ?? values.chinaUnitPriceCny,
    unitShippingCny: primaryOption.unitShippingCny ?? values.unitShippingCny,
    exchangeRateKrw: primaryOption.exchangeRateKrw ?? values.exchangeRateKrw,
    calculatedCostKrw: primaryOption.costKrw ?? values.calculatedCostKrw,
    previousCostKrw: primaryOption.previousCostKrw ?? values.previousCostKrw,
    b2bOptionSurcharge: primaryOption.b2bPrice ?? values.b2bOptionSurcharge,
    b2cOptionSurcharge: primaryOption.b2cPrice ?? values.b2cOptionSurcharge,
  }
}

export type ItemMasterSyncResult = {
  status: 'not_required' | 'pending_code' | 'created' | 'updated'
  productId?: string
}

export type NewProductSummary = {
  id: string
  productNumber: number
  stageId: string
  stageName: string
  stageTone: NewProductStageTone
  ownerOperatorId: string | null
  ownerName: string | null
  productName: string
  sampleCode: string | null
  createdAt: string
  updatedAt: string
}

export const NEW_PRODUCT_EDITOR_SECTIONS = [
  'progress',
  'basic',
  'attachments',
  'notice',
  'package',
  'pricing',
] as const

export type NewProductEditorSection = (typeof NEW_PRODUCT_EDITOR_SECTIONS)[number]

export type NewProductEditorLayout = {
  sectionOrder: NewProductEditorSection[]
  hiddenSections: NewProductEditorSection[]
  columns: 1 | 2 | 3
}

export const DEFAULT_NEW_PRODUCT_EDITOR_LAYOUT: NewProductEditorLayout = {
  sectionOrder: [...NEW_PRODUCT_EDITOR_SECTIONS],
  hiddenSections: [],
  columns: 2,
}

let ensureSchemaPromise: Promise<void> | null = null
const ensureWorkspacePromises = new Map<string, Promise<void>>()

const daouWorksSummarySql = sql`
  CASE
    WHEN jsonb_typeof(item.metadata -> 'daouWorks') = 'object' THEN jsonb_build_object(
      'sourceId', item.metadata -> 'daouWorks' ->> 'sourceId',
      'sourceStatus', item.metadata -> 'daouWorks' ->> 'sourceStatus',
      'registeredAt', item.metadata -> 'daouWorks' ->> 'registeredAt',
      'registeredBy', item.metadata -> 'daouWorks' ->> 'registeredBy',
      'updatedAt', item.metadata -> 'daouWorks' ->> 'updatedAt',
      'updatedBy', item.metadata -> 'daouWorks' ->> 'updatedBy'
    )
    ELSE NULL
  END
`

export async function ensureNewProductWorkflowTables(userId: string) {
  const existingPromise = ensureWorkspacePromises.get(userId)
  if (existingPromise) return existingPromise

  const workspacePromise = ensureNewProductWorkflowWorkspace(userId)
    .catch(async (error) => {
      if (!isMissingNewProductWorkflowTable(error)) throw error
      await ensureNewProductWorkflowSchema()
      await ensureNewProductWorkflowWorkspace(userId)
    })
    .catch((error) => {
      ensureWorkspacePromises.delete(userId)
      throw error
    })
  ensureWorkspacePromises.set(userId, workspacePromise)
  return workspacePromise
}

async function ensureNewProductWorkflowWorkspace(userId: string) {
  const defaultStageValues = sql.join(DEFAULT_NEW_PRODUCT_STAGES.map((stage, index) => sql`
    (${stage.name}::varchar(160), ${index + 1}::integer, ${stage.tone}::varchar(30))
  `), sql`, `)

  // The advisory lock and seed insert share one statement, so a cold start only
  // performs one lightweight query once the migrated tables already exist.
  await db.execute(sql`
    WITH locked AS (
      SELECT pg_advisory_xact_lock(hashtext(${`new-product-default-stages:${userId}`}))
    ), defaults(name, position, tone) AS (
      VALUES ${defaultStageValues}
    )
    INSERT INTO new_product_workflow_stages (user_id, name, position, tone)
    SELECT ${userId}::uuid, defaults.name, defaults.position, defaults.tone
    FROM defaults
    CROSS JOIN locked
    WHERE NOT EXISTS (
      SELECT 1
      FROM new_product_workflow_stages
      WHERE user_id = ${userId}::uuid
    )
  `)
}

function isMissingNewProductWorkflowTable(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === '42P01'
}

function ensureNewProductWorkflowSchema() {
  if (ensureSchemaPromise) return ensureSchemaPromise
  ensureSchemaPromise = createNewProductWorkflowSchema().catch((error) => {
    ensureSchemaPromise = null
    throw error
  })
  return ensureSchemaPromise
}

async function createNewProductWorkflowSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS new_product_workflow_stages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name varchar(160) NOT NULL,
      position integer NOT NULL,
      tone varchar(30) NOT NULL DEFAULT 'slate',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_stages_user_position_idx
    ON new_product_workflow_stages(user_id, position)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS new_product_workflow_operators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      member_user_id uuid NOT NULL,
      display_name varchar(100) NOT NULL,
      position integer NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, member_user_id),
      CHECK (position BETWEEN 1 AND 5)
    )
  `)
  await db.execute(sql`
    ALTER TABLE new_product_workflow_operators
      DROP CONSTRAINT IF EXISTS new_product_workflow_operators_user_id_position_key,
      DROP CONSTRAINT IF EXISTS new_product_workflow_operators_workspace_position_unique
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_operators_workspace_active_idx
    ON new_product_workflow_operators(user_id, is_active, position)
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_operators_workspace_active_position_unique
    ON new_product_workflow_operators(user_id, position)
    WHERE is_active = TRUE
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS new_product_workflow_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      product_number integer NOT NULL,
      stage_id uuid NOT NULL REFERENCES new_product_workflow_stages(id),
      owner_operator_id uuid,
      sourcing_item_id uuid,
      sample_code varchar(200),
      product_name text NOT NULL,
      product_option text,
      china_unit_price_cny numeric(14, 2),
      unit_shipping_cny numeric(14, 2),
      exchange_rate_krw numeric(14, 4),
      calculated_cost_krw integer,
      domestic_sale_url text,
      domestic_sale_price integer,
      detail_page_url text,
      memo_1 text,
      memo_2 text,
      english_name text,
      source_url text,
      required_checks text,
      estimated_cost numeric(14, 2),
      history_notes text,
      reference_notes text,
      china_item_name text,
      planned_sale_date date,
      detail_page_due_date date,
      registered_product_name text,
      package_info_url text,
      package_progress_status varchar(100),
      package_status varchar(100),
      korean_manual_status varchar(100),
      declared_value numeric(14, 2),
      b2b_price integer,
      b2c_price integer,
      carrier varchar(100),
      b2b_shipping_fee integer,
      b2c_shipping_fee integer,
      quality_notice_status varchar(100),
      package_box_design varchar(100),
      package_manufacturer varchar(100),
      package_packing varchar(100),
      daou_works_id text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, product_number)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_items_user_stage_idx
    ON new_product_workflow_items(user_id, stage_id, updated_at DESC)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_items_user_updated_idx
    ON new_product_workflow_items(user_id, updated_at DESC)
  `)
  await db.execute(sql`
    ALTER TABLE new_product_workflow_items
      ADD COLUMN IF NOT EXISTS owner_operator_id uuid,
      ADD COLUMN IF NOT EXISTS sourcing_item_id uuid,
      ADD COLUMN IF NOT EXISTS product_option text,
      ADD COLUMN IF NOT EXISTS china_unit_price_cny numeric(14, 2),
      ADD COLUMN IF NOT EXISTS unit_shipping_cny numeric(14, 2),
      ADD COLUMN IF NOT EXISTS exchange_rate_krw numeric(14, 4),
      ADD COLUMN IF NOT EXISTS calculated_cost_krw integer,
      ADD COLUMN IF NOT EXISTS domestic_sale_url text,
      ADD COLUMN IF NOT EXISTS domestic_sale_price integer,
      ADD COLUMN IF NOT EXISTS detail_page_url text,
      ADD COLUMN IF NOT EXISTS memo_1 text,
      ADD COLUMN IF NOT EXISTS memo_2 text,
      ADD COLUMN IF NOT EXISTS daou_works_id text,
      ADD COLUMN IF NOT EXISTS sabangnet_code varchar(100),
      ADD COLUMN IF NOT EXISTS product_keywords text,
      ADD COLUMN IF NOT EXISTS purchase_reference_notes text,
      ADD COLUMN IF NOT EXISTS previous_cost_krw integer,
      ADD COLUMN IF NOT EXISTS b2b_option_surcharge integer,
      ADD COLUMN IF NOT EXISTS b2c_option_surcharge integer,
      ADD COLUMN IF NOT EXISTS notice_material text,
      ADD COLUMN IF NOT EXISTS notice_size text,
      ADD COLUMN IF NOT EXISTS notice_manufacturer text,
      ADD COLUMN IF NOT EXISTS notice_weight text,
      ADD COLUMN IF NOT EXISTS notice_country text,
      ADD COLUMN IF NOT EXISTS notice_capacity text,
      ADD COLUMN IF NOT EXISTS notice_food_safety text,
      ADD COLUMN IF NOT EXISTS notice_components text,
      ADD COLUMN IF NOT EXISTS notice_special_notes text
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_items_workspace_owner_updated_idx
    ON new_product_workflow_items(user_id, owner_operator_id, updated_at DESC)
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_items_workspace_sourcing_unique
    ON new_product_workflow_items(user_id, sourcing_item_id)
    WHERE sourcing_item_id IS NOT NULL
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_items_workspace_sabangnet_idx
    ON new_product_workflow_items(user_id, sabangnet_code)
    WHERE sabangnet_code IS NOT NULL
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_items_workspace_sample_code_unique
    ON new_product_workflow_items(user_id, lower(btrim(sample_code)))
    WHERE sample_code IS NOT NULL AND length(btrim(sample_code)) > 0
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_items_workspace_daou_works_unique
    ON new_product_workflow_items(user_id, daou_works_id)
    WHERE daou_works_id IS NOT NULL
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS new_product_workflow_stage_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      item_id uuid NOT NULL REFERENCES new_product_workflow_items(id) ON DELETE CASCADE,
      from_stage_id uuid REFERENCES new_product_workflow_stages(id) ON DELETE SET NULL,
      to_stage_id uuid NOT NULL REFERENCES new_product_workflow_stages(id),
      note text,
      changed_by_user_id uuid,
      changed_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_history_item_changed_idx
    ON new_product_workflow_stage_history(item_id, changed_at DESC)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS new_product_workflow_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      item_id uuid NOT NULL REFERENCES new_product_workflow_items(id) ON DELETE CASCADE,
      kind varchar(40) NOT NULL,
      file_name text NOT NULL,
      content_type varchar(160) NOT NULL,
      file_size integer NOT NULL,
      file_data bytea NOT NULL,
      uploaded_by_user_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (kind IN ('product_image', 'sample_china_image', 'final_sample_image', 'quality_pdf'))
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS new_product_workflow_attachments_item_kind_idx
    ON new_product_workflow_attachments(item_id, kind, created_at)
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS new_product_workflow_preferences (
      user_id uuid PRIMARY KEY,
      editor_layout jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`ALTER TABLE new_product_workflow_stages ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_operators ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_items ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_stage_history ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_attachments ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_preferences ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`REVOKE ALL ON TABLE new_product_workflow_operators FROM anon, authenticated`)
}

export async function listNewProductOperators(userId: string): Promise<NewProductOperator[]> {
  await ensureNewProductWorkflowTables(userId)
  return resultRows<NewProductOperator>(await db.execute(sql`
    SELECT
      id,
      member_user_id AS "memberUserId",
      display_name AS "displayName",
      position,
      is_active AS "isActive"
    FROM new_product_workflow_operators
    WHERE user_id = ${userId}::uuid
    ORDER BY position, created_at
  `))
}

export async function getNewProductViewer(input: { userId: string; actorUserId: string }): Promise<NewProductViewer> {
  await ensureNewProductWorkflowTables(input.userId)
  const profile = await getProfile(input.actorUserId)
  const isMain = profile?.role === 'super_admin' && !profile.deactivatedAt
  return { isMain, operatorId: null }
}

export async function getNewProductPageSetup(input: { userId: string; actorUserId: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const [profile, stageResult, preferenceResult] = await Promise.all([
    getProfile(input.actorUserId),
    db.execute<NewProductStage>(sql`
      SELECT
        stage.id,
        stage.name,
        stage.position,
        stage.tone,
        COUNT(item.id)::int AS "itemCount"
      FROM new_product_workflow_stages stage
      LEFT JOIN new_product_workflow_items item
        ON item.user_id = stage.user_id
          AND item.stage_id = stage.id
      WHERE stage.user_id = ${input.userId}::uuid
      GROUP BY stage.id
      ORDER BY stage.position, stage.created_at
    `),
    db.execute<{ editorLayout: unknown }>(sql`
      SELECT editor_layout AS "editorLayout"
      FROM new_product_workflow_preferences
      WHERE user_id = ${input.userId}::uuid
    `),
  ])
  const [preference] = resultRows<{ editorLayout: unknown }>(preferenceResult)
  return {
    stages: resultRows<NewProductStage>(stageResult).map((stage) => ({
      ...stage,
      tone: validTone(stage.tone),
    })),
    editorLayout: normalizeNewProductEditorLayout(preference?.editorLayout),
    viewer: {
      isMain: profile?.role === 'super_admin' && !profile.deactivatedAt,
      operatorId: null,
    },
  }
}

export async function listNewProductSummaries(input: {
  userId: string
  stageIds?: string[] | null
  query?: string | null
  limit?: number
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const query = input.query?.trim().slice(0, 200) ?? ''
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
  const stageIds = [...new Set(input.stageIds ?? [])].slice(0, 40)
  const stageCondition = stageIds.length > 0
    ? sql`AND item.stage_id IN (${sql.join(stageIds.map((stageId) => sql`${stageId}::uuid`), sql`, `)})`
    : sql``
  const queryPattern = `%${query}%`
  const searchCondition = query
    ? sql`AND (
        concat_ws(
          ' ',
          item.product_number::text,
          item.sample_code,
          item.product_name,
          item.product_option,
          item.registered_product_name,
          item.english_name,
          item.china_item_name,
          item.sabangnet_code,
          item.daou_works_id,
          item.domestic_sale_url,
          item.detail_page_url,
          item.source_url,
          item.package_info_url,
          item.memo_1,
          item.memo_2,
          item.required_checks,
          item.history_notes,
          item.reference_notes,
          item.product_keywords,
          item.purchase_reference_notes,
          item.package_progress_status,
          item.package_status,
          item.korean_manual_status,
          item.carrier,
          item.quality_notice_status,
          item.package_box_design,
          item.package_manufacturer,
          item.package_packing,
          item.notice_material,
          item.notice_size,
          item.notice_manufacturer,
          item.notice_weight,
          item.notice_country,
          item.notice_capacity,
          item.notice_food_safety,
          item.notice_components,
          item.notice_special_notes,
          -- The raw WORKS copy is intentionally loaded only on demand.
          COALESCE(item.metadata -> 'optionDetails', '[]'::jsonb)::text
        ) ILIKE ${queryPattern}
        OR EXISTS (
          SELECT 1
          FROM new_product_workflow_stage_history history
          WHERE history.item_id = item.id
            AND history.user_id = ${input.userId}::uuid
            AND COALESCE(history.note, '') ILIKE ${queryPattern}
        )
      )`
    : sql``

  const [summaryResult, countResult] = await Promise.all([
    db.execute<NewProductSummary>(sql`
      SELECT
        item.id,
        item.product_number AS "productNumber",
        item.stage_id AS "stageId",
        stage.name AS "stageName",
        stage.tone AS "stageTone",
        item.owner_operator_id AS "ownerOperatorId",
        operator.display_name AS "ownerName",
        item.product_name AS "productName",
        item.sample_code AS "sampleCode",
        item.created_at::text AS "createdAt",
        item.updated_at::text AS "updatedAt"
      FROM new_product_workflow_items item
      JOIN new_product_workflow_stages stage ON stage.id = item.stage_id
      LEFT JOIN new_product_workflow_operators operator ON operator.id = item.owner_operator_id
      WHERE item.user_id = ${input.userId}::uuid
      ${stageCondition}
      ${searchCondition}
      ORDER BY item.updated_at DESC, item.product_number DESC
      LIMIT ${limit}
    `),
    db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM new_product_workflow_items item
      WHERE item.user_id = ${input.userId}::uuid
      ${stageCondition}
      ${searchCondition}
    `),
  ])
  const [{ count } = { count: 0 }] = resultRows<{ count: number }>(countResult)
  return {
    summaries: resultRows<NewProductSummary>(summaryResult).map((item) => ({
      ...item,
      stageTone: validTone(item.stageTone),
    })),
    total: count,
  }
}

export async function getNewProductItem(input: { userId: string; itemId: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const result = await db.execute<NewProductItem>(sql`
    SELECT
      item.id,
      item.product_number AS "productNumber",
      item.stage_id AS "stageId",
      stage.name AS "stageName",
      stage.position AS "stagePosition",
      stage.tone AS "stageTone",
      item.owner_operator_id AS "ownerOperatorId",
      operator.display_name AS "ownerName",
      item.sourcing_item_id AS "sourcingItemId",
      item.sample_code AS "sampleCode",
      item.product_name AS "productName",
      item.product_option AS "productOption",
      COALESCE(item.metadata -> 'optionDetails', '[]'::jsonb) AS "optionDetails",
      ${daouWorksSummarySql} AS "daouWorks",
      item.china_unit_price_cny::float8 AS "chinaUnitPriceCny",
      item.unit_shipping_cny::float8 AS "unitShippingCny",
      item.exchange_rate_krw::float8 AS "exchangeRateKrw",
      item.calculated_cost_krw AS "calculatedCostKrw",
      item.domestic_sale_url AS "domesticSaleUrl",
      item.domestic_sale_price AS "domesticSalePrice",
      item.detail_page_url AS "detailPageUrl",
      item.memo_1 AS "memo1",
      item.memo_2 AS "memo2",
      item.english_name AS "englishName",
      item.source_url AS "sourceUrl",
      item.required_checks AS "requiredChecks",
      item.estimated_cost::float8 AS "estimatedCost",
      item.history_notes AS "historyNotes",
      item.reference_notes AS "referenceNotes",
      item.china_item_name AS "chinaItemName",
      item.planned_sale_date::text AS "plannedSaleDate",
      item.detail_page_due_date::text AS "detailPageDueDate",
      item.registered_product_name AS "registeredProductName",
      item.package_info_url AS "packageInfoUrl",
      item.package_progress_status AS "packageProgressStatus",
      item.package_status AS "packageStatus",
      item.korean_manual_status AS "koreanManualStatus",
      item.declared_value::float8 AS "declaredValue",
      item.b2b_price AS "b2bPrice",
      item.b2c_price AS "b2cPrice",
      item.carrier,
      item.b2b_shipping_fee AS "b2bShippingFee",
      item.b2c_shipping_fee AS "b2cShippingFee",
      item.quality_notice_status AS "qualityNoticeStatus",
      item.package_box_design AS "packageBoxDesign",
      item.package_manufacturer AS "packageManufacturer",
      item.package_packing AS "packagePacking",
      item.sabangnet_code AS "sabangnetCode",
      item.product_keywords AS "productKeywords",
      item.purchase_reference_notes AS "purchaseReferenceNotes",
      item.previous_cost_krw AS "previousCostKrw",
      item.b2b_option_surcharge AS "b2bOptionSurcharge",
      item.b2c_option_surcharge AS "b2cOptionSurcharge",
      item.notice_material AS "noticeMaterial",
      item.notice_size AS "noticeSize",
      item.notice_manufacturer AS "noticeManufacturer",
      item.notice_weight AS "noticeWeight",
      item.notice_country AS "noticeCountry",
      item.notice_capacity AS "noticeCapacity",
      item.notice_food_safety AS "noticeFoodSafety",
      item.notice_components AS "noticeComponents",
      item.notice_special_notes AS "noticeSpecialNotes",
      item.created_at::text AS "createdAt",
      item.updated_at::text AS "updatedAt",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', attachment.id,
          'kind', attachment.kind,
          'fileName', attachment.file_name,
          'contentType', attachment.content_type,
          'fileSize', attachment.file_size,
          'createdAt', attachment.created_at::text
        ) ORDER BY attachment.created_at)
        FROM new_product_workflow_attachments attachment
        WHERE attachment.item_id = item.id
      ), '[]'::jsonb) AS attachments,
      COALESCE((
        SELECT jsonb_agg(history_row ORDER BY history_row."changedAt" DESC)
        FROM (
          SELECT
            history.id,
            from_stage.name AS "fromStageName",
            to_stage.name AS "toStageName",
            history.note,
            history.changed_at::text AS "changedAt"
          FROM new_product_workflow_stage_history history
          LEFT JOIN new_product_workflow_stages from_stage ON from_stage.id = history.from_stage_id
          JOIN new_product_workflow_stages to_stage ON to_stage.id = history.to_stage_id
          WHERE history.item_id = item.id
          ORDER BY history.changed_at DESC
          LIMIT 20
        ) history_row
      ), '[]'::jsonb) AS "stageHistory"
    FROM new_product_workflow_items item
    JOIN new_product_workflow_stages stage ON stage.id = item.stage_id
    LEFT JOIN new_product_workflow_operators operator ON operator.id = item.owner_operator_id
    WHERE item.user_id = ${input.userId}::uuid
      AND item.id = ${input.itemId}::uuid
  `)
  const [item] = resultRows<NewProductItem>(result)
  if (!item) return null
  return {
    ...item,
    stageTone: validTone(item.stageTone),
    optionDetails: normalizeNewProductOptionDetails(item.optionDetails),
    daouWorks: jsonObject<NewProductDaouWorksSourceSummary>(item.daouWorks),
    attachments: jsonArray<NewProductAttachment>(item.attachments),
    stageHistory: jsonArray<NewProductStageHistory>(item.stageHistory),
  }
}

export async function getNewProductDaouWorksSource(input: { userId: string; itemId: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const result = await db.execute<{ daouWorks: unknown }>(sql`
    SELECT item.metadata -> 'daouWorks' AS "daouWorks"
    FROM new_product_workflow_items item
    WHERE item.user_id = ${input.userId}::uuid
      AND item.id = ${input.itemId}::uuid
  `)
  const [item] = resultRows<{ daouWorks: unknown }>(result)
  return item ? jsonObject<DaouWorksSourceData>(item.daouWorks) : null
}

export async function getNewProductWorkflow(userId: string) {
  await ensureNewProductWorkflowTables(userId)
  const [stageResult, itemResult] = await Promise.all([
    db.execute<NewProductStage>(sql`
      SELECT
        stage.id,
        stage.name,
        stage.position,
        stage.tone,
        COUNT(item.id)::int AS "itemCount"
      FROM new_product_workflow_stages stage
      LEFT JOIN new_product_workflow_items item
        ON item.user_id = stage.user_id AND item.stage_id = stage.id
      WHERE stage.user_id = ${userId}::uuid
      GROUP BY stage.id
      ORDER BY stage.position, stage.created_at
    `),
    db.execute<NewProductItem>(sql`
      SELECT
        item.id,
        item.product_number AS "productNumber",
        item.stage_id AS "stageId",
        stage.name AS "stageName",
        stage.position AS "stagePosition",
        stage.tone AS "stageTone",
        item.sample_code AS "sampleCode",
        item.product_name AS "productName",
        item.english_name AS "englishName",
        item.source_url AS "sourceUrl",
        item.required_checks AS "requiredChecks",
        item.estimated_cost::float8 AS "estimatedCost",
        item.history_notes AS "historyNotes",
        item.reference_notes AS "referenceNotes",
        item.china_item_name AS "chinaItemName",
        item.planned_sale_date::text AS "plannedSaleDate",
        item.detail_page_due_date::text AS "detailPageDueDate",
        item.registered_product_name AS "registeredProductName",
        item.package_info_url AS "packageInfoUrl",
        item.package_progress_status AS "packageProgressStatus",
        item.package_status AS "packageStatus",
        item.korean_manual_status AS "koreanManualStatus",
        item.declared_value::float8 AS "declaredValue",
        item.b2b_price AS "b2bPrice",
        item.b2c_price AS "b2cPrice",
        item.carrier,
        item.b2b_shipping_fee AS "b2bShippingFee",
        item.b2c_shipping_fee AS "b2cShippingFee",
        item.quality_notice_status AS "qualityNoticeStatus",
        item.package_box_design AS "packageBoxDesign",
        item.package_manufacturer AS "packageManufacturer",
        item.package_packing AS "packagePacking",
        item.product_option AS "productOption",
        COALESCE(item.metadata -> 'optionDetails', '[]'::jsonb) AS "optionDetails",
        ${daouWorksSummarySql} AS "daouWorks",
        item.sabangnet_code AS "sabangnetCode",
        item.product_keywords AS "productKeywords",
        item.purchase_reference_notes AS "purchaseReferenceNotes",
        item.china_unit_price_cny::float8 AS "chinaUnitPriceCny",
        item.unit_shipping_cny::float8 AS "unitShippingCny",
        item.calculated_cost_krw AS "calculatedCostKrw",
        item.previous_cost_krw AS "previousCostKrw",
        item.exchange_rate_krw::float8 AS "exchangeRateKrw",
        item.b2b_option_surcharge AS "b2bOptionSurcharge",
        item.b2c_option_surcharge AS "b2cOptionSurcharge",
        item.notice_material AS "noticeMaterial",
        item.notice_size AS "noticeSize",
        item.notice_manufacturer AS "noticeManufacturer",
        item.notice_weight AS "noticeWeight",
        item.notice_country AS "noticeCountry",
        item.notice_capacity AS "noticeCapacity",
        item.notice_food_safety AS "noticeFoodSafety",
        item.notice_components AS "noticeComponents",
        item.notice_special_notes AS "noticeSpecialNotes",
        item.created_at::text AS "createdAt",
        item.updated_at::text AS "updatedAt",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', attachment.id,
            'kind', attachment.kind,
            'fileName', attachment.file_name,
            'contentType', attachment.content_type,
            'fileSize', attachment.file_size,
            'createdAt', attachment.created_at::text
          ) ORDER BY attachment.created_at)
          FROM new_product_workflow_attachments attachment
          WHERE attachment.item_id = item.id
        ), '[]'::jsonb) AS attachments,
        COALESCE((
          SELECT jsonb_agg(history_row ORDER BY history_row."changedAt" DESC)
          FROM (
            SELECT
              history.id,
              from_stage.name AS "fromStageName",
              to_stage.name AS "toStageName",
              history.note,
              history.changed_at::text AS "changedAt"
            FROM new_product_workflow_stage_history history
            LEFT JOIN new_product_workflow_stages from_stage ON from_stage.id = history.from_stage_id
            JOIN new_product_workflow_stages to_stage ON to_stage.id = history.to_stage_id
            WHERE history.item_id = item.id
            ORDER BY history.changed_at DESC
            LIMIT 20
          ) history_row
        ), '[]'::jsonb) AS "stageHistory"
      FROM new_product_workflow_items item
      JOIN new_product_workflow_stages stage ON stage.id = item.stage_id
      WHERE item.user_id = ${userId}::uuid
      ORDER BY item.updated_at DESC, item.product_number DESC
    `),
  ])

  return {
    stages: resultRows<NewProductStage>(stageResult).map((stage) => ({
      ...stage,
      tone: validTone(stage.tone),
    })),
    items: resultRows<NewProductItem>(itemResult).map((item) => ({
      ...item,
      stageTone: validTone(item.stageTone),
      optionDetails: normalizeNewProductOptionDetails(item.optionDetails),
      daouWorks: jsonObject<NewProductDaouWorksSourceSummary>(item.daouWorks),
      attachments: jsonArray<NewProductAttachment>(item.attachments),
      stageHistory: jsonArray<NewProductStageHistory>(item.stageHistory),
    })),
  }
}

export async function importDaouWorksProducts(input: {
  userId: string
  requestedByUserId: string
  items: unknown
  stageMappings: unknown
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const viewer = await getNewProductViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('WORKS 가져오기는 메인만 실행할 수 있습니다.')

  const items = normalizeDaouWorksImportItems(input.items)
  if (items.length === 0) throw new Error('가져올 WORKS 상품을 찾지 못했습니다.')
  const stageMappings = normalizeDaouWorksStageMappings(input.stageMappings)
  const sourceStatuses = [...new Set(items.map((item) => item.sourceStatus.trim()).filter(Boolean))]

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-daou-import:${input.userId}`}))`)
    const stages = await listDaouWorksTargetStages(tx, input.userId)
    const stageIds = resolveDaouWorksStageIds({ sourceStatuses, stageMappings, stages })

    const existingRows = resultRows<{ sourceId: string }>(await tx.execute(sql`
      SELECT daou_works_id AS "sourceId"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
        AND daou_works_id IN (${sql.join(items.map((item) => sql`${item.sourceId}`), sql`, `)})
    `))
    const existingSourceIds = new Set(existingRows.map((row) => row.sourceId))
    const candidateSampleCodes = [...new Set(items
      .map((item) => normalizedSampleCode(item.values.sampleCode))
      .filter((sampleCode): sampleCode is string => Boolean(sampleCode)))]
    const existingSampleCodeRows = candidateSampleCodes.length === 0
      ? []
      : resultRows<{ sourceId: string | null; sampleCode: string }>(await tx.execute(sql`
        SELECT
          daou_works_id AS "sourceId",
          lower(btrim(sample_code)) AS "sampleCode"
        FROM new_product_workflow_items
        WHERE user_id = ${input.userId}::uuid
          AND lower(btrim(sample_code)) IN (${sql.join(candidateSampleCodes.map((sampleCode) => sql`${sampleCode}`), sql`, `)})
      `))
    const filtered = filterDaouWorksItemsWithUniqueSampleCodes({
      items,
      existingRows: existingSampleCodeRows,
    })
    const importableItems = filtered.items

    if (importableItems.length === 0) {
      return {
        processed: items.length,
        inserted: 0,
        updated: 0,
        skippedDuplicateSampleCodes: filtered.duplicateSampleCodes.length,
        stageCount: stages.length,
      }
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-number:${input.userId}`}))`)
    const [{ nextNumber } = { nextNumber: 1 }] = resultRows<{ nextNumber: number }>(await tx.execute(sql`
      SELECT COALESCE(MAX(product_number), 0)::int + 1 AS "nextNumber"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
    `))
    const importedAt = new Date().toISOString()
    const payload = importableItems.map((item, index) => daouWorksPayload({
      item,
      stageId: stageIds.get(item.sourceStatus.trim())!,
      productNumber: nextNumber + index,
      importedAt,
    }))

    await tx.execute(sql`
      INSERT INTO new_product_workflow_items (
        user_id, product_number, stage_id, daou_works_id,
        sample_code, product_name, product_option,
        china_unit_price_cny, unit_shipping_cny, exchange_rate_krw, calculated_cost_krw,
        domestic_sale_url, domestic_sale_price, detail_page_url, memo_1, memo_2,
        english_name, source_url, required_checks, estimated_cost, history_notes, reference_notes,
        china_item_name, planned_sale_date, detail_page_due_date, registered_product_name,
        package_info_url, package_progress_status, package_status, korean_manual_status,
        declared_value, b2b_price, b2c_price, carrier, b2b_shipping_fee, b2c_shipping_fee,
        quality_notice_status, package_box_design, package_manufacturer, package_packing,
        sabangnet_code, product_keywords, purchase_reference_notes, previous_cost_krw,
        b2b_option_surcharge, b2c_option_surcharge,
        notice_material, notice_size, notice_manufacturer, notice_weight, notice_country,
        notice_capacity, notice_food_safety, notice_components, notice_special_notes,
        metadata, created_by_user_id, created_at, updated_at
      )
      SELECT
        ${input.userId}::uuid, payload.product_number, payload.stage_id::uuid, payload.source_id,
        payload.sample_code, payload.product_name, payload.product_option,
        payload.china_unit_price_cny, payload.unit_shipping_cny, payload.exchange_rate_krw, payload.calculated_cost_krw,
        payload.domestic_sale_url, payload.domestic_sale_price, payload.detail_page_url, payload.memo_1, payload.memo_2,
        payload.english_name, payload.source_url, payload.required_checks, payload.estimated_cost, payload.history_notes, payload.reference_notes,
        payload.china_item_name, payload.planned_sale_date::date, payload.detail_page_due_date::date, payload.registered_product_name,
        payload.package_info_url, payload.package_progress_status, payload.package_status, payload.korean_manual_status,
        payload.declared_value, payload.b2b_price, payload.b2c_price, payload.carrier, payload.b2b_shipping_fee, payload.b2c_shipping_fee,
        payload.quality_notice_status, payload.package_box_design, payload.package_manufacturer, payload.package_packing,
        payload.sabangnet_code, payload.product_keywords, payload.purchase_reference_notes, payload.previous_cost_krw,
        payload.b2b_option_surcharge, payload.b2c_option_surcharge,
        payload.notice_material, payload.notice_size, payload.notice_manufacturer, payload.notice_weight, payload.notice_country,
        payload.notice_capacity, payload.notice_food_safety, payload.notice_components, payload.notice_special_notes,
        payload.metadata, ${input.requestedByUserId}::uuid, payload.created_at::timestamptz, payload.updated_at::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS payload(
        source_id text, product_number integer, stage_id text,
        sample_code text, product_name text, product_option text,
        china_unit_price_cny numeric, unit_shipping_cny numeric, exchange_rate_krw numeric, calculated_cost_krw integer,
        domestic_sale_url text, domestic_sale_price integer, detail_page_url text, memo_1 text, memo_2 text,
        english_name text, source_url text, required_checks text, estimated_cost numeric, history_notes text, reference_notes text,
        china_item_name text, planned_sale_date text, detail_page_due_date text, registered_product_name text,
        package_info_url text, package_progress_status text, package_status text, korean_manual_status text,
        declared_value numeric, b2b_price integer, b2c_price integer, carrier text, b2b_shipping_fee integer, b2c_shipping_fee integer,
        quality_notice_status text, package_box_design text, package_manufacturer text, package_packing text,
        sabangnet_code text, product_keywords text, purchase_reference_notes text, previous_cost_krw integer,
        b2b_option_surcharge integer, b2c_option_surcharge integer,
        notice_material text, notice_size text, notice_manufacturer text, notice_weight text, notice_country text,
        notice_capacity text, notice_food_safety text, notice_components text, notice_special_notes text,
        metadata jsonb, created_at text, updated_at text
      )
      ON CONFLICT (user_id, daou_works_id) WHERE daou_works_id IS NOT NULL
      DO UPDATE SET
        stage_id = EXCLUDED.stage_id,
        sample_code = EXCLUDED.sample_code,
        product_name = EXCLUDED.product_name,
        product_option = EXCLUDED.product_option,
        china_unit_price_cny = EXCLUDED.china_unit_price_cny,
        unit_shipping_cny = EXCLUDED.unit_shipping_cny,
        exchange_rate_krw = EXCLUDED.exchange_rate_krw,
        calculated_cost_krw = EXCLUDED.calculated_cost_krw,
        domestic_sale_url = EXCLUDED.domestic_sale_url,
        domestic_sale_price = EXCLUDED.domestic_sale_price,
        detail_page_url = EXCLUDED.detail_page_url,
        memo_1 = EXCLUDED.memo_1,
        memo_2 = EXCLUDED.memo_2,
        english_name = EXCLUDED.english_name,
        source_url = EXCLUDED.source_url,
        required_checks = EXCLUDED.required_checks,
        estimated_cost = EXCLUDED.estimated_cost,
        history_notes = EXCLUDED.history_notes,
        reference_notes = EXCLUDED.reference_notes,
        china_item_name = EXCLUDED.china_item_name,
        planned_sale_date = EXCLUDED.planned_sale_date,
        detail_page_due_date = EXCLUDED.detail_page_due_date,
        registered_product_name = EXCLUDED.registered_product_name,
        package_info_url = EXCLUDED.package_info_url,
        package_progress_status = EXCLUDED.package_progress_status,
        package_status = EXCLUDED.package_status,
        korean_manual_status = EXCLUDED.korean_manual_status,
        declared_value = EXCLUDED.declared_value,
        b2b_price = EXCLUDED.b2b_price,
        b2c_price = EXCLUDED.b2c_price,
        carrier = EXCLUDED.carrier,
        b2b_shipping_fee = EXCLUDED.b2b_shipping_fee,
        b2c_shipping_fee = EXCLUDED.b2c_shipping_fee,
        quality_notice_status = EXCLUDED.quality_notice_status,
        package_box_design = EXCLUDED.package_box_design,
        package_manufacturer = EXCLUDED.package_manufacturer,
        package_packing = EXCLUDED.package_packing,
        sabangnet_code = EXCLUDED.sabangnet_code,
        product_keywords = EXCLUDED.product_keywords,
        purchase_reference_notes = EXCLUDED.purchase_reference_notes,
        previous_cost_krw = EXCLUDED.previous_cost_krw,
        b2b_option_surcharge = EXCLUDED.b2b_option_surcharge,
        b2c_option_surcharge = EXCLUDED.b2c_option_surcharge,
        notice_material = EXCLUDED.notice_material,
        notice_size = EXCLUDED.notice_size,
        notice_manufacturer = EXCLUDED.notice_manufacturer,
        notice_weight = EXCLUDED.notice_weight,
        notice_country = EXCLUDED.notice_country,
        notice_capacity = EXCLUDED.notice_capacity,
        notice_food_safety = EXCLUDED.notice_food_safety,
        notice_components = EXCLUDED.notice_components,
        notice_special_notes = EXCLUDED.notice_special_notes,
        metadata = COALESCE(new_product_workflow_items.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `)

    return {
      processed: items.length,
      inserted: importableItems.filter((item) => !existingSourceIds.has(item.sourceId)).length,
      updated: importableItems.filter((item) => existingSourceIds.has(item.sourceId)).length,
      skippedDuplicateSampleCodes: filtered.duplicateSampleCodes.length,
      stageCount: stages.length,
    }
  })
}

type DaouWorksTextFieldRow = {
  id: string
  requiredChecks: string | null
  productKeywords: string | null
  historyNotes: string | null
  referenceNotes: string | null
}

export function buildDaouWorksTextFieldMigration(input: DaouWorksTextFieldRow) {
  const keywordValues = splitDaouWorksRequiredChecks(input.requiredChecks)
  const keywordMoved = Boolean(keywordValues.productKeywords)
  const historyNotes = normalizeDaouWorksText(input.historyNotes)
  const referenceNotes = normalizeDaouWorksText(input.referenceNotes)
  const productKeywords = keywordMoved
    ? joinUniqueDaouWorksText([input.productKeywords, keywordValues.productKeywords])
    : input.productKeywords
  const nextReferenceNotes = historyNotes
    ? joinUniqueDaouWorksText([
      `히스토리: ${historyNotes}`,
      referenceNotes ? referenceNotes.startsWith('비고:') ? referenceNotes : `비고: ${referenceNotes}` : null,
    ])
    : input.referenceNotes
  const values = {
    requiredChecks: keywordMoved ? keywordValues.requiredChecks : input.requiredChecks,
    productKeywords,
    historyNotes: historyNotes ? null : input.historyNotes,
    referenceNotes: nextReferenceNotes,
  }

  return {
    ...values,
    keywordMoved,
    historyMoved: Boolean(historyNotes),
    changed: values.requiredChecks !== input.requiredChecks
      || values.productKeywords !== input.productKeywords
      || values.historyNotes !== input.historyNotes
      || values.referenceNotes !== input.referenceNotes,
  }
}

export async function migrateDaouWorksTextFields(input: {
  userId: string
  requestedByUserId: string
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const viewer = await getNewProductViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('WORKS 텍스트 정리는 메인만 실행할 수 있습니다.')

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-daou-text-migration:${input.userId}`}))`)
    const rows = resultRows<DaouWorksTextFieldRow>(await tx.execute(sql`
      SELECT
        id,
        required_checks AS "requiredChecks",
        product_keywords AS "productKeywords",
        history_notes AS "historyNotes",
        reference_notes AS "referenceNotes"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
        AND daou_works_id IS NOT NULL
    `))
    const updates = rows.map((row) => ({ row, migration: buildDaouWorksTextFieldMigration(row) }))
      .filter(({ migration }) => migration.changed)

    for (let index = 0; index < updates.length; index += 500) {
      const payload = updates.slice(index, index + 500).map(({ row, migration }) => ({
        id: row.id,
        required_checks: migration.requiredChecks,
        product_keywords: migration.productKeywords,
        history_notes: migration.historyNotes,
        reference_notes: migration.referenceNotes,
      }))
      await tx.execute(sql`
        UPDATE new_product_workflow_items AS item
        SET
          required_checks = payload.required_checks,
          product_keywords = payload.product_keywords,
          history_notes = payload.history_notes,
          reference_notes = payload.reference_notes,
          updated_at = now()
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS payload(
          id text,
          required_checks text,
          product_keywords text,
          history_notes text,
          reference_notes text
        )
        WHERE item.id = payload.id::uuid
          AND item.user_id = ${input.userId}::uuid
      `)
    }

    return {
      scanned: rows.length,
      updated: updates.length,
      keywordsMoved: updates.filter(({ migration }) => migration.keywordMoved).length,
      historiesMoved: updates.filter(({ migration }) => migration.historyMoved).length,
    }
  })
}

type WorkflowStageRow = {
  id: string
  name: string
  position: number
}

function normalizeDaouWorksText(value: string | null) {
  const normalized = value?.trim()
  return normalized || null
}

function joinUniqueDaouWorksText(values: Array<string | null>) {
  const uniqueValues = [...new Set(values.map(normalizeDaouWorksText).filter((value): value is string => Boolean(value)))]
  return uniqueValues.length > 0 ? uniqueValues.join('\n\n') : null
}

async function listDaouWorksTargetStages(tx: WorkflowTransaction, userId: string) {
  return resultRows<WorkflowStageRow>(await tx.execute(sql`
    SELECT id, name, position
    FROM new_product_workflow_stages
    WHERE user_id = ${userId}::uuid
    ORDER BY position, created_at
    FOR UPDATE
  `))
}

function resolveDaouWorksStageIds(input: {
  sourceStatuses: string[]
  stageMappings: Map<string, string>
  stages: WorkflowStageRow[]
}) {
  const currentStageIds = new Set(input.stages.map((stage) => stage.id))
  const resolved = new Map<string, string>()
  for (const sourceStatus of input.sourceStatuses) {
    const stageId = input.stageMappings.get(sourceStatus)
    if (!stageId) throw new Error(`WORKS 상태 "${sourceStatus}"에 연결할 현재 SaaS 단계를 선택해주세요.`)
    if (!currentStageIds.has(stageId)) {
      throw new Error(`WORKS 상태 "${sourceStatus}"에 연결한 SaaS 단계를 찾지 못했습니다. 다시 선택해주세요.`)
    }
    resolved.set(sourceStatus, stageId)
  }
  return resolved
}

function normalizeDaouWorksStageMappings(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return new Map<string, string>()
  return new Map(Object.entries(input)
    .map(([sourceStatus, stageId]) => [sourceStatus.trim(), typeof stageId === 'string' ? stageId.trim() : ''] as const)
    .filter(([sourceStatus, stageId]) => Boolean(sourceStatus && stageId)))
}

export function filterDaouWorksItemsWithUniqueSampleCodes(input: {
  items: DaouWorksImportItem[]
  existingRows: Array<{ sourceId: string | null; sampleCode: string }>
}) {
  const existingSourceIdsByCode = new Map<string, Set<string | null>>()
  for (const row of input.existingRows) {
    const sampleCode = normalizedSampleCode(row.sampleCode)
    if (!sampleCode) continue
    const sourceIds = existingSourceIdsByCode.get(sampleCode) ?? new Set<string | null>()
    sourceIds.add(row.sourceId)
    existingSourceIdsByCode.set(sampleCode, sourceIds)
  }

  const importedSourceIdByCode = new Map<string, string>()
  const duplicateSampleCodes = new Map<string, string>()
  const items = input.items.filter((item) => {
    const sampleCode = normalizedSampleCode(item.values.sampleCode)
    if (!sampleCode) return true

    const existingSourceIds = existingSourceIdsByCode.get(sampleCode)
    const conflictsWithExisting = [...(existingSourceIds ?? [])].some((sourceId) => sourceId !== item.sourceId)
    const sourceIdInImport = importedSourceIdByCode.get(sampleCode)
    const conflictsWithinImport = Boolean(sourceIdInImport && sourceIdInImport !== item.sourceId)
    if (conflictsWithExisting || conflictsWithinImport) {
      duplicateSampleCodes.set(sampleCode, item.values.sampleCode!.trim())
      return false
    }

    importedSourceIdByCode.set(sampleCode, item.sourceId)
    return true
  })

  return { items, duplicateSampleCodes: [...duplicateSampleCodes.values()] }
}

function normalizedSampleCode(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function daouWorksPayload(input: {
  item: DaouWorksImportItem
  stageId: string
  productNumber: number
  importedAt: string
}) {
  const { values, source } = input.item
  return {
    source_id: input.item.sourceId,
    product_number: input.productNumber,
    stage_id: input.stageId,
    sample_code: values.sampleCode,
    product_name: values.productName,
    product_option: values.productOption,
    china_unit_price_cny: values.chinaUnitPriceCny,
    unit_shipping_cny: values.unitShippingCny,
    exchange_rate_krw: values.exchangeRateKrw,
    calculated_cost_krw: values.calculatedCostKrw,
    domestic_sale_url: values.domesticSaleUrl,
    domestic_sale_price: values.domesticSalePrice,
    detail_page_url: values.detailPageUrl,
    memo_1: values.memo1,
    memo_2: values.memo2,
    english_name: values.englishName,
    source_url: values.sourceUrl,
    required_checks: values.requiredChecks,
    estimated_cost: values.estimatedCost,
    history_notes: values.historyNotes,
    reference_notes: values.referenceNotes,
    china_item_name: values.chinaItemName,
    planned_sale_date: values.plannedSaleDate,
    detail_page_due_date: values.detailPageDueDate,
    registered_product_name: values.registeredProductName,
    package_info_url: values.packageInfoUrl,
    package_progress_status: values.packageProgressStatus,
    package_status: values.packageStatus,
    korean_manual_status: values.koreanManualStatus,
    declared_value: values.declaredValue,
    b2b_price: values.b2bPrice,
    b2c_price: values.b2cPrice,
    carrier: values.carrier,
    b2b_shipping_fee: values.b2bShippingFee,
    b2c_shipping_fee: values.b2cShippingFee,
    quality_notice_status: values.qualityNoticeStatus,
    package_box_design: values.packageBoxDesign,
    package_manufacturer: values.packageManufacturer,
    package_packing: values.packagePacking,
    sabangnet_code: values.sabangnetCode,
    product_keywords: values.productKeywords,
    purchase_reference_notes: values.purchaseReferenceNotes,
    previous_cost_krw: values.previousCostKrw,
    b2b_option_surcharge: values.b2bOptionSurcharge,
    b2c_option_surcharge: values.b2cOptionSurcharge,
    notice_material: values.noticeMaterial,
    notice_size: values.noticeSize,
    notice_manufacturer: values.noticeManufacturer,
    notice_weight: values.noticeWeight,
    notice_country: values.noticeCountry,
    notice_capacity: values.noticeCapacity,
    notice_food_safety: values.noticeFoodSafety,
    notice_components: values.noticeComponents,
    notice_special_notes: values.noticeSpecialNotes,
    metadata: { optionDetails: values.optionDetails ?? [], daouWorks: source },
    created_at: source.registeredAt ?? input.importedAt,
    updated_at: source.updatedAt ?? input.importedAt,
  }
}

export async function createNewProduct(input: {
  userId: string
  requestedByUserId: string
  values: NewProductInput
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const values = applyPrimaryOptionValues(input.values)
  const calculatedCostKrw = values.calculatedCostKrw ?? calculateCnyCostKrw({
    chinaUnitPriceCny: values.chinaUnitPriceCny,
    unitShippingCny: values.unitShippingCny,
    exchangeRateKrw: values.exchangeRateKrw,
  })
  const estimatedCost = values.estimatedCost ?? calculatedCostKrw
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-number:${input.userId}`}))`)
    const stage = await assertStage(tx, input.userId, input.values.stageId)
    await assertNewProductSampleCodeAvailable({
      tx,
      userId: input.userId,
      sampleCode: input.values.sampleCode,
    })
    const [{ nextNumber } = { nextNumber: 1 }] = resultRows<{ nextNumber: number }>(await tx.execute(sql`
      SELECT COALESCE(MAX(product_number), 0)::int + 1 AS "nextNumber"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
    `))
    const [created] = resultRows<{ id: string }>(await tx.execute(sql`
      INSERT INTO new_product_workflow_items (
        user_id, product_number, stage_id,
        sample_code, product_name, product_option,
        china_unit_price_cny, unit_shipping_cny, exchange_rate_krw, calculated_cost_krw,
        domestic_sale_url, domestic_sale_price, detail_page_url, memo_1, memo_2,
        english_name,
        source_url, required_checks, estimated_cost, history_notes, reference_notes,
        china_item_name, planned_sale_date, detail_page_due_date, registered_product_name,
        package_info_url, package_progress_status, package_status, korean_manual_status,
        declared_value, b2b_price, b2c_price, carrier, b2b_shipping_fee, b2c_shipping_fee,
        quality_notice_status, package_box_design, package_manufacturer, package_packing,
        sabangnet_code, product_keywords, purchase_reference_notes, previous_cost_krw,
        b2b_option_surcharge, b2c_option_surcharge,
        notice_material, notice_size, notice_manufacturer, notice_weight, notice_country,
        notice_capacity, notice_food_safety, notice_components, notice_special_notes,
        metadata, created_by_user_id
      ) VALUES (
        ${input.userId}::uuid, ${nextNumber}, ${input.values.stageId}::uuid,
        ${input.values.sampleCode}, ${input.values.productName}, ${input.values.productOption},
        ${values.chinaUnitPriceCny}, ${values.unitShippingCny}, ${values.exchangeRateKrw}, ${calculatedCostKrw},
        ${input.values.domesticSaleUrl}, ${input.values.domesticSalePrice}, ${input.values.detailPageUrl}, ${input.values.memo1}, ${input.values.memo2},
        ${input.values.englishName},
        ${input.values.sourceUrl}, ${input.values.requiredChecks}, ${estimatedCost},
        ${input.values.historyNotes}, ${input.values.referenceNotes}, ${input.values.chinaItemName},
        ${input.values.plannedSaleDate}::date, ${input.values.detailPageDueDate}::date,
        ${input.values.registeredProductName}, ${input.values.packageInfoUrl},
        ${input.values.packageProgressStatus}, ${input.values.packageStatus},
        ${input.values.koreanManualStatus}, ${input.values.declaredValue},
        ${input.values.b2bPrice}, ${input.values.b2cPrice}, ${input.values.carrier},
        ${input.values.b2bShippingFee}, ${input.values.b2cShippingFee},
        ${input.values.qualityNoticeStatus}, ${input.values.packageBoxDesign},
        ${input.values.packageManufacturer}, ${input.values.packagePacking},
        ${values.sabangnetCode}, ${input.values.productKeywords}, ${input.values.purchaseReferenceNotes},
        ${values.previousCostKrw},
        ${values.b2bOptionSurcharge}, ${values.b2cOptionSurcharge},
        ${input.values.noticeMaterial}, ${input.values.noticeSize}, ${input.values.noticeManufacturer},
        ${input.values.noticeWeight}, ${input.values.noticeCountry}, ${input.values.noticeCapacity},
        ${input.values.noticeFoodSafety}, ${input.values.noticeComponents},
        ${input.values.noticeSpecialNotes},
        ${JSON.stringify({ optionDetails: input.values.optionDetails ?? [] })}::jsonb,
        ${input.requestedByUserId}::uuid
      )
      RETURNING id
    `))
    await tx.execute(sql`
      INSERT INTO new_product_workflow_stage_history (
        user_id, item_id, to_stage_id, note, changed_by_user_id
      ) VALUES (
        ${input.userId}::uuid, ${created!.id}::uuid, ${input.values.stageId}::uuid,
        '신상품 등록', ${input.requestedByUserId}::uuid
      )
    `)
    const itemMasterSync = await syncNewProductToItemMaster(tx, {
      userId: input.userId,
      itemId: created!.id,
      stage,
      values: { ...values, calculatedCostKrw },
    })
    return { id: created!.id, productNumber: nextNumber, itemMasterSync }
  })
}

export async function updateNewProduct(input: {
  userId: string
  requestedByUserId: string
  itemId: string
  values: NewProductInput
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const values = applyPrimaryOptionValues(input.values)
  return db.transaction(async (tx) => {
    const [current] = resultRows<{ stageId: string }>(await tx.execute(sql`
      SELECT stage_id AS "stageId"
      FROM new_product_workflow_items
      WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
      FOR UPDATE
    `))
    if (!current) throw new Error('신상품을 찾을 수 없습니다.')
    const stage = await assertStage(tx, input.userId, input.values.stageId)
    await assertNewProductSampleCodeAvailable({
      tx,
      userId: input.userId,
      sampleCode: input.values.sampleCode,
      excludeItemId: input.itemId,
    })
    const calculatedCostKrw = values.calculatedCostKrw ?? calculateCnyCostKrw({
      chinaUnitPriceCny: values.chinaUnitPriceCny,
      unitShippingCny: values.unitShippingCny,
      exchangeRateKrw: values.exchangeRateKrw,
    })

    await tx.execute(sql`
      UPDATE new_product_workflow_items SET
        stage_id = ${input.values.stageId}::uuid,
        sample_code = ${input.values.sampleCode},
        product_name = ${input.values.productName},
        product_option = ${input.values.productOption},
        china_unit_price_cny = ${values.chinaUnitPriceCny},
        unit_shipping_cny = ${values.unitShippingCny},
        exchange_rate_krw = ${values.exchangeRateKrw},
        calculated_cost_krw = ${calculatedCostKrw},
        domestic_sale_url = ${input.values.domesticSaleUrl},
        domestic_sale_price = ${input.values.domesticSalePrice},
        detail_page_url = ${input.values.detailPageUrl},
        memo_1 = ${input.values.memo1},
        memo_2 = ${input.values.memo2},
        english_name = ${input.values.englishName},
        source_url = ${input.values.sourceUrl},
        required_checks = ${input.values.requiredChecks},
        estimated_cost = ${input.values.estimatedCost},
        history_notes = ${input.values.historyNotes},
        reference_notes = ${input.values.referenceNotes},
        china_item_name = ${input.values.chinaItemName},
        planned_sale_date = ${input.values.plannedSaleDate}::date,
        detail_page_due_date = ${input.values.detailPageDueDate}::date,
        registered_product_name = ${input.values.registeredProductName},
        package_info_url = ${input.values.packageInfoUrl},
        package_progress_status = ${input.values.packageProgressStatus},
        package_status = ${input.values.packageStatus},
        korean_manual_status = ${input.values.koreanManualStatus},
        declared_value = ${input.values.declaredValue},
        b2b_price = ${input.values.b2bPrice},
        b2c_price = ${input.values.b2cPrice},
        carrier = ${input.values.carrier},
        b2b_shipping_fee = ${input.values.b2bShippingFee},
        b2c_shipping_fee = ${input.values.b2cShippingFee},
        quality_notice_status = ${input.values.qualityNoticeStatus},
        package_box_design = ${input.values.packageBoxDesign},
        package_manufacturer = ${input.values.packageManufacturer},
        package_packing = ${input.values.packagePacking},
        sabangnet_code = ${values.sabangnetCode},
        product_keywords = ${input.values.productKeywords},
        purchase_reference_notes = ${input.values.purchaseReferenceNotes},
        previous_cost_krw = ${values.previousCostKrw},
        b2b_option_surcharge = ${values.b2bOptionSurcharge},
        b2c_option_surcharge = ${values.b2cOptionSurcharge},
        notice_material = ${input.values.noticeMaterial},
        notice_size = ${input.values.noticeSize},
        notice_manufacturer = ${input.values.noticeManufacturer},
        notice_weight = ${input.values.noticeWeight},
        notice_country = ${input.values.noticeCountry},
        notice_capacity = ${input.values.noticeCapacity},
        notice_food_safety = ${input.values.noticeFoodSafety},
        notice_components = ${input.values.noticeComponents},
        notice_special_notes = ${input.values.noticeSpecialNotes},
        metadata = CASE
          WHEN ${input.values.optionDetails === undefined} THEN metadata
          ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'optionDetails', ${JSON.stringify(input.values.optionDetails ?? [])}::jsonb
          )
        END,
        updated_at = now()
      WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
    `)

    if (current.stageId !== input.values.stageId) {
      await insertStageHistory(tx, {
        userId: input.userId,
        requestedByUserId: input.requestedByUserId,
        itemId: input.itemId,
        fromStageId: current.stageId,
        toStageId: input.values.stageId,
        note: '상품 상세에서 단계 변경',
      })
    }
    return syncNewProductToItemMaster(tx, {
      userId: input.userId,
      itemId: input.itemId,
      stage,
      values: { ...values, calculatedCostKrw },
    })
  })
}

async function assertNewProductSampleCodeAvailable(input: {
  tx: WorkflowTransaction
  userId: string
  sampleCode: string | null
  excludeItemId?: string
}) {
  const sampleCode = normalizedSampleCode(input.sampleCode)
  if (!sampleCode) return
  const excludeItemClause = input.excludeItemId
    ? sql`AND id <> ${input.excludeItemId}::uuid`
    : sql``
  const [existing] = resultRows<{ productNumber: number; productName: string }>(await input.tx.execute(sql`
    SELECT
      product_number AS "productNumber",
      product_name AS "productName"
    FROM new_product_workflow_items
    WHERE user_id = ${input.userId}::uuid
      AND lower(btrim(sample_code)) = ${sampleCode}
      ${excludeItemClause}
    LIMIT 1
  `))
  if (!existing) return

  throw new Error(`상품번호 "${input.sampleCode?.trim()}"는 이미 ${existing.productName}에 등록되어 있습니다.`)
}

export async function deleteNewProduct(input: { userId: string; itemId: string }) {
  const result = await deleteNewProducts({ userId: input.userId, itemIds: [input.itemId] })
  return result.deleted === 1
}

export async function deleteNewProducts(input: { userId: string; itemIds: string[] }) {
  await ensureNewProductWorkflowTables(input.userId)
  const itemIds = [...new Set(input.itemIds)].slice(0, 500)
  if (itemIds.length === 0) return { deleted: 0 }
  const result = await db.execute(sql`
    DELETE FROM new_product_workflow_items
    WHERE user_id = ${input.userId}::uuid
      AND id IN (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})
    RETURNING id
  `)
  return { deleted: resultRows(result).length }
}

export async function moveNewProducts(input: {
  userId: string
  requestedByUserId: string
  itemIds: string[]
  stageId: string
  note?: string | null
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const itemIds = [...new Set(input.itemIds)].slice(0, 500)
  if (itemIds.length === 0) return { moved: 0 }

  return db.transaction(async (tx) => {
    const stage = await assertStage(tx, input.userId, input.stageId)
    const currentRows = resultRows<{ id: string; stageId: string }>(await tx.execute(sql`
      SELECT id, stage_id AS "stageId"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
        AND id IN (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})
      FOR UPDATE
    `))
    if (currentRows.length !== itemIds.length) throw new Error('이동할 신상품을 찾을 수 없습니다.')
    const syncResults: ItemMasterSyncResult[] = []
    for (const item of currentRows) {
      if (item.stageId !== input.stageId) {
        await tx.execute(sql`
          UPDATE new_product_workflow_items
          SET stage_id = ${input.stageId}::uuid, updated_at = now()
          WHERE id = ${item.id}::uuid AND user_id = ${input.userId}::uuid
        `)
        await insertStageHistory(tx, {
          userId: input.userId,
          requestedByUserId: input.requestedByUserId,
          itemId: item.id,
          fromStageId: item.stageId,
          toStageId: input.stageId,
          note: input.note ?? (currentRows.length > 1 ? '일괄 단계 변경' : '목록에서 단계 변경'),
        })
      }
      syncResults.push(await syncStoredNewProductToItemMaster(tx, {
        userId: input.userId,
        itemId: item.id,
        stage,
      }))
    }
    return {
      moved: currentRows.filter((item) => item.stageId !== input.stageId).length,
      itemMasterSynced: syncResults.filter((result) => result.status === 'created' || result.status === 'updated').length,
      itemMasterPendingCodes: syncResults.filter((result) => result.status === 'pending_code').length,
    }
  })
}

export async function saveNewProductStages(input: {
  userId: string
  requestedByUserId: string
  stages: Array<{ id?: string; name: string; tone: string }>
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const viewer = await getNewProductViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('단계 설정은 메인만 변경할 수 있습니다.')
  if (input.stages.length < 1 || input.stages.length > 40) throw new Error('단계는 1~40개로 설정해주세요.')
  const stages = input.stages.map((stage) => ({
    id: stage.id?.trim() || null,
    name: stage.name.trim().slice(0, 160),
    tone: validTone(stage.tone),
  }))
  if (stages.some((stage) => !stage.name)) throw new Error('단계 이름을 입력해주세요.')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-stages:${input.userId}`}))`)
    for (const [index, stage] of stages.entries()) {
      if (stage.id) {
        const result = await tx.execute(sql`
          UPDATE new_product_workflow_stages
          SET name = ${stage.name}, tone = ${stage.tone}, position = ${index + 1}, updated_at = now()
          WHERE id = ${stage.id}::uuid AND user_id = ${input.userId}::uuid
          RETURNING id
        `)
        if (resultRows(result).length === 0) throw new Error('수정할 단계를 찾을 수 없습니다.')
      } else {
        await tx.execute(sql`
          INSERT INTO new_product_workflow_stages (user_id, name, tone, position)
          VALUES (${input.userId}::uuid, ${stage.name}, ${stage.tone}, ${index + 1})
        `)
      }
    }
  })
}

export async function saveNewProductEditorLayout(input: {
  userId: string
  requestedByUserId: string
  layout: NewProductEditorLayout
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const viewer = await getNewProductViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('레이아웃 설정은 메인만 변경할 수 있습니다.')
  const layout = normalizeNewProductEditorLayout(input.layout)
  await db.execute(sql`
    INSERT INTO new_product_workflow_preferences (user_id, editor_layout, updated_at)
    VALUES (${input.userId}::uuid, ${JSON.stringify(layout)}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET
      editor_layout = EXCLUDED.editor_layout,
      updated_at = now()
  `)
  return layout
}

export async function saveNewProductOperators(input: {
  userId: string
  actorUserId: string
  operators: Array<{ memberUserId: string; displayName: string }>
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const viewer = await getNewProductViewer({ userId: input.userId, actorUserId: input.actorUserId })
  if (!viewer.isMain) throw new Error('등록자 설정은 메인만 변경할 수 있습니다.')

  const operators = input.operators
    .map((operator) => ({
      memberUserId: operator.memberUserId.trim(),
      displayName: operator.displayName.trim().slice(0, 100),
    }))
    .filter((operator) => operator.memberUserId && operator.displayName)
    .slice(0, 5)
  if (operators.length === 0) throw new Error('등록자를 1명 이상 설정해주세요.')
  if (new Set(operators.map((operator) => operator.memberUserId)).size !== operators.length) {
    throw new Error('같은 계정을 등록자에 중복으로 지정할 수 없습니다.')
  }

  const memberRows = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM user_profiles
    WHERE id IN (${sql.join(operators.map((operator) => sql`${operator.memberUserId}::uuid`), sql`, `)})
      AND deactivated_at IS NULL
  `))
  if (memberRows.length !== operators.length) throw new Error('활성 계정만 등록자로 지정할 수 있습니다.')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-operators:${input.userId}`}))`)
    await tx.execute(sql`
      UPDATE new_product_workflow_operators
      SET is_active = FALSE, updated_at = now()
      WHERE user_id = ${input.userId}::uuid
    `)
    for (const [index, operator] of operators.entries()) {
      await tx.execute(sql`
        INSERT INTO new_product_workflow_operators (
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

export async function addNewProductAttachment(input: {
  userId: string
  requestedByUserId: string
  itemId: string
  kind: NewProductAttachment['kind']
  fileName: string
  contentType: string
  fileBuffer: ArrayBuffer
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const [item] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM new_product_workflow_items
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
    LIMIT 1
  `))
  if (!item) throw new Error('첨부할 신상품을 찾을 수 없습니다.')
  const base64 = Buffer.from(input.fileBuffer).toString('base64')
  const [created] = resultRows<{ id: string }>(await db.execute(sql`
    INSERT INTO new_product_workflow_attachments (
      user_id, item_id, kind, file_name, content_type, file_size, file_data, uploaded_by_user_id
    )
    SELECT
      ${input.userId}::uuid, item.id, ${input.kind}, ${input.fileName}, ${input.contentType},
      ${input.fileBuffer.byteLength}, decode(${base64}, 'base64'), ${input.requestedByUserId}::uuid
    FROM new_product_workflow_items item
    WHERE item.id = ${input.itemId}::uuid AND item.user_id = ${input.userId}::uuid
    RETURNING id
  `))
  if (!created) throw new Error('첨부할 신상품을 찾을 수 없습니다.')
  await db.execute(sql`
    UPDATE new_product_workflow_items SET updated_at = now()
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
  `)
  return created
}

export async function getNewProductAttachment(input: { userId: string; requestedByUserId: string; attachmentId: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const [attachment] = resultRows<{
    fileName: string
    contentType: string
    fileDataBase64: string
  }>(await db.execute(sql`
    SELECT
      attachment.file_name AS "fileName",
      attachment.content_type AS "contentType",
      encode(attachment.file_data, 'base64') AS "fileDataBase64"
    FROM new_product_workflow_attachments attachment
    JOIN new_product_workflow_items item ON item.id = attachment.item_id
    WHERE attachment.id = ${input.attachmentId}::uuid
      AND attachment.user_id = ${input.userId}::uuid
  `))
  return attachment ?? null
}

export async function deleteNewProductAttachment(input: { userId: string; requestedByUserId: string; attachmentId: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const [attachment] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT attachment.id
    FROM new_product_workflow_attachments attachment
    JOIN new_product_workflow_items item ON item.id = attachment.item_id
    WHERE attachment.id = ${input.attachmentId}::uuid
      AND attachment.user_id = ${input.userId}::uuid
    LIMIT 1
  `))
  if (!attachment) return false
  const result = await db.execute(sql`
    DELETE FROM new_product_workflow_attachments
    WHERE id = ${input.attachmentId}::uuid AND user_id = ${input.userId}::uuid
    RETURNING id
  `)
  return resultRows(result).length > 0
}

type WorkflowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function assertStage(tx: WorkflowTransaction, userId: string, stageId: string) {
  const result = await tx.execute(sql`
    SELECT
      stage.id,
      stage.name,
      stage.position,
      COALESCE((
        SELECT MIN(notice_stage.position)::int
        FROM new_product_workflow_stages notice_stage
        WHERE notice_stage.user_id = stage.user_id
          AND notice_stage.name ILIKE '%상품정보고시%'
      ), 5) AS "itemMasterStartPosition"
    FROM new_product_workflow_stages stage
    WHERE stage.id = ${stageId}::uuid AND stage.user_id = ${userId}::uuid
  `)
  const [stage] = resultRows<{
    id: string
    name: string
    position: number
    itemMasterStartPosition: number
  }>(result)
  if (!stage) throw new Error('선택한 단계를 찾을 수 없습니다.')
  return stage
}

async function syncStoredNewProductToItemMaster(
  tx: WorkflowTransaction,
  input: { userId: string; itemId: string; stage: NewProductItemMasterStage },
) {
  const [values] = resultRows<NewProductItemMasterValues>(await tx.execute(sql`
    SELECT
      product_name AS "productName",
      registered_product_name AS "registeredProductName",
      english_name AS "englishName",
      source_url AS "sourceUrl",
      product_option AS "productOption",
      sabangnet_code AS "sabangnetCode",
      purchase_reference_notes AS "purchaseReferenceNotes",
      china_unit_price_cny::float8 AS "chinaUnitPriceCny",
      calculated_cost_krw AS "calculatedCostKrw",
      previous_cost_krw AS "previousCostKrw",
      exchange_rate_krw::float8 AS "exchangeRateKrw",
      b2b_option_surcharge AS "b2bOptionSurcharge",
      b2c_option_surcharge AS "b2cOptionSurcharge",
      b2b_price AS "b2bPrice",
      b2c_price AS "b2cPrice",
      notice_material AS "noticeMaterial",
      notice_size AS "noticeSize",
      notice_manufacturer AS "noticeManufacturer",
      notice_weight AS "noticeWeight",
      notice_country AS "noticeCountry",
      notice_capacity AS "noticeCapacity",
      notice_food_safety AS "noticeFoodSafety",
      notice_components AS "noticeComponents",
      notice_special_notes AS "noticeSpecialNotes"
    FROM new_product_workflow_items
    WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
  `))
  if (!values) throw new Error('품목에 반영할 신상품을 찾을 수 없습니다.')
  return syncNewProductToItemMaster(tx, { ...input, values })
}

async function syncNewProductToItemMaster(
  tx: WorkflowTransaction,
  input: {
    userId: string
    itemId: string
    stage: NewProductItemMasterStage
    values: NewProductItemMasterValues
  },
): Promise<ItemMasterSyncResult> {
  if (!shouldSyncNewProductToItemMaster(input.stage)) return { status: 'not_required' }
  const code = input.values.sabangnetCode?.trim()
  if (!code) return { status: 'pending_code' }

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-item-master:${input.userId}:${code}`}))`)
  const [existing] = resultRows<{ id: string }>(await tx.execute(sql`
    SELECT id FROM products
    WHERE user_id = ${input.userId}::uuid AND internal_sku = ${code}
  `))
  const itemData = buildNewProductItemMasterData(input.values)
  const itemName = input.values.registeredProductName?.trim() || input.values.productName.trim()
  const basePrice = input.values.b2cPrice ?? input.values.b2bPrice ?? 0
  const metadata = {
    esa009m: itemData,
    newProductWorkflow: { itemId: input.itemId, syncedAt: new Date().toISOString() },
  }
  const [product] = resultRows<{ id: string }>(await tx.execute(sql`
    INSERT INTO products (
      user_id, internal_sku, name, base_price, cost_price, status, metadata, updated_at
    ) VALUES (
      ${input.userId}::uuid, ${code}, ${itemName}, ${basePrice}, ${input.values.calculatedCostKrw},
      'draft', ${JSON.stringify(metadata)}::jsonb, now()
    )
    ON CONFLICT (user_id, internal_sku) DO UPDATE SET
      name = EXCLUDED.name,
      base_price = CASE WHEN EXCLUDED.base_price > 0 THEN EXCLUDED.base_price ELSE products.base_price END,
      cost_price = COALESCE(EXCLUDED.cost_price, products.cost_price),
      metadata = COALESCE(products.metadata, '{}'::jsonb) || jsonb_build_object(
        'esa009m', COALESCE(products.metadata -> 'esa009m', '{}'::jsonb) || (EXCLUDED.metadata -> 'esa009m'),
        'newProductWorkflow', EXCLUDED.metadata -> 'newProductWorkflow'
      ),
      updated_at = now()
    RETURNING id
  `))
  return { status: existing ? 'updated' : 'created', productId: product!.id }
}

async function insertStageHistory(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    userId: string
    requestedByUserId: string
    itemId: string
    fromStageId: string
    toStageId: string
    note: string | null
  },
) {
  await tx.execute(sql`
    INSERT INTO new_product_workflow_stage_history (
      user_id, item_id, from_stage_id, to_stage_id, note, changed_by_user_id
    ) VALUES (
      ${input.userId}::uuid, ${input.itemId}::uuid, ${input.fromStageId}::uuid,
      ${input.toStageId}::uuid, ${input.note}, ${input.requestedByUserId}::uuid
    )
  `)
}

function validTone(value: unknown): NewProductStageTone {
  return NEW_PRODUCT_STAGE_TONES.includes(value as NewProductStageTone)
    ? value as NewProductStageTone
    : 'slate'
}

export function normalizeNewProductEditorLayout(value: unknown): NewProductEditorLayout {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const requestedOrder = Array.isArray(raw.sectionOrder)
    ? raw.sectionOrder.filter((section): section is NewProductEditorSection => (
        NEW_PRODUCT_EDITOR_SECTIONS.includes(section as NewProductEditorSection)
      ))
    : []
  const sectionOrder = [
    ...new Set(requestedOrder),
    ...NEW_PRODUCT_EDITOR_SECTIONS.filter((section) => !requestedOrder.includes(section)),
  ]
  const hiddenSections = Array.isArray(raw.hiddenSections)
    ? [...new Set(raw.hiddenSections.filter((section): section is NewProductEditorSection => (
        NEW_PRODUCT_EDITOR_SECTIONS.includes(section as NewProductEditorSection) && section !== 'basic'
      )))]
    : []
  const columns = raw.columns === 1 || raw.columns === 3 ? raw.columns : 2
  return { sectionOrder, hiddenSections, columns }
}

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function jsonObject<T extends object>(value: unknown): T | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null
  } catch {
    return null
  }
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return (result as { rows?: T[] }).rows ?? []
}

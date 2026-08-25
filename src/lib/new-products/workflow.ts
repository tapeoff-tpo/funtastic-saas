import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export const DEFAULT_NEW_PRODUCT_STAGES = [
  { name: '1차 통과 상품 등록', tone: 'blue' },
  { name: '샘플 구매', tone: 'violet' },
  { name: '샘플 국내 도착·최종 미팅', tone: 'cyan' },
  { name: '상품정보고시 제작', tone: 'amber' },
  { name: '사방넷 상품등록', tone: 'orange' },
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

export type NewProductItem = {
  id: string
  productNumber: number
  stageId: string
  stageName: string
  stagePosition: number
  stageTone: NewProductStageTone
  sampleCode: string | null
  productName: string
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
  attachments: NewProductAttachment[]
  stageHistory: NewProductStageHistory[]
  createdAt: string
  updatedAt: string
}

export type NewProductInput = {
  stageId: string
  sampleCode: string | null
  productName: string
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
}

export type NewProductSummary = {
  id: string
  productNumber: number
  stageId: string
  stageName: string
  stageTone: NewProductStageTone
  productName: string
  sampleCode: string | null
  updatedAt: string
}

export const NEW_PRODUCT_EDITOR_SECTIONS = [
  'progress',
  'basic',
  'attachments',
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

export async function ensureNewProductWorkflowTables(userId: string) {
  await ensureNewProductWorkflowSchema()
  const existingPromise = ensureWorkspacePromises.get(userId)
  if (existingPromise) return existingPromise

  const workspacePromise = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-default-stages:${userId}`}))`)
    const [{ count } = { count: 0 }] = resultRows<{ count: number }>(await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM new_product_workflow_stages
      WHERE user_id = ${userId}::uuid
    `))
    if (count === 0) {
      for (const [index, stage] of DEFAULT_NEW_PRODUCT_STAGES.entries()) {
        await tx.execute(sql`
          INSERT INTO new_product_workflow_stages (user_id, name, position, tone)
          VALUES (${userId}::uuid, ${stage.name}, ${index + 1}, ${stage.tone})
        `)
      }
    }
  }).then(() => undefined).catch((error) => {
    ensureWorkspacePromises.delete(userId)
    throw error
  })
  ensureWorkspacePromises.set(userId, workspacePromise)
  return workspacePromise
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
    CREATE TABLE IF NOT EXISTS new_product_workflow_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      product_number integer NOT NULL,
      stage_id uuid NOT NULL REFERENCES new_product_workflow_stages(id),
      sample_code varchar(200),
      product_name text NOT NULL,
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
  await db.execute(sql`ALTER TABLE new_product_workflow_items ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_stage_history ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_attachments ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE new_product_workflow_preferences ENABLE ROW LEVEL SECURITY`)
}

export async function getNewProductPageSetup(userId: string) {
  await ensureNewProductWorkflowTables(userId)
  const [stageResult, preferenceResult] = await Promise.all([
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
    db.execute<{ editorLayout: unknown }>(sql`
      SELECT editor_layout AS "editorLayout"
      FROM new_product_workflow_preferences
      WHERE user_id = ${userId}::uuid
    `),
  ])
  const [preference] = resultRows<{ editorLayout: unknown }>(preferenceResult)
  return {
    stages: resultRows<NewProductStage>(stageResult).map((stage) => ({
      ...stage,
      tone: validTone(stage.tone),
    })),
    editorLayout: normalizeNewProductEditorLayout(preference?.editorLayout),
  }
}

export async function listNewProductSummaries(input: {
  userId: string
  stageId?: string | null
  query?: string | null
  limit?: number
}) {
  await ensureNewProductWorkflowTables(input.userId)
  const query = input.query?.trim().slice(0, 200) ?? ''
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
  const stageCondition = input.stageId
    ? sql`AND item.stage_id = ${input.stageId}::uuid`
    : sql``
  const searchCondition = query
    ? sql`AND (
        item.product_name ILIKE ${`%${query}%`}
        OR COALESCE(item.sample_code, '') ILIKE ${`%${query}%`}
        OR COALESCE(item.registered_product_name, '') ILIKE ${`%${query}%`}
        OR item.product_number::text ILIKE ${`%${query}%`}
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
        item.product_name AS "productName",
        item.sample_code AS "sampleCode",
        item.updated_at::text AS "updatedAt"
      FROM new_product_workflow_items item
      JOIN new_product_workflow_stages stage ON stage.id = item.stage_id
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
    WHERE item.user_id = ${input.userId}::uuid
      AND item.id = ${input.itemId}::uuid
  `)
  const [item] = resultRows<NewProductItem>(result)
  if (!item) return null
  return {
    ...item,
    stageTone: validTone(item.stageTone),
    attachments: jsonArray<NewProductAttachment>(item.attachments),
    stageHistory: jsonArray<NewProductStageHistory>(item.stageHistory),
  }
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
      attachments: jsonArray<NewProductAttachment>(item.attachments),
      stageHistory: jsonArray<NewProductStageHistory>(item.stageHistory),
    })),
  }
}

export async function createNewProduct(input: {
  userId: string
  requestedByUserId: string
  values: NewProductInput
}) {
  await ensureNewProductWorkflowTables(input.userId)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-number:${input.userId}`}))`)
    await assertStage(tx, input.userId, input.values.stageId)
    const [{ nextNumber } = { nextNumber: 1 }] = resultRows<{ nextNumber: number }>(await tx.execute(sql`
      SELECT COALESCE(MAX(product_number), 0)::int + 1 AS "nextNumber"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
    `))
    const [created] = resultRows<{ id: string }>(await tx.execute(sql`
      INSERT INTO new_product_workflow_items (
        user_id, product_number, stage_id, sample_code, product_name, english_name,
        source_url, required_checks, estimated_cost, history_notes, reference_notes,
        china_item_name, planned_sale_date, detail_page_due_date, registered_product_name,
        package_info_url, package_progress_status, package_status, korean_manual_status,
        declared_value, b2b_price, b2c_price, carrier, b2b_shipping_fee, b2c_shipping_fee,
        quality_notice_status, package_box_design, package_manufacturer, package_packing,
        created_by_user_id
      ) VALUES (
        ${input.userId}::uuid, ${nextNumber}, ${input.values.stageId}::uuid,
        ${input.values.sampleCode}, ${input.values.productName}, ${input.values.englishName},
        ${input.values.sourceUrl}, ${input.values.requiredChecks}, ${input.values.estimatedCost},
        ${input.values.historyNotes}, ${input.values.referenceNotes}, ${input.values.chinaItemName},
        ${input.values.plannedSaleDate}::date, ${input.values.detailPageDueDate}::date,
        ${input.values.registeredProductName}, ${input.values.packageInfoUrl},
        ${input.values.packageProgressStatus}, ${input.values.packageStatus},
        ${input.values.koreanManualStatus}, ${input.values.declaredValue},
        ${input.values.b2bPrice}, ${input.values.b2cPrice}, ${input.values.carrier},
        ${input.values.b2bShippingFee}, ${input.values.b2cShippingFee},
        ${input.values.qualityNoticeStatus}, ${input.values.packageBoxDesign},
        ${input.values.packageManufacturer}, ${input.values.packagePacking},
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
    return { id: created!.id, productNumber: nextNumber }
  })
}

export async function updateNewProduct(input: {
  userId: string
  requestedByUserId: string
  itemId: string
  values: NewProductInput
}) {
  await ensureNewProductWorkflowTables(input.userId)
  await db.transaction(async (tx) => {
    const [current] = resultRows<{ stageId: string }>(await tx.execute(sql`
      SELECT stage_id AS "stageId"
      FROM new_product_workflow_items
      WHERE id = ${input.itemId}::uuid AND user_id = ${input.userId}::uuid
      FOR UPDATE
    `))
    if (!current) throw new Error('신상품을 찾을 수 없습니다.')
    await assertStage(tx, input.userId, input.values.stageId)

    await tx.execute(sql`
      UPDATE new_product_workflow_items SET
        stage_id = ${input.values.stageId}::uuid,
        sample_code = ${input.values.sampleCode},
        product_name = ${input.values.productName},
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
  })
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
    await assertStage(tx, input.userId, input.stageId)
    const currentRows = resultRows<{ id: string; stageId: string }>(await tx.execute(sql`
      SELECT id, stage_id AS "stageId"
      FROM new_product_workflow_items
      WHERE user_id = ${input.userId}::uuid
        AND id IN (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})
      FOR UPDATE
    `))
    for (const item of currentRows) {
      if (item.stageId === input.stageId) continue
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
    return { moved: currentRows.filter((item) => item.stageId !== input.stageId).length }
  })
}

export async function saveNewProductStages(input: {
  userId: string
  stages: Array<{ id?: string; name: string; tone: string }>
}) {
  await ensureNewProductWorkflowTables(input.userId)
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
  layout: NewProductEditorLayout
}) {
  await ensureNewProductWorkflowTables(input.userId)
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

export async function getNewProductAttachment(input: { userId: string; attachmentId: string }) {
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
    WHERE attachment.id = ${input.attachmentId}::uuid
      AND attachment.user_id = ${input.userId}::uuid
  `))
  return attachment ?? null
}

export async function deleteNewProductAttachment(input: { userId: string; attachmentId: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const result = await db.execute(sql`
    DELETE FROM new_product_workflow_attachments
    WHERE id = ${input.attachmentId}::uuid AND user_id = ${input.userId}::uuid
    RETURNING id
  `)
  return resultRows(result).length > 0
}

async function assertStage(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string, stageId: string) {
  const result = await tx.execute(sql`
    SELECT id FROM new_product_workflow_stages
    WHERE id = ${stageId}::uuid AND user_id = ${userId}::uuid
  `)
  if (resultRows(result).length === 0) throw new Error('선택한 단계를 찾을 수 없습니다.')
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

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return (result as { rows?: T[] }).rows ?? []
}

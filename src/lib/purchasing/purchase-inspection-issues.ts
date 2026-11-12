import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { createPurchaseInspection, type PurchaseInspection } from './purchase-inspection'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'

export const INSPECTION_ISSUE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])
export const MAX_INSPECTION_ISSUE_ATTACHMENTS = 5
export const MAX_INSPECTION_ISSUE_ATTACHMENT_BYTES = 700 * 1024

export type PurchaseInspectionIssueAttachment = {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  createdAt: string
}

export type PurchaseInspectionIssue = {
  id: string
  description: string
  createdAt: string
  createdByUserId: string | null
  attachments: PurchaseInspectionIssueAttachment[]
}

type SchemaState = { hasIssues: boolean; hasAttachments: boolean; protectedTables: number }
type IssueRow = Omit<PurchaseInspectionIssue, 'attachments'>
type AttachmentRow = PurchaseInspectionIssueAttachment & { issueId: string }

let ensureSchemaPromise: Promise<void> | null = null

function resultRows<T>(result: T[] | { rows?: T[] }) {
  return Array.isArray(result) ? result : result.rows ?? []
}

async function hasPurchaseInspectionIssueSchema() {
  const [state] = resultRows<SchemaState>(await db.execute(sql`
    SELECT
      to_regclass(current_schema() || '.purchase_inspection_issues') IS NOT NULL AS "hasIssues",
      to_regclass(current_schema() || '.purchase_inspection_issue_attachments') IS NOT NULL AS "hasAttachments",
      (SELECT COUNT(*)::int FROM pg_class WHERE oid IN (
        to_regclass(current_schema() || '.purchase_inspection_issues'),
        to_regclass(current_schema() || '.purchase_inspection_issue_attachments')
      ) AND relrowsecurity) AS "protectedTables"
  `))
  return state?.hasIssues === true && state?.hasAttachments === true && Number(state.protectedTables) === 2
}

/**
 * Migrations are not guaranteed to run before a production serverless request.
 * Keep this additive schema guard next to the purchasing feature so error
 * reporting is available immediately after deployment as well.
 */
export function ensurePurchaseInspectionIssueSchema() {
  ensureSchemaPromise ??= (async () => {
    await ensurePurchasePaymentTrackingSchema()
    if (await hasPurchaseInspectionIssueSchema()) return

    await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('purchase-inspection-issue-schema'))`)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_inspection_issues (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        purchase_request_item_id uuid NOT NULL REFERENCES purchase_request_items(id) ON DELETE CASCADE,
        description text NOT NULL,
        created_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (length(btrim(description)) > 0)
      )
    `)
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS purchase_inspection_issues_user_item_created_idx
      ON purchase_inspection_issues(user_id, purchase_request_item_id, created_at DESC)
    `)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_inspection_issue_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        issue_id uuid NOT NULL REFERENCES purchase_inspection_issues(id) ON DELETE CASCADE,
        file_name text NOT NULL,
        content_type varchar(160) NOT NULL,
        file_size integer NOT NULL,
        file_data bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (file_size > 0)
      )
    `)
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS purchase_inspection_issue_attachments_issue_created_idx
      ON purchase_inspection_issue_attachments(issue_id, created_at)
    `)
    await tx.execute(sql`ALTER TABLE purchase_inspection_issues ENABLE ROW LEVEL SECURITY`)
    await tx.execute(sql`ALTER TABLE purchase_inspection_issue_attachments ENABLE ROW LEVEL SECURITY`)
    await tx.execute(sql`REVOKE ALL ON TABLE purchase_inspection_issues, purchase_inspection_issue_attachments FROM anon, authenticated`)
    })
  })().catch((error) => {
    ensureSchemaPromise = null
    throw error
  })

  return ensureSchemaPromise
}

export async function getPurchaseInspectionIssues(input: {
  userId: string
  purchaseRequestItemId: string
}): Promise<PurchaseInspectionIssue[]> {
  await ensurePurchaseInspectionIssueSchema()
  const issues = resultRows<IssueRow>(await db.execute(sql`
    SELECT
      issue.id::text AS id,
      issue.description,
      issue.created_at::text AS "createdAt",
      issue.created_by_user_id::text AS "createdByUserId"
    FROM purchase_inspection_issues issue
    WHERE issue.user_id = ${input.userId}::uuid
      AND issue.purchase_request_item_id = ${input.purchaseRequestItemId}::uuid
    ORDER BY issue.created_at ASC, issue.id ASC
  `))
  if (issues.length === 0) return []

  const attachments = resultRows<AttachmentRow>(await db.execute(sql`
    SELECT
      attachment.id::text AS id,
      attachment.issue_id::text AS "issueId",
      attachment.file_name AS "fileName",
      attachment.content_type AS "contentType",
      attachment.file_size AS "fileSize",
      attachment.created_at::text AS "createdAt"
    FROM purchase_inspection_issue_attachments attachment
    WHERE attachment.user_id = ${input.userId}::uuid
      AND attachment.issue_id IN (${sql.join(issues.map((issue) => sql`${issue.id}::uuid`), sql`, `)})
    ORDER BY attachment.created_at ASC, attachment.id ASC
  `))
  const attachmentsByIssue = new Map<string, PurchaseInspectionIssueAttachment[]>()
  for (const attachment of attachments) {
    const rows = attachmentsByIssue.get(attachment.issueId) ?? []
    rows.push({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      fileSize: Number(attachment.fileSize),
      createdAt: attachment.createdAt,
    })
    attachmentsByIssue.set(attachment.issueId, rows)
  }
  return issues.map((issue) => ({ ...issue, attachments: attachmentsByIssue.get(issue.id) ?? [] }))
}

export async function createPurchaseInspectionIssue(input: {
  userId: string
  actorId: string
  purchaseRequestItemId: string
  description: string
  attachments: Array<{ fileName: string; contentType: string; fileBuffer: ArrayBuffer }>
}) {
  const description = input.description.trim()
  if (!description) throw new Error('오류 설명을 입력해주세요.')
  if (description.length > 2_000) throw new Error('오류 설명은 2,000자 이하로 입력해주세요.')
  if (input.attachments.length > MAX_INSPECTION_ISSUE_ATTACHMENTS) {
    throw new Error(`사진은 최대 ${MAX_INSPECTION_ISSUE_ATTACHMENTS}장까지 첨부할 수 있습니다.`)
  }
  for (const attachment of input.attachments) {
    if (!INSPECTION_ISSUE_IMAGE_TYPES.has(attachment.contentType)) {
      throw new Error('사진은 JPG, PNG, WEBP, GIF만 첨부할 수 있습니다.')
    }
    if (attachment.fileBuffer.byteLength <= 0 || attachment.fileBuffer.byteLength > MAX_INSPECTION_ISSUE_ATTACHMENT_BYTES) {
      throw new Error('사진은 압축 후 700KB 이하만 첨부할 수 있습니다.')
    }
  }

  await ensurePurchaseInspectionIssueSchema()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const [current] = resultRows<{
      id: string
      status: string
      requestedQuantity: number
      actualPurchaseQuantity: number | null
      trackingNumber: string | null
      purchaseInspection: PurchaseInspection | null
    }>(await tx.execute(sql`
      SELECT
        id::text AS id,
        status::text AS status,
        requested_quantity AS "requestedQuantity",
        actual_purchase_quantity AS "actualPurchaseQuantity",
        tracking_number AS "trackingNumber",
        purchase_inspection AS "purchaseInspection"
      FROM purchase_request_items
      WHERE user_id = ${input.userId}::uuid
        AND id = ${input.purchaseRequestItemId}::uuid
      FOR UPDATE
    `))
    if (!current) return null
    if (!['purchase_completed', 'inspecting', 'china_arrived'].includes(current.status)) {
      throw new Error('구매완료·검수·중국창고도착 단계에서만 검수 오류를 등록할 수 있습니다.')
    }

    // An inspection record deliberately protects the item from the raw-data
    // replacement path. It must be created atomically with the issue so an
    // uploaded Ecount snapshot cannot delete a newly reported error.
    const previousInspection = current.purchaseInspection
      ?? createPurchaseInspection(current.actualPurchaseQuantity ?? current.requestedQuantity, current.trackingNumber)
    const inspection: PurchaseInspection = {
      ...previousInspection,
      version: 1,
      // Adding an issue does not change parcel/quantity data. Deliberately
      // keep the parcel revision stable so an inspector's local box draft can
      // still save; a real concurrent parcel edit continues to advance this
      // revision and is rejected by savePurchaseInspection.
      revision: Number.isInteger(previousInspection.revision) ? previousInspection.revision : 0,
      hasReportedIssue: true,
    }
    const [created] = resultRows<IssueRow>(await tx.execute(sql`
      INSERT INTO purchase_inspection_issues (
        user_id, purchase_request_item_id, description, created_by_user_id
      ) VALUES (
        ${input.userId}::uuid,
        ${input.purchaseRequestItemId}::uuid,
        ${description},
        ${input.actorId}::uuid
      )
      RETURNING
        id::text AS id,
        description,
        created_at::text AS "createdAt",
        created_by_user_id::text AS "createdByUserId"
    `))
    if (!created) throw new Error('검수 오류를 등록하지 못했습니다.')

    const attachments: PurchaseInspectionIssueAttachment[] = []
    for (const file of input.attachments) {
      const base64 = Buffer.from(file.fileBuffer).toString('base64')
      const [attachment] = resultRows<PurchaseInspectionIssueAttachment>(await tx.execute(sql`
        INSERT INTO purchase_inspection_issue_attachments (
          user_id, issue_id, file_name, content_type, file_size, file_data
        ) VALUES (
          ${input.userId}::uuid,
          ${created.id}::uuid,
          ${file.fileName.slice(0, 500)},
          ${file.contentType},
          ${file.fileBuffer.byteLength},
          decode(${base64}, 'base64')
        )
        RETURNING
          id::text AS id,
          file_name AS "fileName",
          content_type AS "contentType",
          file_size AS "fileSize",
          created_at::text AS "createdAt"
      `))
      if (attachment) attachments.push({ ...attachment, fileSize: Number(attachment.fileSize) })
    }

    await tx.execute(sql`
      UPDATE purchase_request_items
      SET
        status = ${current.status === 'purchase_completed' ? 'inspecting' : current.status}::purchase_request_status,
        purchase_inspection = ${JSON.stringify(inspection)}::jsonb,
        china_received_quantity = CASE
          WHEN ${current.status} = 'purchase_completed' THEN NULL
          ELSE china_received_quantity
        END,
        updated_at = now()
      WHERE user_id = ${input.userId}::uuid
        AND id = ${input.purchaseRequestItemId}::uuid
    `)

    return {
      inspection,
      issue: { ...created, attachments },
    }
  })
}

export async function getPurchaseInspectionIssueAttachment(input: {
  userId: string
  purchaseRequestItemId: string
  issueId: string
  attachmentId: string
}) {
  await ensurePurchaseInspectionIssueSchema()
  const [attachment] = resultRows<{
    fileName: string
    contentType: string
    fileDataBase64: string
  }>(await db.execute(sql`
    SELECT
      attachment.file_name AS "fileName",
      attachment.content_type AS "contentType",
      encode(attachment.file_data, 'base64') AS "fileDataBase64"
    FROM purchase_inspection_issue_attachments attachment
    INNER JOIN purchase_inspection_issues issue ON issue.id = attachment.issue_id
    WHERE attachment.id = ${input.attachmentId}::uuid
      AND attachment.issue_id = ${input.issueId}::uuid
      AND issue.purchase_request_item_id = ${input.purchaseRequestItemId}::uuid
      AND issue.user_id = ${input.userId}::uuid
      AND attachment.user_id = ${input.userId}::uuid
    LIMIT 1
  `))
  return attachment ?? null
}

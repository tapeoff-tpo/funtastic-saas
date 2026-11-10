import { createHash } from 'node:crypto'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'
import { detectWorksAssetType, readWorksAssetChunk } from '@/lib/new-products/works-assets'
import { getR2Object, putR2Object } from '@/lib/storage/r2'
import {
  INSPECTION_LABEL_FILE_LIMIT, INSPECTION_LABEL_FILE_TYPES,
  type InspectionLabelFile, type InspectionLabelKind,
} from './purchase-inspection-label-types'

type LabelStorage = InspectionLabelFile & { fileSize: number; objectKey: string | null; attachmentId?: string | null }

const missingTable = (error: unknown) => {
  const failure = error as { code?: string; cause?: { code?: string } }
  return failure?.code === '42P01' || failure?.cause?.code === '42P01'
}

export async function getInspectionLabelTarget(userId: string, id: string) {
  const [row] = await db.select({ sku: purchaseRequestItems.sku, status: purchaseRequestItems.status })
    .from(purchaseRequestItems)
    .where(and(eq(purchaseRequestItems.userId, userId), eq(purchaseRequestItems.id, id))).limit(1)
  return row
}

export async function listInspectionLabelFiles(userId: string, sku: string): Promise<LabelStorage[]> {
  const [uploads, matches] = await Promise.all([
    db.execute<LabelStorage>(sql`
      SELECT DISTINCT ON (kind) id, kind, 'upload' AS source, file_name AS "fileName",
        content_type AS "contentType", file_size AS "fileSize", object_key AS "objectKey"
      FROM purchase_inspection_label_files WHERE user_id = ${userId}::uuid AND sku = ${sku}
      ORDER BY kind, created_at DESC, id DESC
    `).catch((error: unknown) => { if (missingTable(error)) return []; throw error }),
    db.execute<{ id: string }>(sql`
      SELECT id FROM new_product_workflow_items
      WHERE user_id = ${userId}::uuid
        AND (sabangnet_code = ${sku} OR metadata -> 'optionDetails' @>
          jsonb_build_array(jsonb_build_object('sabangnetOptionCode', ${sku}::text)))
      LIMIT 2
    `).catch((error: unknown) => { if (missingTable(error)) return []; throw error }),
  ])
  if (matches.length !== 1) return [...uploads]

  const itemId = matches[0].id
  const [attachments, works] = await Promise.all([
    db.execute<LabelStorage>(sql`
      SELECT id, 'quality' AS kind, 'attachment' AS source, file_name AS "fileName",
        content_type AS "contentType", file_size AS "fileSize", object_key AS "objectKey"
      FROM new_product_workflow_attachments
      WHERE user_id = ${userId}::uuid AND item_id = ${itemId}::uuid
        AND kind = 'quality_pdf' AND content_type = 'application/pdf'
      ORDER BY created_at DESC, id
    `).catch((error: unknown) => { if (missingTable(error)) return []; throw error }),
    db.execute<LabelStorage & { fieldName: string }>(sql`
      SELECT id, 'works' AS source, field_name AS "fieldName", file_name AS "fileName",
        content_type AS "contentType", file_size AS "fileSize", object_key AS "objectKey", attachment_id AS "attachmentId"
      FROM new_product_works_assets
      WHERE user_id = ${userId}::uuid AND item_id = ${itemId}::uuid
        AND content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')
      ORDER BY created_at DESC, id
    `).catch((error: unknown) => { if (missingTable(error)) return []; throw error }),
  ])
  const linked = new Set(attachments.map((file) => file.id))
  return [...uploads, ...attachments, ...works.flatMap((file) => {
    if (file.attachmentId && linked.has(file.attachmentId)) return []
    const kind = worksInspectionLabelKind(file.fieldName, file.fileName, file.contentType)
    return kind ? [{ ...file, kind }] : []
  })]
}

export async function getUploadedInspectionLabelFile(userId: string, sku: string, id: string) {
  const [file] = await db.execute<LabelStorage>(sql`
    SELECT id, kind, 'upload' AS source, file_name AS "fileName", content_type AS "contentType",
      file_size AS "fileSize", object_key AS "objectKey"
    FROM purchase_inspection_label_files
    WHERE user_id = ${userId}::uuid AND sku = ${sku} AND id = ${id}::uuid
  `)
  return file
}

export function worksInspectionLabelKind(fieldName: string, fileName: string, contentType: string): InspectionLabelKind | null {
  if (!INSPECTION_LABEL_FILE_TYPES.includes(contentType) || contentType === 'application/pdf' && !/\.pdf$/i.test(fileName)) return null
  if (/바코드|条形码|條形碼|条码|條碼|barcode/i.test(fieldName)) return 'barcode'
  return /품질\s*표시|韩语标签|韓語標籤/.test(fieldName) ? 'quality' : null
}

export class InspectionLabelInputError extends Error {}

export async function uploadInspectionLabel(input: { userId: string; actorId: string; sku: string; kind: InspectionLabelKind; file: File }) {
  if (!input.file.size || input.file.size > INSPECTION_LABEL_FILE_LIMIT) throw new InspectionLabelInputError('PDF 또는 이미지 파일은 4MB 이하로 선택해주세요.')
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const contentType = detectWorksAssetType(bytes)
  if (!INSPECTION_LABEL_FILE_TYPES.includes(contentType)) throw new InspectionLabelInputError('PDF, JPG, PNG, WEBP, GIF 파일을 선택해주세요.')
  const id = crypto.randomUUID()
  const fileName = input.file.name.slice(0, 300)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const objectKey = `purchase-inspection-labels/${input.userId}/${hash}`
  await putR2Object(objectKey, bytes, contentType)
  await db.execute(sql`
    INSERT INTO purchase_inspection_label_files (id, user_id, sku, kind, file_name, content_type, file_size, object_key, uploaded_by)
    VALUES (${id}::uuid, ${input.userId}::uuid, ${input.sku}, ${input.kind}, ${fileName}, ${contentType}, ${bytes.length}, ${objectKey}, ${input.actorId}::uuid)
  `)
  return { id, kind: input.kind, source: 'upload', fileName, contentType } satisfies InspectionLabelFile
}

export async function readInspectionLabelBody(userId: string, file: LabelStorage, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  if (file.objectKey) return (await getR2Object(file.objectKey)).body
  const attachmentId = file.source === 'attachment' ? file.id : file.attachmentId ?? null
  if (attachmentId) {
    const [attachment] = await db.execute<{ objectKey: string | null }>(sql`
      SELECT object_key AS "objectKey" FROM new_product_workflow_attachments
      WHERE id = ${attachmentId}::uuid AND user_id = ${userId}::uuid
    `)
    if (attachment?.objectKey) return (await getR2Object(attachment.objectKey)).body
  }
  let offset = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal.aborted || offset >= file.fileSize) { controller.close(); return }
      try {
        const chunk = await readWorksAssetChunk(userId, file.id, offset, Math.min(file.fileSize - offset, 384 * 1024), attachmentId)
        if (!chunk.length) throw new Error('파일을 읽지 못했습니다.')
        offset += chunk.length
        if (!signal.aborted) controller.enqueue(new Uint8Array(chunk))
        else controller.close()
      } catch (error) { controller.error(error) }
    },
  })
}

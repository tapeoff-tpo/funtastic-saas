import JSZip from 'jszip'
import type { Readable } from 'node:stream'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

// Leave multipart overhead below Vercel's 4.5 MB request limit.
export const QUALITY_ARCHIVE_LIMIT = 4_300_000
const PDF_LIMIT = 4 * 1024 * 1024
export type WorksQualityFile = { sourceId: string; fileName: string; data: Buffer }

export async function readWorksQualityArchive(buffer: Buffer): Promise<WorksQualityFile[]> {
  if (!buffer.length || buffer.length > QUALITY_ARCHIVE_LIMIT) throw new Error('압축파일은 4.3MB 이하로 나눠주세요.')
  const archive = await JSZip.loadAsync(buffer)
  const entries = Object.values(archive.files).filter((entry) => !entry.dir)
  if (!entries.length || entries.length > 30) throw new Error('한 압축파일에는 PDF를 1~30개 넣어주세요.')
  const files: WorksQualityFile[] = []
  let total = 0
  for (const entry of entries) {
    const match = /^(\d{1,20})\/([^/\\]+\.pdf)$/i.exec(entry.name)
    if (!match || match[2].length > 500 || entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw new Error('원본 WORKS ID별 폴더에 PDF를 넣은 백업 파일을 선택해주세요.')
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      const stream = entry.nodeStream('nodebuffer') as Readable
      stream.on('data', (chunk) => {
        const bytes = Buffer.from(chunk)
        size += bytes.length; total += bytes.length
        if (size > PDF_LIMIT || total > 8 * 1024 * 1024) {
          stream.destroy(); reject(new Error('PDF 용량 제한을 초과했습니다.')); return
        }
        chunks.push(bytes)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    })
    if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('올바른 PDF 파일이 아닙니다.')
    files.push({ sourceId: match[1], fileName: match[2], data })
  }
  return files
}

export async function saveWorksQualityFiles(input: { userId: string; actorId: string; files: WorksQualityFile[] }) {
  const results: Array<{ sourceId: string; fileName: string; status: 'saved' | 'existing' | 'unmatched' }> = []
  await db.transaction(async (tx) => {
    for (const file of input.files) {
      const rows = await tx.execute(sql`SELECT id FROM new_product_workflow_items WHERE user_id = ${input.userId}::uuid AND daou_works_id = ${file.sourceId} FOR UPDATE`)
      const item = rows[0] as { id: string } | undefined
      if (!item) { results.push({ sourceId: file.sourceId, fileName: file.fileName, status: 'unmatched' }); continue }
      const data = file.data.toString('base64')
      const saved = await tx.execute(sql`
        INSERT INTO new_product_workflow_attachments (user_id, item_id, kind, file_name, content_type, file_size, file_data, uploaded_by_user_id)
        SELECT ${input.userId}::uuid, ${item.id}::uuid, 'quality_pdf', ${file.fileName}, 'application/pdf', ${file.data.length}, decode(${data}, 'base64'), ${input.actorId}::uuid
        WHERE NOT EXISTS (SELECT 1 FROM new_product_workflow_attachments WHERE user_id = ${input.userId}::uuid AND item_id = ${item.id}::uuid AND kind = 'quality_pdf' AND file_data = decode(${data}, 'base64'))
        RETURNING id
      `)
      results.push({ sourceId: file.sourceId, fileName: file.fileName, status: saved.length ? 'saved' : 'existing' })
    }
  })
  return results
}

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { putR2Object } from '@/lib/storage/r2'

export async function uploadWorkflowDetailPage(
  userId: string,
  itemId: string,
  file: File,
) {
  const origin = URL.parse(process.env.R2_PUBLIC_BASE_URL ?? '')
  if (
    origin?.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('Cloudflare 상세페이지 공개 주소 설정이 필요합니다.')
  }
  const [item] = await db.execute<{ id: string }>(sql`
    SELECT id FROM new_product_workflow_items WHERE id = ${itemId}::uuid AND user_id = ${userId}::uuid
  `)
  if (!item) throw new Error('연결할 상품을 찾을 수 없습니다.')

  const body = Buffer.from(await file.arrayBuffer())
  const isJpeg = body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  const isPng = body
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isWebp =
    body.toString('ascii', 0, 4) === 'RIFF' &&
    body.toString('ascii', 8, 12) === 'WEBP'
  const extension = isJpeg ? 'jpeg' : isPng ? 'png' : isWebp ? 'webp' : null
  if (!extension) throw new Error('JPEG, PNG 또는 WebP 이미지를 선택해주세요.')

  const hash = createHash('sha256').update(body).digest('hex')
  const key = `detail-pages/${itemId}/${hash}.${extension}`
  const url = `${origin.href.replace(/\/$/, '')}/${key}`
  await putR2Object(key, body, `image/${extension}`)
  await db.execute(sql`
    UPDATE new_product_workflow_items SET detail_page_url = ${url}, updated_at = now()
    WHERE id = ${itemId}::uuid AND user_id = ${userId}::uuid
  `)
  return url
}

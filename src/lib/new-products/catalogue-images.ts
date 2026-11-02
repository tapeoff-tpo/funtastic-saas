import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { resolvePurchasingProductImages } from '@/lib/purchasing/product-image-catalogue'
import { ensureNewProductWorkflowTables } from './workflow'

const rows = <T>(result: unknown): T[] => Array.isArray(result) ? result as T[] : ((result as { rows?: T[] }).rows ?? [])
const imageTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
const imageHosts = new Set(['pub-c3849cebd2dd4a1a881a36c783c3845c.r2.dev', 'funtasticb2b.com'])
const maxImageBytes = 4 * 1024 * 1024

export async function findSavedNewProductImages(userId: string, sku: string, productName: string) {
  await ensureNewProductWorkflowTables(userId)
  const matches = rows<{ id: string; exactSku: boolean; images: string[] }>(await db.execute(sql`
    SELECT item.id, (item.sabangnet_code = ${sku}) AS "exactSku", jsonb_agg(attachment.id::text ORDER BY attachment.created_at) AS images
    FROM new_product_workflow_items item
    JOIN new_product_workflow_attachments attachment ON attachment.item_id = item.id AND attachment.user_id = item.user_id AND attachment.kind = 'product_image'
    WHERE item.user_id = ${userId}::uuid AND (item.sabangnet_code = ${sku}
      OR lower(btrim(item.product_name)) = lower(btrim(${productName}))
      OR lower(btrim(item.registered_product_name)) = lower(btrim(${productName})))
    GROUP BY item.id ORDER BY "exactSku" DESC NULLS LAST LIMIT 3
  `))
  const exact = matches.filter((match) => match.exactSku)
  const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null
  return (selected?.images ?? []).map((id, sortOrder) => ({ url: `/api/purchasing/product-images/files/${id}`, sortOrder }))
}

export async function getSavedNewProductImage(userId: string, id: string) {
  const [image] = rows<{ contentType: string; fileData: string }>(await db.execute(sql`
    SELECT content_type AS "contentType", encode(file_data, 'base64') AS "fileData"
    FROM new_product_workflow_attachments
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND kind = 'product_image' LIMIT 1
  `))
  return image && imageTypes[image.contentType] ? image : null
}

export async function downloadCatalogueImage(address: string) {
  const url = new URL(address)
  if (url.protocol !== 'https:' || !imageHosts.has(url.hostname) || url.username || url.password) throw new Error('지원하지 않는 이미지 주소입니다.')
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
  const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
  if (!response.ok || !imageTypes[contentType] || Number(response.headers.get('content-length')) > maxImageBytes || !response.body) throw new Error('이미지 파일을 확인해주세요.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.length
      if (length > maxImageBytes) throw new Error('이미지는 4MB 이하만 저장할 수 있습니다.')
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel() }
  const buffer = Buffer.concat(chunks)
  const valid = contentType === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8
    : contentType === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === 'image/gif' ? /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())
        : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  if (!valid) throw new Error('올바른 이미지 파일이 아닙니다.')
  return { buffer, contentType, extension: imageTypes[contentType] }
}

/** Copies actual image bytes into the existing product-image attachment store.
 * Row locking + the final existence check preserve manual uploads and make retries safe. */
export async function syncNewProductCatalogueImages(input: { userId: string; actorId: string; after?: string; itemId?: string }) {
  await ensureNewProductWorkflowTables(input.userId)
  const candidates = rows<{ id: string; productName: string; registeredName: string | null; sku: string | null }>(await db.execute(sql`
    SELECT id, product_name AS "productName", registered_product_name AS "registeredName", sabangnet_code AS sku
    FROM new_product_workflow_items item WHERE item.user_id = ${input.userId}::uuid
      ${input.after ? sql`AND item.id > ${input.after}::uuid` : sql``}
      ${input.itemId ? sql`AND item.id = ${input.itemId}::uuid` : sql``}
      AND NOT EXISTS (SELECT 1 FROM new_product_workflow_attachments a WHERE a.item_id = item.id AND a.user_id = item.user_id AND a.kind = 'product_image')
    ORDER BY item.id LIMIT 21
  `))
  const batch = candidates.slice(0, 20)
  const results: Array<{ id: string; productName: string; status: 'saved' | 'existing' | 'unmatched' | 'failed'; images?: number }> = []
  for (let start = 0; start < batch.length; start += 5) {
    const completed = await Promise.all(batch.slice(start, start + 5).map(async (item) => {
      try {
        let match = await resolvePurchasingProductImages({ sku: item.sku ?? '', productName: item.registeredName || item.productName, localImages: null })
        if (!match.imageUrls.length && !match.ambiguous && item.registeredName && item.registeredName !== item.productName) match = await resolvePurchasingProductImages({ sku: item.sku ?? '', productName: item.productName, localImages: null })
        if (!match.imageUrls.length) return { id: item.id, productName: item.productName, status: 'unmatched' as const }
        const downloads = await Promise.allSettled(match.imageUrls.slice(0, 3).map(downloadCatalogueImage))
        // Keep one representative file per product; the catalogue remains the
        // source for its full gallery. Failed first images can use a later photo.
        const images = downloads.flatMap((download) => download.status === 'fulfilled' ? [download.value] : []).slice(0, 1)
        if (!images.length) throw new Error('저장할 이미지가 없습니다.')
        const saved = await db.transaction(async (tx) => {
          const [locked] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM new_product_workflow_items WHERE id = ${item.id}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE`))
          if (!locked) return false
          const existing = rows(await tx.execute(sql`SELECT id FROM new_product_workflow_attachments WHERE item_id = ${item.id}::uuid AND user_id = ${input.userId}::uuid AND kind = 'product_image' LIMIT 1`))
          if (existing.length) return false
          for (const [index, image] of images.entries()) await tx.execute(sql`
            INSERT INTO new_product_workflow_attachments (user_id, item_id, kind, file_name, content_type, file_size, file_data, uploaded_by_user_id)
            VALUES (${input.userId}::uuid, ${item.id}::uuid, 'product_image', ${`B2B-${index + 1}.${image.extension}`}, ${image.contentType}, ${image.buffer.length}, decode(${image.buffer.toString('base64')}, 'base64'), ${input.actorId}::uuid)
          `)
          await tx.execute(sql`UPDATE new_product_workflow_items SET updated_at = now() WHERE id = ${item.id}::uuid AND user_id = ${input.userId}::uuid`)
          return true
        })
        return { id: item.id, productName: item.productName, status: saved ? 'saved' as const : 'existing' as const, images: saved ? images.length : 0 }
      } catch { return { id: item.id, productName: item.productName, status: 'failed' as const } }
    }))
    results.push(...completed)
  }
  return { results, nextCursor: candidates.length > 20 ? batch.at(-1)!.id : null }
}

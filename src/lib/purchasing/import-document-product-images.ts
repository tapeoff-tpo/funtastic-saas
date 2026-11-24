import sharp from 'sharp'
import { findSavedNewProductImagesBatch } from '@/lib/new-products/catalogue-images'
import { getNewProductAttachment } from '@/lib/new-products/workflow'
import type { ImportDocumentProductImage } from './china-import-hs-sheets'

const attachmentPath = /^\/api\/purchasing\/product-images\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const contentTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Read one saved product-management image per SKU for the generated workbook. */
export async function getImportDocumentProductImages(input: {
  userId: string
  requestedByUserId: string
  items: Array<{ sku: string; productName: string }>
}): Promise<Map<string, ImportDocumentProductImage>> {
  const unique = new Map<string, { id: string; sku: string; productName: string }>()
  for (const item of input.items) {
    const sku = item.sku.trim()
    if (sku && !unique.has(sku)) unique.set(sku, { ...item, id: sku, sku })
  }
  const result = new Map<string, ImportDocumentProductImage>([...unique.keys()].map((sku) => [sku, { error: 'missing' }]))
  if (!unique.size) return result

  let images: Awaited<ReturnType<typeof findSavedNewProductImagesBatch>>
  try {
    images = await findSavedNewProductImagesBatch(input.userId, [...unique.values()])
  } catch (error) {
    const cause = error as { code?: string; cause?: { code?: string } }
    if (cause.code === '42P01' || cause.cause?.code === '42P01') return result
    throw error
  }

  const items = [...unique.values()]
  for (let start = 0; start < items.length; start += 5) {
    await Promise.all(items.slice(start, start + 5).map(async (item) => {
      const attachmentIds = [...new Set(images[item.id]?.imageUrls
        .map((address) => attachmentPath.exec(address)?.[1])
        .filter((id): id is string => Boolean(id)) ?? [])]
      let unavailable = false
      for (const attachmentId of attachmentIds) {
        try {
          const attachment = await getNewProductAttachment({ userId: input.userId, requestedByUserId: input.requestedByUserId, attachmentId })
          if (!attachment) continue
          if (!attachment.fileDataBase64 || !contentTypes.has(attachment.contentType)) { unavailable = true; continue }
          const { data, info } = await sharp(Buffer.from(attachment.fileDataBase64, 'base64'))
            .rotate().resize({ width: 160, height: 120, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
          result.set(item.sku, { buffer: data, width: info.width, height: info.height })
          return
        } catch { unavailable = true }
      }
      if (unavailable) result.set(item.sku, { error: 'unavailable' })
    }))
  }
  return result
}

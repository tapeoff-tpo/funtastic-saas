import type { ProductImageResult } from './product-image-catalogue'

export type ProductImageReference = { purchaseItemId: string; shipmentItemId?: never } | { shipmentItemId: string; purchaseItemId?: never }

/** Owned by a mounted button, never shared across accounts or persisted in storage. */
export function createProductImageLoader(reference: ProductImageReference) {
  const entries = new Map<boolean, { data?: ProductImageResult; expires: number; pending?: Promise<ProductImageResult> }>()
  const controllers = new Set<AbortController>()
  const warmed = new Map<string, HTMLImageElement>()
  function peek(catalogueOnly = false) {
    const entry = entries.get(catalogueOnly)
    return entry && entry.expires > Date.now() ? entry.data ?? null : null
  }
  async function load(catalogueOnly = false, fresh = false): Promise<ProductImageResult> {
    const existing = entries.get(catalogueOnly)
    if (!fresh && existing?.pending) return existing.pending
    const cached = fresh ? null : peek(catalogueOnly)
    if (cached) return cached
    const controller = new AbortController()
    controllers.add(controller)
    const query = new URLSearchParams(reference.purchaseItemId ? { purchaseItemId: reference.purchaseItemId } : { shipmentItemId: reference.shipmentItemId! })
    if (catalogueOnly) query.set('catalogue', '1')
    const entry: NonNullable<typeof existing> = { expires: 0 }
    entries.set(catalogueOnly, entry)
    entry.pending = (async () => {
      try {
        const response = await fetch(`/api/purchasing/product-images?${query}`, { cache: fresh ? 'reload' : 'default', signal: controller.signal })
        const data = await response.json() as ProductImageResult & { error?: string }
        if (!response.ok) throw new Error(data.error || '상품 이미지를 불러오지 못했습니다.')
        entry.data = data
        entry.expires = Date.now() + (data.imageUrls.length ? 60_000 : 15_000)
        // Reopening a dialog must not retry saved URLs that have already failed.
        if (catalogueOnly) entries.set(false, entry)
        const first = data.imageUrls[0]
        if (first && !warmed.has(first)) {
          const image = new Image()
          warmed.set(first, image)
          image.referrerPolicy = 'no-referrer'
          image.fetchPriority = 'high'
          image.onerror = () => warmed.delete(first)
          image.src = first
        }
        return data
      } finally { entry.pending = undefined; controllers.delete(controller) }
    })()
    return entry.pending
  }
  return { peek, load, dispose() { controllers.forEach((controller) => controller.abort()); entries.clear(); warmed.clear() } }
}

export type ProductImageLoader = ReturnType<typeof createProductImageLoader>

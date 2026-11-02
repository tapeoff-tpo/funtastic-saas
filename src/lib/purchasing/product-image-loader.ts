import type { ProductImageResult } from './product-image-catalogue'

export type ProductImageReference = { purchaseItemId: string; shipmentItemId?: never } | { shipmentItemId: string; purchaseItemId?: never }

/** Owned by a mounted button, never shared across accounts or persisted in storage. */
export function createProductImageLoader(reference: ProductImageReference, initialData?: ProductImageResult) {
  const entries = new Map<boolean, { data?: ProductImageResult; expires: number; pending?: Promise<ProductImageResult> }>()
  const controllers = new Set<AbortController>()
  const warmed = new Map<string, HTMLImageElement>()
  if (initialData?.imageUrls.length) entries.set(false, { data: initialData, expires: Date.now() + 300_000 })
  function warmFirst(data: ProductImageResult, priority: 'high' | 'low') {
    const first = data.imageUrls[0]
    if (!first) return
    const existing = warmed.get(first)
    if (existing) { if (priority === 'high') existing.fetchPriority = 'high'; return }
    const image = new Image()
    warmed.set(first, image)
    image.referrerPolicy = 'no-referrer'
    image.fetchPriority = priority
    image.onerror = () => warmed.delete(first)
    image.src = first
  }
  function peek(catalogueOnly = false) {
    const entry = entries.get(catalogueOnly)
    return entry && entry.expires > Date.now() ? entry.data ?? null : null
  }
  async function load(catalogueOnly = false, fresh = false): Promise<ProductImageResult> {
    const existing = entries.get(catalogueOnly)
    if (!fresh && existing?.pending) return existing.pending
    const cached = fresh ? null : peek(catalogueOnly)
    if (cached) { warmFirst(cached, 'high'); return cached }
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
        warmFirst(data, 'high')
        return data
      } finally { entry.pending = undefined; controllers.delete(controller) }
    })()
    return entry.pending
  }
  return {
    peek, load,
    preload() { const data = peek(); if (data) warmFirst(data, 'low') },
    dispose() {
      controllers.forEach((controller) => controller.abort())
      // React may replay effects; retain completed, component-owned data in that
      // case. The whole loader becomes unreachable when the button is unmounted.
      for (const [key, entry] of entries) { if (entry.pending) entries.delete(key) }
      warmed.clear()
    },
  }
}

export type ProductImageLoader = ReturnType<typeof createProductImageLoader>

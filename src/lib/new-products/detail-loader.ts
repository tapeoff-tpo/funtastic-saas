import type { NewProductItem } from './workflow'

/** Short lived, owned by the board; edits/deletes invalidate it explicitly. */
export function createNewProductDetailLoader() {
  const entries = new Map<string, { value?: NewProductItem; expires: number; pending?: Promise<NewProductItem>; controller?: AbortController }>()
  const warmed = new Map<string, HTMLImageElement>()
  function warm(url: string) {
    if (warmed.has(url)) return
    if (warmed.size >= 30) warmed.delete(warmed.keys().next().value!)
    const image = new Image()
    image.fetchPriority = 'low'
    image.onerror = () => warmed.delete(url)
    warmed.set(url, image)
    image.src = url
  }
  async function load(id: string) {
    const existing = entries.get(id)
    if (existing?.pending) return existing.pending
    if (existing?.value && existing.expires > Date.now()) return existing.value
    if (entries.size >= 12) {
      const oldest = [...entries].find(([, entry]) => !entry.pending)
      if (oldest) entries.delete(oldest[0])
    }
    const entry: NonNullable<typeof existing> = { expires: 0, controller: new AbortController() }
    entries.set(id, entry)
    entry.pending = (async () => {
      try {
        const response = await fetch(`/api/new-products/items/${id}`, { cache: 'no-store', signal: entry.controller!.signal })
        const body = await response.json() as { item?: NewProductItem; error?: string }
        if (!response.ok || !body.item) throw new Error(body.error || '상품 상세를 불러오지 못했습니다.')
        entry.value = body.item
        entry.expires = Date.now() + 15_000
        body.item.attachments.filter((attachment) => attachment.contentType.startsWith('image/')).slice(0, 3)
          .forEach((attachment) => warm(`/api/new-products/attachments/${attachment.id}`))
        return body.item
      } catch (error) { if (entries.get(id) === entry) entries.delete(id); throw error }
      finally { entry.pending = undefined }
    })()
    return entry.pending
  }
  return { load, warm,
    peek(id: string) { const entry = entries.get(id); return entry && entry.expires > Date.now() ? entry.value ?? null : null },
    clear() { entries.forEach((entry) => entry.controller?.abort()); entries.clear(); warmed.clear() },
  }
}

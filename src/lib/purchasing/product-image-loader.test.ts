import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProductImageLoader } from './product-image-loader'

const result = { sku: 'SKU-1', productName: '상품', source: 'product-management' as const, imageUrls: ['/saved.jpg'] }
const response = () => new Response(JSON.stringify(result))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('intent-based product image loading', () => {
  it('opens server-prepared photos without a metadata request, but lets explicit retry refresh them', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const loader = createProductImageLoader({ purchaseItemId: 'purchase' }, result)
    expect(loader.peek()).toEqual(result)
    loader.preload()
    expect(await loader.load()).toEqual(result)
    expect(fetcher).not.toHaveBeenCalled()
    await loader.load(false, true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('shares an in-flight preload with a click and reuses completed results until expiry', async () => {
    vi.useFakeTimers()
    let complete!: (response: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve })).mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const loader = createProductImageLoader({ purchaseItemId: 'purchase' })
    const preload = loader.load()
    const click = loader.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    complete(response())
    expect(await preload).toEqual(await click)
    expect(loader.peek()).toEqual(result)
    await loader.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_001)
    expect(loader.peek()).toBeNull()
    await loader.load()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not cache errors, supports forced retry, and keeps catalogue fallback on reopening', async () => {
    const fallback = { ...result, source: 'funtasticb2b', imageUrls: ['https://example.com/good.jpg'] }
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'offline' }), { status: 502 }))
      .mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const loader = createProductImageLoader({ shipmentItemId: 'shipment' })
    await expect(loader.load()).rejects.toThrow('offline')
    expect(loader.peek()).toBeNull()
    await loader.load()
    await loader.load(false, true)
    expect(fetcher.mock.calls[2][1].cache).toBe('reload')
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(fallback)))
    await loader.load(true)
    expect(fetcher.mock.calls[3][0]).toContain('shipmentItemId=shipment&catalogue=1')
    expect(loader.peek()).toEqual(fallback)
    expect(await loader.load()).toEqual(fallback)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('cancels speculative requests when leaving the screen and does not share account/session memory', async () => {
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => { signal = options.signal; return new Promise(() => {}) }))
    const loader = createProductImageLoader({ purchaseItemId: 'purchase' })
    void loader.load()
    loader.dispose()
    expect(signal.aborted).toBe(true)
    expect(createProductImageLoader({ purchaseItemId: 'purchase' }).peek()).toBeNull()
  })
})

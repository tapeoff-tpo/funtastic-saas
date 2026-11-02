import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewProductDetailLoader } from './detail-loader'
const item = { id: 'one', productName: '컵', attachments: [{ id: 'photo', contentType: 'image/jpeg' }, { id: 'quality', contentType: 'application/pdf' }] }
const response = () => new Response(JSON.stringify({ item }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('product-management detail preparation', () => {
  it('shares hover and click, warms image files, and expires editable data quickly', async () => {
    vi.useFakeTimers()
    const images: string[] = []
    vi.stubGlobal('Image', class { set src(url: string) { images.push(url) } })
    let complete!: (response: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve })).mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const loader = createNewProductDetailLoader()
    const hover = loader.load('one')
    const click = loader.load('one')
    expect(fetcher).toHaveBeenCalledTimes(1)
    complete(response())
    expect(await hover).toEqual(await click)
    expect(images).toEqual(['/api/new-products/attachments/photo'])
    expect(loader.peek('one')).toEqual(item)
    await loader.load('one')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(loader.peek('one')).toBeNull()
    await loader.load('one')
    expect(fetcher).toHaveBeenCalledTimes(2)
    loader.clear()
    expect(loader.peek('one')).toBeNull()
    await loader.load('one')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('does not retain failed detail requests and aborts requests on invalidation', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const loader = createNewProductDetailLoader()
    await expect(loader.load('one')).rejects.toThrow('offline')
    expect(loader.peek('one')).toBeNull()
    await loader.load('one')
    expect(fetcher).toHaveBeenCalledTimes(2)
    let signal!: AbortSignal
    fetcher.mockImplementation((_url, options) => { signal = options.signal; return new Promise(() => {}) })
    void loader.load('two')
    loader.clear()
    expect(signal.aborted).toBe(true)
  })
})

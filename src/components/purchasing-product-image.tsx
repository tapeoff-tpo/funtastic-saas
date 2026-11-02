'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { createProductImageLoader, type ProductImageLoader, type ProductImageReference } from '@/lib/purchasing/product-image-loader'

export function PurchasingProductImageButton({ productName, ...reference }: ProductImageReference & { productName: string }) {
  const [open, setOpen] = useState(false)
  const { purchaseItemId, shipmentItemId } = reference
  const loader = useMemo(() => createProductImageLoader(purchaseItemId ? { purchaseItemId } : { shipmentItemId: shipmentItemId! }), [purchaseItemId, shipmentItemId])
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cancelHover() { if (hoverTimer.current) clearTimeout(hoverTimer.current) }
  function warm() { void loader.load().catch(() => { /* A speculative failure is retried on click. */ }) }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); loader.dispose() }, [loader])
  return <><button type="button" title="상품 이미지 보기" className="max-w-full text-left font-medium text-blue-700 underline-offset-2 hover:underline"
    onPointerEnter={() => { cancelHover(); hoverTimer.current = setTimeout(warm, 100) }} onPointerLeave={cancelHover}
    onFocus={warm} onPointerDown={warm} onClick={() => { cancelHover(); setOpen(true) }}><span data-no-translate>{productName}</span></button>
    {open && <ProductImageDialog key={purchaseItemId ?? shipmentItemId} loader={loader} productName={productName} onClose={() => setOpen(false)} />}</>
}

function ProductImageDialog({ loader, productName, onClose }: { loader: ProductImageLoader; productName: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [data, setData] = useState<ProductImageResult | null>(() => loader.peek())
  const [error, setError] = useState('')
  const [failedImages, setFailedImages] = useState<string[]>([])
  const failed = useRef(new Set<string>())
  const [attempt, setAttempt] = useState(0)
  const [catalogueOnly, setCatalogueOnly] = useState(false)
  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const body = await loader.load(catalogueOnly, attempt > 0)
        if (active) setData(body)
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '상품 이미지를 불러오지 못했습니다.') }
    })()
    return () => { active = false }
  }, [loader, attempt, catalogueOnly])
  const images = data?.imageUrls.filter((url) => !failedImages.includes(url)) ?? []
  const failedAll = !!data?.imageUrls.length && !images.length
  function reset() { setData(null); setError(''); setFailedImages([]); failed.current.clear() }
  function imageFailed(url: string) {
    failed.current.add(url)
    setFailedImages([...failed.current])
    if ((data?.source === 'item-master' || data?.source === 'product-management') && failed.current.size >= data.imageUrls.length && !catalogueOnly) { reset(); setCatalogueOnly(true) }
  }
  return <dialog ref={ref} data-purchasing-translate aria-labelledby={titleId} onClose={(event) => { event.stopPropagation(); onClose() }} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); ref.current?.close() }} className="fixed inset-0 m-auto max-h-[92dvh] w-[min(64rem,96vw)] overflow-y-auto rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <div className="sticky top-0 z-10 border-b bg-background p-4"><div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-lg font-semibold">상품 이미지</h2><button type="button" onClick={() => ref.current?.close()} className="h-9 rounded-md border px-3 text-sm">닫기</button></div><p className="mt-2 text-sm" data-no-translate>{data?.sku ? `${data.sku} · ` : ''}{productName}</p></div>
    <div className="space-y-3 p-4">
      {error || failedAll ? <div role="alert" className="text-sm text-red-700">{error || '이미지를 표시하지 못했습니다.'}<button type="button" onClick={() => { reset(); setAttempt((value) => value + 1) }} className="ml-3 rounded-md border px-3 py-1 text-foreground">다시 불러오기</button></div> : !data ? <p>불러오는 중…</p> : null}
      {data?.source === 'funtasticb2b' && <p className="text-xs text-muted-foreground">Funtastic B2B · 상품 공통 이미지{data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-3 text-blue-700 underline">원본 상품 보기</a>}</p>}
      {data && !data.imageUrls.length ? <p className="text-sm text-muted-foreground">{data.ambiguous ? '같은 이름의 상품이 여러 개여서 이미지를 자동 연결하지 않았습니다.' : '등록된 상품 이미지가 없습니다.'}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{images.map((url, index) => <div key={url} className="rounded-lg border p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={productName} data-no-translate referrerPolicy="no-referrer" fetchPriority={index === 0 ? 'high' : 'auto'} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" onError={() => imageFailed(url)} className="max-h-[65dvh] w-full object-contain" />
      </div>)}</div>
    </div>
  </dialog>
}

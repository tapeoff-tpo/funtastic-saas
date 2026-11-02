'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'

type Reference = { purchaseItemId: string; shipmentItemId?: never } | { shipmentItemId: string; purchaseItemId?: never }

export function PurchasingProductImageButton({ productName, ...reference }: Reference & { productName: string }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" title="상품 이미지 보기" className="max-w-full text-left font-medium text-blue-700 underline-offset-2 hover:underline" onClick={() => setOpen(true)}><span data-no-translate>{productName}</span></button>
    {open && <ProductImageDialog key={reference.purchaseItemId ?? reference.shipmentItemId} reference={reference} productName={productName} onClose={() => setOpen(false)} />}</>
}

function ProductImageDialog({ reference, productName, onClose }: { reference: Reference; productName: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [data, setData] = useState<ProductImageResult | null>(null)
  const [error, setError] = useState('')
  const [failedImages, setFailedImages] = useState<string[]>([])
  const failed = useRef(new Set<string>())
  const [attempt, setAttempt] = useState(0)
  const [catalogueOnly, setCatalogueOnly] = useState(false)
  const { purchaseItemId, shipmentItemId } = reference
  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams(purchaseItemId ? { purchaseItemId } : { shipmentItemId: shipmentItemId! })
    if (catalogueOnly) query.set('catalogue', '1')
    void (async () => {
      try {
        const response = await fetch(`/api/purchasing/product-images?${query}`, { cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || '상품 이미지를 불러오지 못했습니다.')
        if (!controller.signal.aborted) setData(body)
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상품 이미지를 불러오지 못했습니다.') }
    })()
    return () => controller.abort()
  }, [purchaseItemId, shipmentItemId, attempt, catalogueOnly])
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
      <div className="grid gap-4 sm:grid-cols-2">{images.map((url) => <div key={url} className="rounded-lg border p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={productName} data-no-translate referrerPolicy="no-referrer" onError={() => imageFailed(url)} className="max-h-[65dvh] w-full object-contain" />
      </div>)}</div>
    </div>
  </dialog>
}

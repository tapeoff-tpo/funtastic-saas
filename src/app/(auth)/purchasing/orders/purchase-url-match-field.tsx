'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { canonicalize1688OfferUrl, recordValue } from '@/lib/purchasing/purchase-url-values'

type Candidate = {
  url: string
  label: string
}

type Props = {
  id: string
  orderNumber: string | null
  productName: string
  rawData: Record<string, unknown>
}

export function PurchaseUrlMatchField({ id, orderNumber, productName, rawData }: Props) {
  const lookup = recordValue(rawData.purchaseUrlLookup)
  const normalizedOrderNumber = orderNumber?.trim() ?? ''
  if (!/^\d{10,40}$/.test(normalizedOrderNumber) || lookup.orderNumber !== normalizedOrderNumber) return null

  const candidatesByUrl = new Map<string, string[]>()
  for (const value of Array.isArray(lookup.links) ? lookup.links : []) {
    const candidate = recordValue(value)
    const url = canonicalize1688OfferUrl(typeof candidate.url === 'string' ? candidate.url : null)
    if (!url) continue
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const option = typeof candidate.optionName === 'string' ? candidate.optionName.trim() : ''
    const code = typeof candidate.productCode === 'string' ? candidate.productCode.trim() : ''
    const label = [title || code || '상품', option].filter(Boolean).join(' · ')
    const labels = candidatesByUrl.get(url) ?? []
    if (!labels.includes(label)) labels.push(label)
    candidatesByUrl.set(url, labels)
  }
  const candidates = [...candidatesByUrl].map(([url, labels]) => ({
    url,
    label: `${labels.join(' / ')} · ${url.match(/\/offer\/(\d+)\.html/)?.[1] ?? url}`,
  }))
  if (!candidates.length) return null

  const resolvedUrl = canonicalize1688OfferUrl(typeof lookup.resolvedUrl === 'string' ? lookup.resolvedUrl : null)
  return <PurchaseUrlMatchEditor key={`${id}:${orderNumber}:${resolvedUrl ?? ''}`} id={id}
    orderNumber={normalizedOrderNumber} productName={productName} candidates={candidates} resolvedUrl={resolvedUrl} />
}

function PurchaseUrlMatchEditor({ id, orderNumber, productName, candidates, resolvedUrl }: {
  id: string
  orderNumber: string
  productName: string
  candidates: Candidate[]
  resolvedUrl: string | null
}) {
  const router = useRouter()
  const [savedUrl, setSavedUrl] = useState(resolvedUrl)
  const [selectedUrl, setSelectedUrl] = useState(resolvedUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(url: string) {
    if (!url || saving) return
    setSelectedUrl(url)
    setError(null)
    if (url === savedUrl) return
    setSaving(true)
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/purchase-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, url, expectedUrl: savedUrl }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '상품 링크를 저장하지 못했습니다.')
      setSavedUrl(url)
      if (body.syncWarning) toast.warning(body.syncWarning)
      else toast.success('상품 링크를 연결했습니다.')
      router.refresh()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '상품 링크를 저장하지 못했습니다.'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto mt-1.5 flex w-[220px] max-w-full flex-col gap-1 text-left text-xs">
      <div className="flex items-center justify-between gap-2">
        {saving ? <span className="inline-flex items-center gap-1 text-muted-foreground"><LoaderCircle className="size-3 animate-spin" />연결 중</span>
          : savedUrl ? <span className="font-medium text-emerald-700">상품 링크 연결됨</span>
            : <span className="font-medium text-amber-700">상품 링크 확인 필요</span>}
        {selectedUrl ? <a href={selectedUrl} target="_blank" rel="noreferrer" title="선택한 상품 링크 열기"
          aria-label={`선택한 상품 링크 열기 · ${productName}`} className="inline-flex shrink-0 items-center gap-0.5 text-blue-700 hover:underline">열기<ExternalLink className="size-3" /></a> : null}
      </div>
      <select aria-label={`상품 링크 선택 · ${productName}`} value={selectedUrl} disabled={saving}
        onChange={event => void save(event.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs disabled:opacity-60">
        <option value="" disabled>상품 링크 선택</option>
        {savedUrl && !candidates.some(candidate => candidate.url === savedUrl)
          ? <option value={savedUrl}>기존에 연결한 링크</option> : null}
        {candidates.map(candidate => <option key={candidate.url} value={candidate.url}>{candidate.label}</option>)}
      </select>
      {error ? <div className="space-y-1"><p role="alert" className="whitespace-normal text-red-700">{error}</p>
        <button type="button" onClick={() => void save(selectedUrl)} disabled={saving}
          className="rounded border px-2 py-1 font-medium disabled:opacity-60">다시 저장</button>
      </div> : null}
    </div>
  )
}

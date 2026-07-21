'use client'

import { useRef, useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type EcountRawSyncPreview = {
  activeRequests: { rows: number; quantity: number }
  chinaInventory: { rows: number; quantity: number }
  outboundPending: { rows: number; quantity: number }
  validation: {
    activeRequestsMatchedToPlan: number
    activeRequestsMatchedToPurchase: number
    outboundRowsWithSupplierOrder: number
    outboundRowsMatchedToPurchase: number
    outboundRowsWithoutReliableSupplierOrder: number
  }
  warnings: string[]
}

type EcountRawSyncResponse = {
  preview: EcountRawSyncPreview
  current: {
    purchaseRows: number
    chinaRows: number
    chinaQuantity: number
  }
  result?: {
    replacedPurchaseRows: number
    createdPendingRequestRows: number
    createdOutboundRows: number
    syncedChinaInventoryRows: number
    chinaInventoryQuantity: number
  }
  error?: string
}

export function PurchaseEcountRawSyncDialog() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [domesticInventoryReflectedThrough, setDomesticInventoryReflectedThrough] = useState('2026-07-13')
  const [preview, setPreview] = useState<EcountRawSyncResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function createForm(intent: 'preview' | 'apply') {
    const files = Array.from(inputRef.current?.files ?? [])
    if (files.length !== 5) {
      setError('발주 요청 현황, 발주 계획 현황, 구매 현황, 중국재고, 중국 출고 파일 5개를 모두 선택해주세요.')
      return null
    }
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(domesticInventoryReflectedThrough)) {
      setError('국내재고 반영 기준일을 YYYY-MM-DD 형식으로 입력해주세요.')
      return null
    }

    const form = new FormData()
    form.set('intent', intent)
    form.set('domesticInventoryReflectedThrough', domesticInventoryReflectedThrough)
    if (intent === 'apply') form.set('confirm', 'replace')
    for (const file of files) form.append('files', file)
    return form
  }

  function requestPreview() {
    const form = createForm('preview')
    if (!form) return
    setError(null)
    setPreview(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/purchasing/raw-sync', { method: 'POST', body: form })
        const body = await response.json().catch(() => ({})) as EcountRawSyncResponse
        if (!response.ok || !body.preview) {
          setError(body.error ?? 'Ecount 원본 미리보기를 만들지 못했습니다.')
          return
        }
        setPreview(body)
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Ecount 원본 미리보기를 만들지 못했습니다.')
      }
    })
  }

  function applySnapshot() {
    if (!preview) return
    const confirmed = window.confirm(
      `기존 Ecount 동기화 발주 ${preview.current.purchaseRows.toLocaleString('ko-KR')}건과 중국재고 ${preview.current.chinaRows.toLocaleString('ko-KR')}종을 새 원본으로 교체합니다. 발주검토 자동추천은 유지됩니다. 진행할까요?`,
    )
    if (!confirmed) return

    const form = createForm('apply')
    if (!form) return
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/purchasing/raw-sync', { method: 'POST', body: form })
        const body = await response.json().catch(() => ({})) as EcountRawSyncResponse
        if (!response.ok || !body.result) {
          setError(body.error ?? 'Ecount 원본 동기화에 실패했습니다.')
          return
        }
        toast.success(
          `발주요청 ${body.result.createdPendingRequestRows.toLocaleString('ko-KR')}건 · 입고예정 ${body.result.createdOutboundRows.toLocaleString('ko-KR')}건 · 중국재고 ${body.result.chinaInventoryQuantity.toLocaleString('ko-KR')}개 반영`,
        )
        if (inputRef.current) inputRef.current.value = ''
        setPreview(null)
        setOpen(false)
        router.refresh()
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Ecount 원본 동기화에 실패했습니다.')
      }
    })
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setError(null)
      }}
    >
      <Dialog.Trigger
        render={(props) => (
          <Button {...props} type="button" size="sm" variant="outline">
            <Upload />
            Ecount 원본 동기화
          </Button>
        )}
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(780px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Ecount 발주 원본 동기화</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            헤더가 있는 2행부터 읽어 진행 중 발주요청, 중국 실재고, 국내 입고예정만 갱신합니다.
          </Dialog.Description>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="ecount-raw-sync-files">원본 파일 5개</Label>
              <Input
                ref={inputRef}
                id="ecount-raw-sync-files"
                type="file"
                accept=".xlsx"
                multiple
                onChange={() => setPreview(null)}
                className="cursor-pointer"
              />
              <p className="text-xs text-muted-foreground">
                발주 요청 현황 · 발주 계획 현황 · 구매 현황 · 중국재고 · 중국 출고
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="domestic-inventory-reflected-through">국내재고 반영 기준일</Label>
              <Input
                id="domestic-inventory-reflected-through"
                type="date"
                value={domesticInventoryReflectedThrough}
                onChange={(event) => {
                  setDomesticInventoryReflectedThrough(event.target.value)
                  setPreview(null)
                }}
              />
              <p className="text-xs text-muted-foreground">이 날짜까지의 중국출고는 현재재고에 이미 반영된 것으로 제외합니다.</p>
            </div>
          </div>

          {preview ? (
            <section className="mt-4 space-y-3 rounded-md border bg-muted/20 p-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-3">
                <SyncMetric label="진행 발주요청" rows={preview.preview.activeRequests.rows} quantity={preview.preview.activeRequests.quantity} />
                <SyncMetric label="중국 실재고" rows={preview.preview.chinaInventory.rows} quantity={preview.preview.chinaInventory.quantity} />
                <SyncMetric label="국내 입고예정" rows={preview.preview.outboundPending.rows} quantity={preview.preview.outboundPending.quantity} />
              </div>
              <div className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <span>발주계획 대조: {preview.preview.validation.activeRequestsMatchedToPlan.toLocaleString('ko-KR')}건</span>
                <span>구매현황 대조: {preview.preview.validation.activeRequestsMatchedToPurchase.toLocaleString('ko-KR')}건</span>
                <span>주문서번호 출고 대조: {preview.preview.validation.outboundRowsMatchedToPurchase.toLocaleString('ko-KR')} / {preview.preview.validation.outboundRowsWithSupplierOrder.toLocaleString('ko-KR')}건</span>
                <span>보조키 출고: {preview.preview.validation.outboundRowsWithoutReliableSupplierOrder.toLocaleString('ko-KR')}건</span>
              </div>
              <p className="text-xs text-amber-800">
                적용 시 기존 Ecount 동기화 발주 {preview.current.purchaseRows.toLocaleString('ko-KR')}건과 중국재고 {preview.current.chinaRows.toLocaleString('ko-KR')}종 · {preview.current.chinaQuantity.toLocaleString('ko-KR')}개가 이 스냅샷으로 교체됩니다.
              </p>
              {preview.preview.warnings.length > 0 ? (
                <ul className="space-y-1 text-xs text-amber-800">
                  {preview.preview.warnings.map((warning) => <li key={warning}>- {warning}</li>)}
                </ul>
              ) : null}
            </section>
          ) : null}

          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Dialog.Close
              render={(props) => <Button {...props} type="button" variant="outline" disabled={isPending}>취소</Button>}
            />
            <Button type="button" variant="outline" onClick={requestPreview} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : <Check />}
              원본 확인
            </Button>
            <Button type="button" onClick={applySnapshot} disabled={isPending || !preview}>
              {isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              원본으로 교체
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SyncMetric({ label, rows, quantity }: { label: string; rows: number; quantity: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">
        {rows.toLocaleString('ko-KR')}건 · {quantity.toLocaleString('ko-KR')}개
      </div>
    </div>
  )
}

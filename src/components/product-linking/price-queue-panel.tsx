'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { PriceQueueRow } from '@/lib/product-linking/price-queue'
import {
  loadPriceQueueAction,
  saveQueuePricesAction,
} from './price-queue-actions'
import { ProductLinkPanel } from './product-link-panel'
export function PriceQueuePanel() {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<PriceQueueRow[]>([]),
    [filter, setFilter] = useState<'missing' | 'excluded' | 'all'>('missing'),
    [search, setSearch] = useState(''),
    [pending, start] = useTransition()
  const router = useRouter()
  function load(f = filter) {
    start(async () => {
      const r = await loadPriceQueueAction(f, search)
      if (r.success) setRows(r.rows)
      else toast.error(r.error)
    })
  }
  return (
    <>
      <button
        type="button"
        className="rounded border px-2 py-1.5 text-xs"
        onClick={() => {
          setOpen(!open)
          if (!open) load()
        }}
      >
        판매가 미입력·입력 제외
      </button>
      {open && (
        <section
          className="fixed inset-4 z-50 overflow-auto rounded-lg border bg-background p-4 shadow-xl sm:inset-x-[8%] sm:inset-y-[8%]"
          role="dialog"
          aria-label="판매가 입력 작업"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              판매가 입력 작업 · 실제 원가·품목 기준
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="판매가 작업 닫기"
            >
              ×
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(['missing', 'excluded', 'all'] as const).map((f) => (
              <button
                key={f}
                className={`rounded border px-2 py-1 text-xs ${filter === f ? 'bg-primary text-primary-foreground' : ''}`}
                onClick={() => {
                  setFilter(f)
                  load(f)
                }}
              >
                {
                  {
                    missing: '판매가 미입력',
                    excluded: '입력 제외',
                    all: '전체',
                  }[f]
                }
              </button>
            ))}
            <input
              aria-label="판매가 작업 상품 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명·품목코드"
              className="rounded border px-2 text-xs"
            />
            <button
              onClick={() => load()}
              className="rounded border px-2 text-xs"
            >
              검색
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            최신 품목 100건까지 표시합니다. 빈 판매가는 기존 값 유지입니다. 입력
            제외 상품은 삭제하지 않고 별도로 보관하며 언제든 복원할 수 있습니다.
          </p>
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded border p-3">
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const f = new FormData(e.currentTarget)
                    start(async () => {
                      const r = await saveQueuePricesAction({
                        id: row.id,
                        b2b: String(f.get('b2b') ?? ''),
                        b2c: String(f.get('b2c') ?? ''),
                        excluded: f.get('excluded') === 'on',
                        reason: String(f.get('reason') ?? ''),
                      })
                      if (r.success) {
                        toast.success('판매가·입력 제외 설정을 저장했습니다.')
                        load()
                        router.refresh()
                      } else toast.error(r.error)
                    })
                  }}
                >
                  <div className="min-w-44 flex-1">
                    <strong className="text-sm">{row.name}</strong>
                    <div className="text-xs text-muted-foreground">
                      {row.sku} · 원가{' '}
                      {Number(row.cost ?? 0).toLocaleString('ko-KR')}원
                    </div>
                  </div>
                  <label className="text-xs">
                    B2B
                    <input
                      name="b2b"
                      defaultValue={row.b2b ?? ''}
                      className="block w-28 rounded border px-2 py-1"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="text-xs">
                    B2C
                    <input
                      name="b2c"
                      defaultValue={row.b2c ?? ''}
                      className="block w-28 rounded border px-2 py-1"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="text-xs">
                    <input
                      name="excluded"
                      type="checkbox"
                      defaultChecked={row.excluded}
                    />{' '}
                    입력 제외
                  </label>
                  <input
                    name="reason"
                    aria-label={`${row.name} 입력 제외 사유`}
                    defaultValue={row.reason}
                    placeholder="입력 제외 사유"
                    className="w-44 rounded border px-2 py-1 text-xs"
                  />
                  <button
                    disabled={pending}
                    className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                  >
                    저장
                  </button>
                </form>
                {row.workflowId && (
                  <div className="mt-2">
                    <ProductLinkPanel itemId={row.workflowId} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {!rows.length && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {pending ? '불러오는 중…' : '해당하는 상품이 없습니다.'}
            </p>
          )}
        </section>
      )}
    </>
  )
}

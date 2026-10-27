'use client'

import { type FormEvent, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, Plus, Warehouse, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createSaasChinaOutboundWarehouseAction,
  renameSaasChinaOutboundWarehouseAction,
} from '../saas-china-actions'
import { useChinaWorkGuard } from './unsaved-china-work'

export type ChinaOutboundWarehouseView = {
  warehouseCode: string
  isDefault: boolean
  hasActiveInventory: boolean
}

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Warehouse names are managed separately from stock quantities so an operator
 * can prepare a new location before its first inventory upload. Renaming is
 * intentionally confirmation-gated because it updates the current active
 * SaaS China inventory location labels as well.
 */
export function ChinaShipmentWarehouseDialog({ warehouses }: { warehouses: ChinaOutboundWarehouseView[] }) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [open, setOpen] = useState(false)
  const [newWarehouseCode, setNewWarehouseCode] = useState('')
  const [editingWarehouseCode, setEditingWarehouseCode] = useState<string | null>(null)
  const [nextWarehouseCode, setNextWarehouseCode] = useState('')
  const [isPending, startTransition] = useTransition()
  const busy = isPending || guard.busy

  function closeDialog() {
    if (busy) return
    setOpen(false)
    setNewWarehouseCode('')
    setEditingWarehouseCode(null)
    setNextWarehouseCode('')
  }

  function addWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const warehouseCode = newWarehouseCode.trim()
    if (!warehouseCode) {
      toast.error('새 출고창고명을 입력해주세요.')
      return
    }
    startTransition(async () => {
      await guard.runTask(async () => {
        const result = await createSaasChinaOutboundWarehouseAction({ warehouseCode })
        if (!result.ok) {
          toast.error(result.error)
          return false
        }
        setNewWarehouseCode('')
        toast.success('출고창고를 추가했습니다.')
        router.refresh()
        return true
      })
    })
  }

  function beginEdit(warehouseCode: string) {
    setEditingWarehouseCode(warehouseCode)
    setNextWarehouseCode(warehouseCode)
  }

  function requestRename(event: FormEvent<HTMLFormElement>, warehouseCode: string) {
    event.preventDefault()
    const next = nextWarehouseCode.trim()
    if (!next) {
      toast.error('새 출고창고명을 입력해주세요.')
      return
    }
    if (next === warehouseCode) {
      toast.error('변경할 출고창고명이 같습니다.')
      return
    }
    guard.requestConfirmation({
      title: '창고명 변경',
      description: <>
        현재 SaaS 중국재고의 <span data-no-translate className="font-medium text-foreground">{warehouseCode}</span> 창고명도 <span data-no-translate className="font-medium text-foreground">{next}</span>으로 변경됩니다. 이미 만든 출고 기록과 재고 이동 이력은 바꾸지 않습니다.
      </>,
      confirmLabel: '창고명 변경',
      onConfirm: () => {
        startTransition(async () => {
          await guard.runTask(async () => {
            const result = await renameSaasChinaOutboundWarehouseAction({
              warehouseCode,
              nextWarehouseCode: next,
            })
            if (!result.ok) {
              toast.error(result.error)
              return false
            }
            setEditingWarehouseCode(null)
            setNextWarehouseCode('')
            toast.success('출고창고명을 변경했습니다.')
            router.refresh()
            return true
          })
        })
      },
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
      >
        <Warehouse className="size-4" />
        창고 수정
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeDialog()
          }}
        >
          <section
            data-purchasing-translate
            role="dialog"
            aria-modal="true"
            aria-labelledby="china-outbound-warehouse-title"
            aria-describedby="china-outbound-warehouse-description"
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-background p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="china-outbound-warehouse-title" className="text-lg font-semibold">출고 창고 관리</h3>
                <p id="china-outbound-warehouse-description" className="mt-1 text-sm text-muted-foreground">엑셀 기본 출고창고와 중국출고에서 사용하는 창고명을 직접 추가하거나 수정할 수 있습니다.</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={busy} aria-label="출고 창고 관리 닫기" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                <X className="size-5" />
              </button>
            </div>

            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">창고명을 바꾸면 현재 SaaS 중국재고의 해당 창고명도 함께 바뀝니다. 기존 출고 기록과 재고 이동 이력은 그대로 보존됩니다.</p>

            <form onSubmit={addWarehouse} className="mt-4 rounded-lg border bg-muted/20 p-3">
              <label className="block text-sm font-medium" htmlFor="new-china-outbound-warehouse">새 출고창고명</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="new-china-outbound-warehouse"
                  value={newWarehouseCode}
                  onChange={(event) => setNewWarehouseCode(event.target.value)}
                  disabled={busy}
                  className={inputClass}
                  placeholder="예: 중국 2창고"
                  maxLength={100}
                />
                <button type="submit" disabled={busy || !newWarehouseCode.trim()} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  추가
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">새 창고는 재고가 아직 없어도 미리 등록할 수 있습니다.</p>
            </form>

            <div className="mt-4 overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">등록된 출고창고</div>
              {warehouses.length === 0 ? <p className="px-3 py-10 text-center text-sm text-muted-foreground">등록된 출고창고가 없습니다.</p> : (
                <ul className="divide-y">
                  {warehouses.map((warehouse) => {
                    const editing = editingWarehouseCode === warehouse.warehouseCode
                    return (
                      <li key={warehouse.warehouseCode} className="p-3">
                        {editing ? (
                          <form onSubmit={(event) => requestRename(event, warehouse.warehouseCode)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input autoFocus value={nextWarehouseCode} onChange={(event) => setNextWarehouseCode(event.target.value)} disabled={busy} className={inputClass} maxLength={100} aria-label={`${warehouse.warehouseCode} 새 창고명`} />
                            <div className="flex shrink-0 gap-2">
                              <button type="button" disabled={busy} onClick={() => { setEditingWarehouseCode(null); setNextWarehouseCode('') }} className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">취소</button>
                              <button type="submit" disabled={busy || !nextWarehouseCode.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 저장</button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p data-no-translate className="truncate font-medium">{warehouse.warehouseCode}</p>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                                {warehouse.isDefault ? <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-medium text-primary">기본 창고</span> : null}
                                <span className={`rounded-full border px-2 py-0.5 ${warehouse.hasActiveInventory ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-muted-foreground/20 bg-muted/30 text-muted-foreground'}`}>{warehouse.hasActiveInventory ? '현재 재고 있음' : '재고 없음'}</span>
                              </div>
                            </div>
                            <button type="button" disabled={busy} onClick={() => beginEdit(warehouse.warehouseCode)} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"><Pencil className="size-3.5" /> 이름 수정</button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

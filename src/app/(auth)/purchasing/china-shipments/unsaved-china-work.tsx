'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type DraftKind = 'create' | 'details' | 'items' | 'box' | 'pallet' | 'workbook'

type Draft = {
  kind: DraftKind
  label: string
  snapshot: unknown
  boxDimensions?: Array<{ boxNo: string; dimensions: string }>
  save: () => Promise<boolean>
  discard: () => void
}

type Guard = {
  busy: boolean
  setDraft: (id: string, draft: Draft | null) => void
  getDraft: (id: string) => Draft | undefined
  hasDraftKind: (kind: DraftKind) => boolean
  requestNavigation: (navigate: () => void, kinds?: DraftKind[]) => void
  runTask: (task: () => Promise<boolean>) => Promise<boolean>
}

const GuardContext = createContext<Guard | null>(null)

export function useChinaWorkGuard() {
  const guard = useContext(GuardContext)
  if (!guard) throw new Error('중국출고 미저장 보호 영역이 없습니다.')
  return guard
}

export function useChinaWorkDraft(id: string, draft: Draft | null) {
  const { setDraft } = useChinaWorkGuard()
  // Layout effects synchronise input edits before the next click can navigate away.
  // Dirty drafts intentionally survive an editor unmount caused by sorting/pagination.
  useLayoutEffect(() => { setDraft(id, draft) })
}

export function ChinaWorkGuardProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, Draft>())
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<{ navigate: () => void; kinds?: DraftKind[] } | null>(null)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  const setDraft = useCallback((id: string, draft: Draft | null) => {
    if (draft) drafts.current.set(id, draft)
    else drafts.current.delete(id)
  }, [])
  const getDraft = useCallback((id: string) => drafts.current.get(id), [])
  const hasDraftKind = useCallback((kind: DraftKind) => [...drafts.current.values()].some((draft) => draft.kind === kind), [])

  const runTask = useCallback(async (task: () => Promise<boolean>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      return await task()
    } catch {
      toast.error('저장 중 연결 오류가 발생했습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const requestNavigation = useCallback((navigate: () => void, kinds?: DraftKind[]) => {
    if (busyRef.current) {
      toast.error('저장 또는 엑셀 처리가 끝난 뒤 이동해주세요.')
      return
    }
    if (![...drafts.current.values()].some((draft) => !kinds || kinds.includes(draft.kind))) {
      navigate()
      return
    }
    setError('')
    setPendingNavigation({ navigate, kinds })
  }, [])

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (drafts.current.size === 0 && !busyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  useEffect(() => {
    if (!pendingNavigation) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLButtonElement>('button')?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        setPendingNavigation(null)
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [pendingNavigation])

  function discardAndNavigate() {
    if (!pendingNavigation || busyRef.current) return
    const { navigate, kinds } = pendingNavigation
    const currentDrafts = [...drafts.current.entries()].filter(([, draft]) => !kinds || kinds.includes(draft.kind))
    for (const [id, draft] of currentDrafts) {
      drafts.current.delete(id)
      draft.discard()
    }
    setPendingNavigation(null)
    navigate()
  }

  async function saveAndNavigate() {
    if (!pendingNavigation || busyRef.current) return
    const currentDrafts = [...drafts.current.entries()].filter(([, draft]) => !pendingNavigation.kinds || pendingNavigation.kinds.includes(draft.kind))
    const hasWorkbook = currentDrafts.some(([, draft]) => draft.kind === 'workbook')
    const hasDirectPacking = currentDrafts.some(([, draft]) => draft.kind === 'box' || draft.kind === 'pallet')
    if (hasWorkbook && hasDirectPacking) {
      setError('엑셀과 직접 입력한 박스·파렛트 내용이 함께 있습니다. 덮어쓰지 않도록 각 내용을 확인하고 개별 저장하거나 취소한 뒤 이동해주세요.')
      return
    }
    const dimensionsByBox = new Map<string, string>()
    for (const [, draft] of currentDrafts) {
      for (const box of draft.boxDimensions ?? []) {
        const previous = dimensionsByBox.get(box.boxNo)
        if (previous && previous !== box.dimensions) {
          setError(`${box.boxNo} 박스에 서로 다른 규격이 입력돼 있습니다. 규격을 일치시킨 뒤 저장해주세요.`)
          return
        }
        dimensionsByBox.set(box.boxNo, box.dimensions)
      }
    }

    const succeeded = await runTask(async () => {
      for (const [id, draft] of currentDrafts) {
        if (!await draft.save()) {
          setError(`${draft.label}을(를) 저장하지 못했습니다. 내용을 확인한 뒤 다시 시도해주세요. 이미 저장된 항목은 다시 저장하지 않습니다.`)
          return false
        }
        drafts.current.delete(id)
      }
      return true
    })
    if (!succeeded) return
    setPendingNavigation(null)
    pendingNavigation.navigate()
  }

  return <GuardContext.Provider value={{ busy, setDraft, getDraft, hasDraftKind, requestNavigation, runTask }}>
    {children}
    {pendingNavigation ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="china-unsaved-title" aria-describedby="china-unsaved-description" className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-xl">
        <h2 id="china-unsaved-title" className="text-lg font-semibold">저장하지 않은 내용이 있습니다</h2>
        <p id="china-unsaved-description" className="mt-2 text-sm text-muted-foreground">이동하기 전에 입력 내용을 저장할까요? 저장하지 않고 이동하면 현재 입력 중인 내용만 사라집니다.</p>
        {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setPendingNavigation(null)} className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">계속 작업</button>
          <button type="button" disabled={busy} onClick={discardAndNavigate} className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">저장하지 않고 이동</button>
          <button type="button" disabled={busy} onClick={saveAndNavigate} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null}저장 후 이동</button>
        </div>
      </div>
    </div> : null}
  </GuardContext.Provider>
}

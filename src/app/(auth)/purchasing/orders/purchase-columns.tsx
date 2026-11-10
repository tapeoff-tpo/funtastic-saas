'use client'

import { createContext, useContext, useId, useSyncExternalStore, type ReactNode } from 'react'

export type PurchaseColumn = { id: string; label: string; initiallyHidden?: boolean; field?: boolean }

const ColumnsContext = createContext<{
  columns: PurchaseColumn[]
  hidden: Set<string>
  setHidden: (hidden: Set<string>) => void
} | null>(null)
const CHANGE_EVENT = 'purchase-columns-change'

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function PurchaseColumns({ scope, columns, children }: { scope: string; columns: PurchaseColumn[]; children: ReactNode }) {
  const key = `purchase-columns:${scope}`
  const tableId = useId()
  const saved = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) } catch { return null }
  }, () => null)
  const defaults = columns.filter((column) => column.initiallyHidden).map((column) => column.id)
  let stored: unknown = defaults
  if (saved) {
    try { stored = JSON.parse(saved) } catch { /* fall back to the defaults */ }
  }
  const savedIds = Array.isArray(stored) ? new Set(stored) : new Set(defaults)
  const hidden = new Set(columns.map(({ id }) => id).filter((id) => savedIds.has(id)))
  const table = `[data-purchase-table="${tableId}"]`
  const css = [...hidden].map((id) => `${table} [data-purchase-column="${id}"]{display:none}`).join('')
    + (hidden.has('select') ? `${table} [data-purchase-column="number"]{left:0}` : '')

  return <ColumnsContext.Provider value={{
    columns,
    hidden,
    setHidden(next) {
      try {
        localStorage.setItem(key, JSON.stringify([...next]))
        window.dispatchEvent(new Event(CHANGE_EVENT))
      } catch { /* storage can be unavailable */ }
    },
  }}>
    <div data-purchase-table={tableId} className="min-w-0">
      {css && <style>{css}</style>}
      {children}
    </div>
  </ColumnsContext.Provider>
}

export function PurchaseColumnPicker() {
  const context = useContext(ColumnsContext)
  if (!context) return null
  const { columns, hidden, setHidden } = context
  const visibleCount = columns.filter(({ id, field }) => !field && !hidden.has(id)).length
  return <details className="relative">
    <summary className="flex h-7 cursor-pointer list-none items-center rounded-md border px-2.5 text-xs font-medium">표시할 열</summary>
    <div className="absolute right-0 z-30 mt-1 grid max-h-80 w-52 gap-1 overflow-y-auto rounded-md border bg-background p-2 shadow-lg">
      {columns.map(({ id, label, field }) => <label key={id} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs">
        <input type="checkbox" checked={!hidden.has(id)} disabled={!field && !hidden.has(id) && visibleCount === 1}
          onChange={(event) => {
            const next = new Set(hidden)
            if (event.target.checked) next.delete(id)
            else next.add(id)
            setHidden(next)
          }} />
        {label}
      </label>)}
      <button type="button" className="mt-1 border-t pt-1 text-left text-xs text-muted-foreground"
        onClick={() => setHidden(new Set(columns.filter((column) => column.initiallyHidden).map((column) => column.id)))}>기본값 복원</button>
    </div>
  </details>
}

export function PurchaseEmptyCell({ fallbackCount, children }: { fallbackCount: number; children: ReactNode }) {
  const context = useContext(ColumnsContext)
  const colSpan = context ? context.columns.filter(({ id, field }) => !field && !context.hidden.has(id)).length : fallbackCount
  return <td colSpan={Math.max(1, colSpan)} className="px-3 py-12 text-center text-sm text-muted-foreground">{children}</td>
}

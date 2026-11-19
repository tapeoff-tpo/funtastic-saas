'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Selection = { key: string; name: string; code: string; optionCount?: number }
const SelectionContext = createContext<{
  selection: Selection | null
  begin: (selection: Selection) => number
  isCurrent: (token: number) => boolean
  cancel: (token: number) => void
  settle: (key?: string) => void
} | null>(null)

export function RegistrationSelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const request = useRef(0)
  const begin = useCallback((value: Selection) => { setSelection(value); return ++request.current }, [])
  const isCurrent = useCallback((token: number) => request.current === token, [])
  const cancel = useCallback((token: number) => { if (request.current === token) setSelection(null) }, [])
  const settle = useCallback((key?: string) => setSelection((current) => current?.key === key ? null : current), [])
  return <SelectionContext.Provider value={{ selection, begin, isCurrent, cancel, settle }}>{children}</SelectionContext.Provider>
}

export function useRegistrationSelection() { return useContext(SelectionContext) }

export function RegistrationDetailPreview({ name, code, optionCount }: Omit<Selection, 'key'>) {
  return <div aria-busy="true" className="space-y-4">
    <header><h2 className="text-base font-semibold">{name}</h2>
      <p className="text-xs text-muted-foreground">{code}{optionCount ? ` · 옵션 ${optionCount}개` : ''}</p></header>
    <p role="status" className="text-xs text-muted-foreground">등록정보를 불러오고 있습니다.</p>
    <div aria-hidden="true" className="space-y-3 animate-pulse">
      <div className="h-40 rounded-lg bg-muted" /><div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-lg bg-muted" />)}
      </div>
    </div>
  </div>
}

export function RegistrationSelectionPanel({ currentGroup, children }: { currentGroup?: string; children: ReactNode }) {
  const context = useRegistrationSelection()
  const selection = context?.selection
  const settle = context?.settle
  useEffect(() => { settle?.(currentGroup) }, [currentGroup, settle])
  return selection && selection.key !== currentGroup
    ? <RegistrationDetailPreview name={selection.name} code={selection.code} optionCount={selection.optionCount} />
    : children
}

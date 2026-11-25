'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type RegistrationStage = 'pricing' | 'information' | 'registered'
export type WorkbenchView = {
  stage: RegistrationStage
  activeId: string
  catalogTarget: { bundleId?: string } | null
}

const PATH = '/operations/coupang-registration'
const HISTORY_KEY = 'coupangRegistrationView'
const initialView: WorkbenchView = { stage: 'pricing', activeId: '', catalogTarget: null }
type ViewEntry = { session: string; view: WorkbenchView }

function isViewEntry(value: unknown): value is ViewEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ViewEntry>
  const view = entry.view
  return typeof entry.session === 'string' && !!view
    && ['pricing', 'information', 'registered'].includes(view.stage)
    && typeof view.activeId === 'string'
    && (view.catalogTarget === null || typeof view.catalogTarget === 'object'
      && (view.catalogTarget.bundleId === undefined || typeof view.catalogTarget.bundleId === 'string'))
}

function sameView(left: WorkbenchView, right: WorkbenchView) {
  return left.stage === right.stage && left.activeId === right.activeId
    && (left.catalogTarget === null) === (right.catalogTarget === null)
    && left.catalogTarget?.bundleId === right.catalogTarget?.bundleId
}

/** Record screen changes only. Product data stays in the live draft when traversing history. */
export function useWorkbenchNavigation() {
  const [view, setView] = useState<WorkbenchView>(initialView)
  const current = useRef(view)
  const baseline = useRef(view)
  const session = useRef('')

  const apply = useCallback((next: WorkbenchView) => {
    current.current = next
    setView(next)
  }, [])
  const write = useCallback((next: WorkbenchView, replace: boolean) => {
    if (window.location.pathname !== PATH) return
    const state = { ...window.history.state, [HISTORY_KEY]: { session: session.current, view: next } }
    if (replace) window.history.replaceState(state, '', window.location.href)
    else window.history.pushState(state, '', window.location.href)
  }, [])

  useEffect(() => {
    if (!session.current) {
      session.current = crypto.randomUUID()
      write(current.current, true)
    }
    function restore(event: PopStateEvent) {
      if (window.location.pathname !== PATH) return
      const entry = event.state?.[HISTORY_KEY]
      // Loading another draft starts a new view history. Old entries cannot reopen its rows.
      apply(isViewEntry(entry) && entry.session === session.current ? entry.view : baseline.current)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [apply, write])

  const navigate = useCallback((patch: Partial<WorkbenchView>) => {
    const next = { ...current.current, ...patch }
    if (sameView(current.current, next)) return
    write(next, false)
    apply(next)
  }, [apply, write])

  const reset = useCallback((next: WorkbenchView) => {
    session.current = crypto.randomUUID()
    baseline.current = next
    write(next, true)
    apply(next)
  }, [apply, write])

  return { ...view, navigate, reset }
}

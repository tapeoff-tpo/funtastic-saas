'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'

export function ContentsToggle({ expanded, onClick, label, controls, className = '' }: {
  expanded: boolean
  onClick: () => void
  label: string
  controls?: string
  className?: string
}) {
  const Icon = expanded ? ChevronUp : ChevronDown
  return <button type="button" aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onClick}
    className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${expanded ? 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50'} ${className}`}>
    <Icon aria-hidden="true" className="size-4" />{expanded ? '접기' : '펼치기'}
  </button>
}

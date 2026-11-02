'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export function TitleHelp({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (!position) return
    function closeOutside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setPosition(null) }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPosition(null); root.current?.querySelector('button')?.focus() } }
    const close = () => setPosition(null)
    const closeOnScroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', closeOnScroll, true) }
  }, [position])
  return <span ref={root} className="ml-2 inline-flex align-middle text-sm font-normal">
    <button type="button" aria-label={`${title} 설명 보기`} aria-expanded={!!position} aria-controls={position ? id : undefined} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      setPosition(position ? null : { top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 220)), left: Math.max(8, Math.min(rect.left, window.innerWidth - 336)) })
    }} className="inline-flex size-5 items-center justify-center rounded-full border border-muted-foreground/50 text-xs font-bold text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">!</button>
    {position && <span id={id} role="note" style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 8}px)` }} className="fixed z-[100] block w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border bg-popover p-3 text-left text-sm leading-6 text-popover-foreground shadow-lg">{children}</span>}
  </span>
}

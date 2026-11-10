'use client'

import { useEffect, useRef, useState } from 'react'

export function usePriceColumnWidths(storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        setWidths(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 72 && entry[1] <= 800)))
      }
    } catch { /* Storage may be unavailable in private browsing. */ }
    setLoaded(true)
  }, [storageKey])
  useEffect(() => {
    if (loaded) try { localStorage.setItem(storageKey, JSON.stringify(widths)) } catch { /* Keep resizing usable without storage. */ }
  }, [loaded, storageKey, widths])
  return {
    width: (id: string, fallback: number) => widths[id] ?? fallback,
    resize: (id: string, value: number) => setWidths(current => ({ ...current, [id]: Math.max(72, Math.min(800, Math.round(value))) })),
  }
}

export function ColumnResizeHandle({ label, width, onResize }: { label: string; width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  return <span
    role="separator" aria-label={`${label} 열 너비`} aria-orientation="vertical"
    aria-valuemin={72} aria-valuemax={800} aria-valuenow={width} tabIndex={0}
    title="드래그 또는 방향키로 열 너비 조절"
    className="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none select-none hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none"
    onPointerDown={event => { event.preventDefault(); event.stopPropagation(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={event => { if (drag.current) onResize(drag.current.width + event.clientX - drag.current.x) }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onResize(width + (event.key === 'ArrowRight' ? 8 : -8)) } }}
  ><span className="absolute inset-y-0 left-1/2 w-px bg-border" /></span>
}

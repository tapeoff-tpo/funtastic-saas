'use client'

import { useRef } from 'react'

/** Keep long sample identifiers inside their column; drag to reveal the rest. */
export function ItemCodeCell({ code }: { code: string }) {
  const drag = useRef<{ x: number; scroll: number } | null>(null)
  return <div data-no-translate title={code} aria-label={`품목코드 ${code}`} tabIndex={0}
    className="w-full overflow-x-auto whitespace-nowrap cursor-default select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden active:cursor-defaultbing"
    onPointerDown={(event) => {
      if (event.button !== 0 || event.pointerType === 'touch') return
      drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (drag.current) event.currentTarget.scrollLeft = drag.current.scroll - (event.clientX - drag.current.x)
    }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={(event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        event.currentTarget.scrollLeft += event.key === 'ArrowRight' ? 40 : -40
      }
    }}>{code}</div>
}

/**
 * SyncedScrollContainer — 가로로 길어 잘리는 테이블을 위해
 * 테이블 영역 위에 가짜 스크롤바를 하나 더 두고 두 영역의 scrollLeft 를 동기화한다.
 *
 * 사용:
 *   <SyncedScrollContainer>
 *     <table>...</table>
 *   </SyncedScrollContainer>
 *
 * 자식 영역의 scrollWidth 를 ResizeObserver + MutationObserver 로 추적해서
 * 위쪽 가짜 스크롤바의 내부 너비를 자동으로 맞춘다.
 */

'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function SyncedScrollContainer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const [contentWidth, setContentWidth] = useState(0)

  useEffect(() => {
    const wrap = bottomRef.current
    if (!wrap) return

    const update = () => {
      const tbl = wrap.querySelector('table')
      const w = tbl?.scrollWidth ?? wrap.scrollWidth
      setContentWidth(w)
    }
    update()

    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    const tbl = wrap.querySelector('table')
    if (tbl) ro.observe(tbl)

    // 컬럼 리사이즈는 th 의 style.width 변경으로 일어나므로 attribute 변경도 감시
    const mo = new MutationObserver(update)
    mo.observe(wrap, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  const onTopScroll = () => {
    if (syncingRef.current) return
    syncingRef.current = true
    if (bottomRef.current && topRef.current) {
      bottomRef.current.scrollLeft = topRef.current.scrollLeft
    }
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }

  const onBottomScroll = () => {
    if (syncingRef.current) return
    syncingRef.current = true
    if (topRef.current && bottomRef.current) {
      topRef.current.scrollLeft = bottomRef.current.scrollLeft
    }
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }

  return (
    <div className={className}>
      {/* 상단 가짜 스크롤바 — 테이블이 가로로 넘칠 때만 의미 있음 */}
      <div
        ref={topRef}
        onScroll={onTopScroll}
        className="overflow-x-auto rounded-t-md border border-b-0"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      {/* 실제 테이블 영역 — 기존 가로 스크롤도 그대로 유지 */}
      <div
        ref={bottomRef}
        onScroll={onBottomScroll}
        className="overflow-x-auto rounded-b-md border"
      >
        {children}
      </div>
    </div>
  )
}

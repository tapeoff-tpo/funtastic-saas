/**
 * useColumnSizing — TanStack Table 의 columnSizing 상태를 localStorage 에 저장해서
 * 사용자가 한 번 조절한 컬럼 너비를 페이지 새로고침/재방문 시에도 유지한다.
 *
 * 사용:
 *   const [columnSizing, setColumnSizing] = useColumnSizing('inventory-table')
 *   const table = useReactTable({
 *     ...
 *     columnResizeMode: 'onChange',
 *     state: { ..., columnSizing },
 *     onColumnSizingChange: setColumnSizing,
 *   })
 */

'use client'

import { useEffect, useState } from 'react'
import type { ColumnSizingState } from '@tanstack/react-table'

const STORAGE_PREFIX = 'colsize:'

export function useColumnSizing(tableKey: string) {
  const storageKey = `${STORAGE_PREFIX}${tableKey}`

  // SSR 안전: 초기값은 빈 객체. 마운트 후 localStorage 에서 복원.
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') {
          setColumnSizing(parsed as ColumnSizingState)
        }
      }
    } catch {
      // localStorage 접근 실패는 무시 — 기본값으로 동작
    }
  }, [storageKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(columnSizing))
    } catch {
      // 저장 실패는 무시
    }
  }, [storageKey, columnSizing])

  return [columnSizing, setColumnSizing] as const
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'

interface Connection {
  marketplaceId: string
  displayName: string
  status: string
}

interface CollectOrdersPanelProps {
  connections: Connection[]
}

export function CollectOrdersPanel({ connections }: CollectOrdersPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collecting, setCollecting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const connectedMarkets = connections.filter((c) => c.status !== 'disconnected')

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === connectedMarkets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(connectedMarkets.map((c) => c.marketplaceId)))
    }
  }

  const handleCollect = async () => {
    if (selected.size === 0) {
      toast.error('수집할 마켓플레이스를 선택하세요')
      return
    }
    setCollecting(true)
    try {
      const res = await fetch('/api/orders/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplaceIds: [...selected] }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || '주문 수집에 실패했습니다')
        return
      }

      const successes = data.results.filter(
        (r: { success: boolean }) => r.success
      )
      const failures = data.results.filter(
        (r: { success: boolean }) => !r.success
      )
      const totalOrders = successes.reduce(
        (sum: number, r: { ordersCollected?: number }) =>
          sum + (r.ordersCollected ?? 0),
        0
      )

      if (failures.length === 0) {
        toast.success(`주문 수집 완료: 총 ${totalOrders}건 수집`)
      } else if (successes.length > 0) {
        toast.warning(
          `${successes.length}개 성공 (${totalOrders}건), ${failures.length}개 실패`
        )
      } else {
        toast.error(
          `주문 수집 실패: ${failures.map((f: { marketplaceId: string }) => f.marketplaceId).join(', ')}`
        )
      }
    } catch {
      toast.error('주문 수집 중 오류가 발생했습니다')
    } finally {
      setCollecting(false)
      setIsOpen(false)
    }
  }

  if (connectedMarkets.length === 0) return null

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
      >
        주문 수집
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border bg-background p-4 shadow-lg">
          <p className="mb-3 text-sm font-medium">수집할 마켓플레이스 선택</p>

          {/* Select All */}
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
            <input
              type="checkbox"
              checked={selected.size === connectedMarkets.length}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium">전체선택</span>
          </label>

          <div className="my-2 border-t" />

          {/* Individual marketplaces */}
          {connections.map((conn) => {
            const isDisconnected = conn.status === 'disconnected'
            return (
              <label
                key={conn.marketplaceId}
                className={`flex items-center gap-2 rounded px-2 py-1.5 ${
                  isDisconnected
                    ? 'cursor-not-allowed opacity-40'
                    : 'cursor-pointer hover:bg-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(conn.marketplaceId)}
                  onChange={() => toggleSelect(conn.marketplaceId)}
                  disabled={isDisconnected}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">{conn.displayName}</span>
                {isDisconnected && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    미연결
                  </span>
                )}
              </label>
            )
          })}

          <div className="my-2 border-t" />

          <button
            onClick={handleCollect}
            disabled={selected.size === 0 || collecting}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {collecting ? '수집 중...' : `수집 시작 (${selected.size}개)`}
          </button>
        </div>
      )}
    </div>
  )
}

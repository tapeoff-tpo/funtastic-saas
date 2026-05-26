'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getIntegrationInfo, type IntegrationMethod } from '@/lib/marketplace/integration-methods'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import { ConnectionRow } from './edit-button'

interface ConnectionListItem {
  id: string
  marketplaceId: string
  marketplaceName: string
  storeAlias: string
  displayName: string
  salesExportMarketplaceId: string
  status: string
  integrationMethod: IntegrationMethod
  linkedMarketplaces: string[]
}

interface ConnectionListProps {
  connections: ConnectionListItem[]
  pageSize?: number
}

type FilterKey = 'all' | 'api' | 'hub' | 'rpa' | 'excel'

const METHOD_ORDER: Record<IntegrationMethod, number> = {
  api: 0,
  hub: 1,
  rpa: 2,
  excel: 3,
}

function matchesFilter(connection: ConnectionListItem, filter: FilterKey): boolean {
  if (filter === 'all') return true
  return connection.integrationMethod === filter
}

export function ConnectionList({ connections, pageSize = 10 }: ConnectionListProps) {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const counts = useMemo(() => ({
    all: connections.length,
    api: connections.filter((connection) => connection.integrationMethod === 'api').length,
    hub: connections.filter((connection) => connection.integrationMethod === 'hub').length,
    rpa: connections.filter((connection) => connection.integrationMethod === 'rpa').length,
    excel: connections.filter((connection) => connection.integrationMethod === 'excel').length,
  }), [connections])
  const filteredConnections = useMemo(() => {
    const query = search.trim().toLowerCase()
    return connections
      .filter((connection) => matchesFilter(connection, filter))
      .filter((connection) => {
        if (!query) return true
        return [
          connection.marketplaceId,
          connection.marketplaceName,
          connection.storeAlias,
          connection.displayName,
          connection.status,
          ...connection.linkedMarketplaces,
        ].some((value) => value.toLowerCase().includes(query))
      })
  }, [connections, filter, search])
  const sortedConnections = useMemo(
    () => [...filteredConnections].sort((a, b) => {
      const methodDiff = METHOD_ORDER[a.integrationMethod] - METHOD_ORDER[b.integrationMethod]
      if (methodDiff !== 0) return methodDiff
      return a.displayName.localeCompare(b.displayName, 'ko-KR')
    }),
    [filteredConnections],
  )
  const totalPages = Math.max(1, Math.ceil(sortedConnections.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const visibleConnections = sortedConnections.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
  const filterButtons: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: counts.all },
    { key: 'api', label: 'API', count: counts.api },
    { key: 'hub', label: '연동몰', count: counts.hub },
    { key: 'rpa', label: 'RPA', count: counts.rpa },
    { key: 'excel', label: '엑셀', count: counts.excel },
  ]

  return (
    <section className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">연결된 마켓플레이스</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              검색과 연동 방식 필터로 필요한 연결만 빠르게 확인합니다.
            </p>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {filterButtons.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  onClick={() => {
                    setFilter(button.key)
                    setPage(0)
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    filter === button.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {button.label} {button.count}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
                placeholder="마켓명, 계정명, 하위몰 검색"
                className="h-8 w-full rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring lg:w-64"
              />
              <span className="whitespace-nowrap rounded-full bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                {sortedConnections.length}/{connections.length}개
              </span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              ←
            </Button>
            <span className="min-w-12 text-center">
              {currentPage + 1}/{totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            >
              →
            </Button>
          </div>
        </div>
      </div>
      <div className="divide-y">
        {visibleConnections.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            조건에 맞는 연결이 없습니다.
          </div>
        ) : visibleConnections.map((connection) => {
          const info = getIntegrationInfo(connection.integrationMethod)

          return (
            <div key={connection.id} className="grid gap-0 md:grid-cols-[120px_1fr]">
              <div className="flex items-center border-b bg-muted/20 px-4 py-2 md:border-b-0 md:border-r">
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {info.label}
                </span>
              </div>
              <ConnectionRow
                connectionId={connection.id}
                marketplaceName={connection.marketplaceName}
                storeAlias={connection.storeAlias}
                displayName={connection.displayName}
                salesExportMarketplaceId={connection.salesExportMarketplaceId}
                status={connection.status as ConnectionStatus}
                integrationMethod={connection.integrationMethod}
                linkedMarketplaces={connection.linkedMarketplaces}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getIntegrationInfo, type IntegrationMethod } from '@/lib/marketplace/integration-methods'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import { ConnectionRow } from './edit-button'

interface ConnectionListItem {
  id: string
  displayName: string
  status: string
  integrationMethod: IntegrationMethod
  linkedMarketplaces: string[]
}

interface ConnectionListProps {
  connections: ConnectionListItem[]
  pageSize?: number
}

const METHOD_ORDER: Record<IntegrationMethod, number> = {
  api: 0,
  hub: 1,
  rpa: 2,
  excel: 3,
}

function displayMethod(method: IntegrationMethod): IntegrationMethod {
  return method === 'hub' ? 'api' : method
}

export function ConnectionList({ connections, pageSize = 10 }: ConnectionListProps) {
  const [page, setPage] = useState(0)
  const sortedConnections = useMemo(
    () => [...connections].sort((a, b) => {
      const methodDiff = METHOD_ORDER[a.integrationMethod] - METHOD_ORDER[b.integrationMethod]
      if (methodDiff !== 0) return methodDiff
      return a.displayName.localeCompare(b.displayName, 'ko-KR')
    }),
    [connections],
  )
  const totalPages = Math.max(1, Math.ceil(sortedConnections.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const visibleConnections = sortedConnections.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

  return (
    <section className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">연결된 마켓플레이스</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              연동 방식과 상관없이 한 목록에서 확인하고, 10개씩 넘겨 봅니다.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-background px-2 py-0.5 font-medium">
              총 {connections.length}개
            </span>
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
        {visibleConnections.map((connection) => {
          const method = displayMethod(connection.integrationMethod)
          const info = getIntegrationInfo(method)

          return (
            <div key={connection.id} className="grid gap-0 md:grid-cols-[120px_1fr]">
              <div className="flex items-center border-b bg-muted/20 px-4 py-2 md:border-b-0 md:border-r">
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {info.label}
                </span>
              </div>
              <ConnectionRow
                connectionId={connection.id}
                displayName={connection.displayName}
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

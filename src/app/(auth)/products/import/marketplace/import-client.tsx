'use client'

import { useState, useTransition } from 'react'

interface Connection {
  id: string
  marketplaceId: string
  displayName: string
  status: string
}

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export function MarketplaceImportClient({
  connections,
}: {
  connections: Connection[]
}) {
  const [selectedId, setSelectedId] = useState(connections[0]?.id ?? '')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedConnection = connections.find((c) => c.id === selectedId)

  const handleImport = () => {
    if (!selectedConnection) return
    setResult(null)
    startTransition(async () => {
      const { reverseCollectAction } = await import('@/lib/products/ui-actions')
      const res = await reverseCollectAction(
        selectedConnection.id,
        selectedConnection.marketplaceId,
      )
      if (res.success) {
        setResult(res.data)
      } else {
        alert(`가져오기 실패: ${res.error}`)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">마켓플레이스 선택</label>
        <select
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value)
            setResult(null)
          }}
          className="w-full rounded-md border px-3 py-2 text-sm"
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName} ({c.marketplaceId})
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleImport}
          disabled={isPending || !selectedId}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? '가져오는 중...' : '가져오기 실행'}
        </button>
      </div>

      {result && (
        <div className="space-y-3 rounded-md border p-4">
          <h2 className="font-semibold">가져오기 결과</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{result.imported}</p>
              <p className="text-muted-foreground">가져옴</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{result.skipped}</p>
              <p className="text-muted-foreground">스킵</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold text-red-600">
                {result.errors.length}
              </p>
              <p className="text-muted-foreground">오류</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-500">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <a
              href="/products"
              className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
            >
              상품 목록으로
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

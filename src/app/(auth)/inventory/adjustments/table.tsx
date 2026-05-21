'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { toast } from 'sonner'
import { BulkAdjustmentDialog } from '../bulk-adjustment-dialog'

export type AdjustmentSlipRow = {
  id: string
  sku: string
  productName: string
  optionName: string | null
  warehouseZone: string | null
  delta: number
  status: 'pending' | 'confirmed'
  createdAt: string | Date
  confirmedAt: string | Date | null
  registeredByName: string | null
}

type Props = {
  data: AdjustmentSlipRow[]
  total: number
  page: number
  pageSize: number
  warehouseZones: string[]
}

function formatDate(value: string | Date | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function InventoryAdjustmentsTable({ data, total, page, pageSize, warehouseZones }: Props) {
  const router = useRouter()
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [isPending, startTransition] = useTransition()
  const [filters, setFilters] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(25),
    movement: parseAsString.withDefault('all'),
    status: parseAsString.withDefault('all'),
    dateField: parseAsString.withDefault('movement'),
    dateFrom: parseAsString,
    dateTo: parseAsString,
    search: parseAsString,
    warehouseZone: parseAsString,
  }, { shallow: false })

  const selectedIds = useMemo(
    () => data.filter((row) => selected[row.id] && row.status === 'pending').map((row) => row.id),
    [data, selected],
  )
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function updateFilter(patch: Partial<typeof filters>) {
    void setFilters({ ...patch, page: 1 })
  }

  function confirmSelected() {
    if (selectedIds.length === 0) return
    startTransition(async () => {
      const res = await fetch('/api/inventory/adjustments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slipIds: selectedIds }),
      })
      const body = await res.json().catch(() => null) as { success?: number; failed?: number; error?: string } | null
      if (!res.ok) {
        toast.error(body?.error ?? '전표 확정에 실패했습니다.')
        return
      }
      toast.success(`전표 ${body?.success ?? 0}건 확정`)
      setSelected({})
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 rounded-md border bg-white p-3 md:grid-cols-[110px_120px_130px_130px_130px_1fr_auto]">
        <select
          value={filters.movement}
          onChange={(event) => updateFilter({ movement: event.target.value })}
          className="rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="all">전체</option>
          <option value="incoming">입고</option>
          <option value="outgoing">출고</option>
        </select>
        <select
          value={filters.status}
          onChange={(event) => updateFilter({ status: event.target.value })}
          className="rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="all">전표 전체</option>
          <option value="pending">미확정</option>
          <option value="confirmed">확정</option>
        </select>
        <select
          value={filters.dateField}
          onChange={(event) => updateFilter({ dateField: event.target.value })}
          className="rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="movement">입출고일</option>
          <option value="incoming">입고일</option>
          <option value="outgoing">출고일</option>
          <option value="confirmed">확정일</option>
        </select>
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(event) => updateFilter({ dateFrom: event.target.value || null })}
          className="rounded-md border px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(event) => updateFilter({ dateTo: event.target.value || null })}
          className="rounded-md border px-2 py-1.5 text-sm"
        />
        <div className="flex gap-2">
          <select
            value={filters.warehouseZone ?? ''}
            onChange={(event) => updateFilter({ warehouseZone: event.target.value || null })}
            className="w-32 rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="">창고 전체</option>
            {warehouseZones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
          <input
            value={filters.search ?? ''}
            onChange={(event) => void setFilters({ search: event.target.value || null, page: 1 })}
            placeholder="상품코드/상품명/옵션명"
            className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void setFilters({
            page: 1,
            movement: 'all',
            status: 'all',
            dateField: 'movement',
            dateFrom: null,
            dateTo: null,
            search: null,
            warehouseZone: null,
          })}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          초기화
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-muted/10 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => void setFilters({ page: page - 1 })}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            이전
          </button>
          <span>{page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => void setFilters({ page: page + 1 })}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            다음
          </button>
          <select
            value={pageSize}
            onChange={(event) => void setFilters({ pageSize: Number(event.target.value), page: 1 })}
            className="rounded border px-2 py-1"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>{size}건</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/api/inventory/adjustments/template"
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
          >
            엑셀양식 다운로드
          </Link>
          <button
            type="button"
            onClick={confirmSelected}
            disabled={isPending || selectedIds.length === 0}
            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
          >
            선택 확정({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            대량등록
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-md border bg-white">
        <table className="w-full min-w-[1120px] border-collapse text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-20 border-b px-2 py-2 text-left font-medium">No.</th>
              <th className="w-24 border-b px-2 py-2 text-left font-medium">전표상태</th>
              <th className="border-b px-2 py-2 text-left font-medium">상품코드</th>
              <th className="border-b px-2 py-2 text-left font-medium">상품명</th>
              <th className="border-b px-2 py-2 text-left font-medium">옵션명</th>
              <th className="border-b px-2 py-2 text-left font-medium">창고</th>
              <th className="border-b px-2 py-2 text-right font-medium">입고수량</th>
              <th className="border-b px-2 py-2 text-right font-medium">출고수량</th>
              <th className="border-b px-2 py-2 text-left font-medium">입출고일자</th>
              <th className="border-b px-2 py-2 text-left font-medium">확정일자</th>
              <th className="border-b px-2 py-2 text-left font-medium">등록자</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-16 text-center text-sm text-muted-foreground">입출고 전표가 없습니다.</td>
              </tr>
            ) : data.map((row, index) => {
              const incoming = row.delta > 0 ? row.delta : 0
              const outgoing = row.delta < 0 ? Math.abs(row.delta) : 0
              return (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="px-2 py-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={row.status !== 'pending'}
                        checked={!!selected[row.id]}
                        onChange={(event) => setSelected((prev) => ({ ...prev, [row.id]: event.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 disabled:opacity-30"
                      />
                      <span>{total - ((page - 1) * pageSize + index)}</span>
                    </label>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`rounded border px-1.5 py-0.5 font-medium ${row.status === 'confirmed' ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                      {row.status === 'confirmed' ? '확정' : '미확정'}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono">{row.sku}</td>
                  <td className="max-w-[220px] truncate px-2 py-2" title={row.productName}>{row.productName}</td>
                  <td className="max-w-[180px] truncate px-2 py-2" title={row.optionName ?? ''}>{row.optionName ?? '-'}</td>
                  <td className="px-2 py-2">{row.warehouseZone ?? '-'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{incoming ? incoming.toLocaleString('ko-KR') : '-'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{outgoing ? outgoing.toLocaleString('ko-KR') : '-'}</td>
                  <td className="px-2 py-2">{formatDate(row.createdAt)}</td>
                  <td className="px-2 py-2">{formatDate(row.confirmedAt)}</td>
                  <td className="px-2 py-2">{row.registeredByName ?? '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {bulkOpen && (
        <BulkAdjustmentDialog
          onClose={() => {
            setBulkOpen(false)
            router.refresh()
          }}
          warehouseZones={warehouseZones}
        />
      )}
    </div>
  )
}

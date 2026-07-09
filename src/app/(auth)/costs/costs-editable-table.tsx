'use client'

import { useMemo, useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Pencil, Plus, Save, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type CostEditableRow = {
  id: string
  data: Record<string, string | null>
  updatedAt: string
}

type TableColumn =
  | { type: 'data'; header: string }
  | { type: 'collapse'; group: 'warehouse' | 'extra'; label: string }
  | { type: 'updatedAt' }
  | { type: 'purchaseUrl' }

const PURCHASE_URL_HEADER = '구매 URL'
const UPDATED_AT_HEADER = '최근 반영일'
const WAREHOUSE_GROUP = {
  label: '창고/재질',
  start: '한국창고기준 위치',
  end: '재질',
}
const EXTRA_GROUP = {
  label: '구분/반영',
  start: '품목구분',
}

function purchaseHref(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function emptyDraft(headers: readonly string[]) {
  return Object.fromEntries(headers.map((header) => [header, '']))
}

export function CostsEditableTable({
  headers,
  rows,
}: {
  headers: readonly string[]
  rows: CostEditableRow[]
}) {
  const router = useRouter()
  const [editingRow, setEditingRow] = useState<CostEditableRow | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState({ warehouse: false, extra: false })
  const [isPending, startTransition] = useTransition()
  const codeHeader = headers[0]
  const nameHeader = headers[1]

  const editableHeaders = useMemo(() => (
    isCreating ? headers : headers.filter((header) => header !== codeHeader)
  ), [codeHeader, headers, isCreating])

  const tableColumns = useMemo<TableColumn[]>(() => {
    const columns: TableColumn[] = []
    const warehouseStart = headers.indexOf(WAREHOUSE_GROUP.start)
    const warehouseEnd = headers.indexOf(WAREHOUSE_GROUP.end)
    const extraStart = headers.indexOf(EXTRA_GROUP.start)

    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index]
      if (header === PURCHASE_URL_HEADER) continue
      if (!openGroups.warehouse && index === warehouseStart && warehouseEnd >= warehouseStart) {
        columns.push({ type: 'collapse', group: 'warehouse', label: WAREHOUSE_GROUP.label })
        index = warehouseEnd
        continue
      }
      if (!openGroups.extra && index === extraStart) {
        columns.push({ type: 'collapse', group: 'extra', label: EXTRA_GROUP.label })
        break
      }
      columns.push({ type: 'data', header })
    }

    columns.push({ type: 'updatedAt' })
    columns.push({ type: 'purchaseUrl' })
    return columns
  }, [headers, openGroups.extra, openGroups.warehouse])

  function openEdit(row: CostEditableRow) {
    setIsCreating(false)
    setEditingRow(row)
    setDraft(Object.fromEntries(headers.map((header) => [header, row.data[header] ?? ''])))
    setMessage(null)
  }

  function openCreate() {
    setIsCreating(true)
    setEditingRow(null)
    setDraft(emptyDraft(headers))
    setMessage(null)
  }

  function close() {
    if (isPending) return
    setEditingRow(null)
    setIsCreating(false)
    setDraft({})
    setMessage(null)
  }

  function save() {
    if (!editingRow && !isCreating) return
    setMessage(null)
    startTransition(async () => {
      const response = await fetch(isCreating ? '/api/purchasing/items' : `/api/purchasing/items/${editingRow!.id}`, {
        method: isCreating ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: Object.fromEntries(headers.map((header) => [header, draft[header] ?? null])),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(body.error ?? (isCreating ? '품목 추가에 실패했습니다.' : '품목 수정에 실패했습니다.'))
        return
      }
      setEditingRow(null)
      setIsCreating(false)
      setDraft({})
      router.refresh()
    })
  }

  function toggleGroup(group: keyof typeof openGroups) {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }))
  }

  function renderHeader(header: string) {
    if (header === WAREHOUSE_GROUP.start) {
      return (
        <HeaderToggle label={header} expanded={openGroups.warehouse} onToggle={() => toggleGroup('warehouse')} />
      )
    }
    if (header === EXTRA_GROUP.start) {
      return (
        <HeaderToggle label={header} expanded={openGroups.extra} onToggle={() => toggleGroup('extra')} />
      )
    }
    return header
  }

  function renderCell(row: CostEditableRow, header: string) {
    const value = row.data[header]
    if (header !== PURCHASE_URL_HEADER) return value || '-'

    const href = purchaseHref(value)
    if (!href) return '-'

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
        onClick={(event) => event.stopPropagation()}
        title={value ?? undefined}
      >
        <span className="truncate">{value}</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>
    )
  }

  const modalOpen = isCreating || editingRow

  return (
    <>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus />
          품목 추가
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full table-auto text-sm">
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="border-b">
              {tableColumns.map((column, index) => {
                if (column.type === 'collapse') {
                  return (
                    <CollapsedHeader
                      key={`${column.group}-${index}`}
                      label={column.label}
                      onToggle={() => toggleGroup(column.group)}
                    />
                  )
                }
                if (column.type === 'updatedAt') {
                  return <th key="updated-at" className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{UPDATED_AT_HEADER}</th>
                }
                if (column.type === 'purchaseUrl') {
                  return <th key="purchase-url" className="w-[240px] px-3 py-2.5 text-left font-medium">{PURCHASE_URL_HEADER}</th>
                }
                return (
                  <th key={column.header} className={headerClassName(column.header)}>
                    {renderHeader(column.header)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={tableColumns.length} className="h-40 text-center text-muted-foreground">
                  표시할 품목이 없습니다. ESA009M 양식을 업로드하거나 품목을 추가해주세요.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b hover:bg-muted/40 focus-within:bg-muted/40"
                onClick={() => openEdit(row)}
              >
                {tableColumns.map((column, index) => {
                  if (column.type === 'collapse') return <CollapsedCell key={`${row.id}-${column.group}-${index}`} />
                  if (column.type === 'updatedAt') {
                    return (
                      <td key={`${row.id}-updated-at`} className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {new Date(row.updatedAt).toLocaleString('ko-KR')}
                      </td>
                    )
                  }
                  if (column.type === 'purchaseUrl') {
                    return (
                      <td
                        key={`${row.id}-purchase-url`}
                        className="max-w-[280px] px-3 py-2 align-top"
                        title={row.data[PURCHASE_URL_HEADER] ?? undefined}
                      >
                        {renderCell(row, PURCHASE_URL_HEADER)}
                      </td>
                    )
                  }
                  return (
                    <td
                      key={`${row.id}-${column.header}`}
                      className={`px-3 py-2 align-top ${cellClassName(column.header, nameHeader)}`}
                      title={row.data[column.header] ?? undefined}
                    >
                      {renderCell(row, column.header)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-md border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  {isCreating ? <Plus className="size-4" /> : <Pencil className="size-4" />}
                  {isCreating ? '품목 추가' : '품목 수정'}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {draft[codeHeader] || '새 품목'} · {draft[nameHeader] || '품목명'}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="닫기">
                <X />
              </Button>
            </div>

            <div className="grid gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
              {!isCreating ? (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{codeHeader}</span>
                  <Input value={draft[codeHeader] ?? ''} disabled className="font-mono text-xs" />
                </label>
              ) : null}
              {editableHeaders.map((header) => (
                <label key={header} className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{header}</span>
                  <Input
                    type={header === PURCHASE_URL_HEADER ? 'url' : 'text'}
                    value={draft[header] ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, [header]: event.target.value }))}
                    className={header === codeHeader ? 'font-mono text-xs' : 'text-xs'}
                    required={isCreating && (header === codeHeader || header === nameHeader)}
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-destructive">{message}</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={isPending}>취소</Button>
                <Button type="button" onClick={save} disabled={isPending}>
                  <Save />
                  {isPending ? '저장 중' : '저장'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function HeaderToggle({
  label,
  expanded,
  onToggle,
}: {
  label: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="inline-flex size-6 items-center justify-center rounded border bg-background hover:bg-muted"
        onClick={onToggle}
        aria-label={`${label} 접기`}
      >
        {expanded ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      {label}
    </span>
  )
}

function CollapsedHeader({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <th className="w-9 border-x bg-muted/70 px-1 py-2 text-center align-middle">
      <button
        type="button"
        className="mx-auto flex h-24 w-7 items-center justify-center rounded border bg-background text-[11px] font-medium hover:bg-muted"
        onClick={onToggle}
        aria-label={`${label} 펼치기`}
        title={`${label} 펼치기`}
      >
        <span className="flex rotate-90 items-center gap-1 whitespace-nowrap">
          <ChevronRight className="size-3" />
          {label}
        </span>
      </button>
    </th>
  )
}

function CollapsedCell() {
  return <td className="w-9 border-x bg-muted/20 px-1" />
}

function headerClassName(header: string) {
  const base = 'whitespace-nowrap px-3 py-2.5 text-left font-medium'
  if (header === '품목코드') return `${base} w-28`
  if (header === '품목명') return `${base} w-[260px]`
  if (header === PURCHASE_URL_HEADER) return `${base} w-20`
  return base
}

function cellClassName(header: string, nameHeader: string) {
  if (header === nameHeader) return 'w-[260px] min-w-[220px] whitespace-normal font-medium'
  if (header === '품목코드') return 'w-28 whitespace-nowrap font-mono text-xs text-muted-foreground'
  if (header === PURCHASE_URL_HEADER) return 'w-20 whitespace-nowrap'
  return 'whitespace-nowrap'
}

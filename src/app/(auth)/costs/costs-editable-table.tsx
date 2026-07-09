'use client'

import { useMemo, useState, useTransition } from 'react'
import { Pencil, Save, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type CostEditableRow = {
  id: string
  data: Record<string, string | null>
  updatedAt: string
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
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const codeHeader = headers[0]
  const nameHeader = headers[1]

  const editableHeaders = useMemo(() => headers.filter((header) => header !== codeHeader), [codeHeader, headers])

  function open(row: CostEditableRow) {
    setEditingRow(row)
    setDraft(Object.fromEntries(headers.map((header) => [header, row.data[header] ?? ''])))
    setMessage(null)
  }

  function close() {
    if (isPending) return
    setEditingRow(null)
    setDraft({})
    setMessage(null)
  }

  function save() {
    if (!editingRow) return
    setMessage(null)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/items/${editingRow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: Object.fromEntries(headers.map((header) => [header, draft[header] ?? null])),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(body.error ?? '품목 수정에 실패했습니다.')
        return
      }
      setEditingRow(null)
      setDraft({})
      router.refresh()
    })
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-max text-sm">
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="border-b">
              {headers.map((header) => (
                <th key={header} className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{header}</th>
              ))}
              <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium">최근 반영일</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length + 1} className="h-40 text-center text-muted-foreground">
                  표시할 품목이 없습니다. ESA009M 엑셀을 업로드해주세요.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b hover:bg-muted/40 focus-within:bg-muted/40"
                onClick={() => open(row)}
              >
                {headers.map((header) => (
                  <td
                    key={header}
                    className={`max-w-80 px-3 py-2 align-top ${header === nameHeader ? 'whitespace-normal' : 'whitespace-nowrap'}`}
                    title={row.data[header] ?? undefined}
                  >
                    {row.data[header] || '-'}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {new Date(row.updatedAt).toLocaleString('ko-KR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-md border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Pencil className="size-4" />
                  품목 수정
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {draft[codeHeader]} · {draft[nameHeader]}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="닫기">
                <X />
              </Button>
            </div>

            <div className="grid gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{codeHeader}</span>
                <Input value={draft[codeHeader] ?? ''} disabled className="font-mono text-xs" />
              </label>
              {editableHeaders.map((header) => (
                <label key={header} className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{header}</span>
                  <Input
                    value={draft[header] ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, [header]: event.target.value }))}
                    className="text-xs"
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

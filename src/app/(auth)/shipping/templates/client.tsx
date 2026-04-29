'use client'

import { useState } from 'react'
import type { CarrierTemplate, CarrierTemplateColumn } from '@/lib/shipping/types'
import type { OrderFieldDef } from '@/lib/shipping/excel/templates'

interface TemplateClientProps {
  availableFields: OrderFieldDef[]
  /** 편집 대상 (있으면 수정 모드, 없으면 생성 모드) */
  editing?: CarrierTemplate | null
  onCreateAction: (formData: FormData) => Promise<void>
  onUpdateAction: (formData: FormData) => Promise<void>
  onCancelAction?: () => void
}

/**
 * 엑셀 양식 빌더 — 택배사 종속을 제거하고 자유롭게 헤더/너비를 편집한다.
 * 생성/수정 겸용 (editing prop 으로 분기).
 */
export function TemplateClient({
  availableFields,
  editing,
  onCreateAction,
  onUpdateAction,
  onCancelAction,
}: TemplateClientProps) {
  const isEditing = !!editing
  const [showForm, setShowForm] = useState(isEditing)
  const [name, setName] = useState(editing?.name ?? '')
  const [columns, setColumns] = useState<CarrierTemplateColumn[]>(editing?.columns ?? [])
  const [selectedField, setSelectedField] = useState(availableFields[0]?.field ?? '')

  const addColumn = () => {
    const fieldDef = availableFields.find((f) => f.field === selectedField)
    if (!fieldDef) return
    setColumns((prev) => [
      ...prev,
      { header: fieldDef.label, field: fieldDef.field, width: 15, required: false },
    ])
  }

  const removeColumn = (index: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== index))
  }

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    setColumns((prev) => {
      const newCols = [...prev]
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= newCols.length) return prev
      ;[newCols[index], newCols[swapIndex]] = [newCols[swapIndex], newCols[index]]
      return newCols
    })
  }

  const updateColumn = (index: number, patch: Partial<CarrierTemplateColumn>) => {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const reset = () => {
    setShowForm(false)
    setName('')
    setColumns([])
    onCancelAction?.()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const formData = new FormData()
    formData.set('name', name)
    formData.set('columns', JSON.stringify(columns))
    if (isEditing) {
      formData.set('templateId', editing!.id)
      await onUpdateAction(formData)
    } else {
      await onCreateAction(formData)
    }
    reset()
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        새 양식 만들기
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">
        {isEditing ? `양식 수정: ${editing!.name}` : '새 양식 만들기'}
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-name" className="mb-1 block text-sm font-medium">
            양식 이름
          </label>
          <input
            id="new-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 우리회사 출고용, 거래처A 양식"
            className="w-full rounded-md border px-3 py-2 text-sm"
            required
          />
        </div>

        {/* Column builder */}
        <div>
          <label className="mb-2 block text-sm font-medium">
            열 구성 <span className="text-xs text-muted-foreground">(헤더와 너비를 자유롭게 수정 가능)</span>
          </label>

          {/* Add column */}
          <div className="mb-3 flex items-center gap-2">
            <select
              value={selectedField}
              onChange={(e) => setSelectedField(e.target.value)}
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            >
              {availableFields.map((f) => (
                <option key={f.field} value={f.field}>
                  {f.label} ({f.field})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addColumn}
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              + 추가
            </button>
          </div>

          {/* Column list — header text & width 인라인 편집 */}
          {columns.length > 0 && (
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[2rem_1fr_8rem_5rem_6rem] items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>#</span>
                <span>헤더 (Excel 표시 텍스트)</span>
                <span>필드</span>
                <span>너비</span>
                <span className="text-right">동작</span>
              </div>
              {columns.map((col, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[2rem_1fr_8rem_5rem_6rem] items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                >
                  <span className="text-center text-xs text-muted-foreground">{idx + 1}</span>
                  <input
                    type="text"
                    value={col.header}
                    onChange={(e) => updateColumn(idx, { header: e.target.value })}
                    className="rounded border px-2 py-1 text-sm"
                  />
                  <span className="truncate font-mono text-xs text-muted-foreground" title={col.field}>
                    {col.field}
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={col.width}
                    onChange={(e) => updateColumn(idx, { width: Number(e.target.value) || 15 })}
                    className="rounded border px-2 py-1 text-sm"
                  />
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => moveColumn(idx, 'up')}
                      disabled={idx === 0}
                      className="rounded px-1.5 text-xs hover:bg-muted disabled:opacity-30"
                      aria-label="위로"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveColumn(idx, 'down')}
                      disabled={idx === columns.length - 1}
                      className="rounded px-1.5 text-xs hover:bg-muted disabled:opacity-30"
                      aria-label="아래로"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeColumn(idx)}
                      className="rounded px-1.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700"
                      aria-label="삭제"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!name || columns.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isEditing ? '수정 저장' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}

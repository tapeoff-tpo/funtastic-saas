'use client'

import { useState } from 'react'
import type { CarrierTemplateColumn } from '@/lib/shipping/types'
import type { OrderFieldDef } from '@/lib/shipping/excel/templates'

interface TemplateClientProps {
  carriers: Array<{ code: string; name: string }>
  availableFields: OrderFieldDef[]
  onCreateAction: (formData: FormData) => Promise<void>
  onUpdateAction: (formData: FormData) => Promise<void>
}

/**
 * Client component for creating/editing carrier templates.
 * Provides interactive column builder with add/remove/reorder.
 */
export function TemplateClient({
  carriers,
  availableFields,
  onCreateAction,
}: TemplateClientProps) {
  const [showForm, setShowForm] = useState(false)
  const [carrierId, setCarrierId] = useState(carriers[0]?.code ?? '')
  const [name, setName] = useState('')
  const [columns, setColumns] = useState<CarrierTemplateColumn[]>([])
  const [selectedField, setSelectedField] = useState(availableFields[0]?.field ?? '')

  const addColumn = () => {
    const fieldDef = availableFields.find((f) => f.field === selectedField)
    if (!fieldDef) return

    setColumns((prev) => [
      ...prev,
      {
        header: fieldDef.label,
        field: fieldDef.field,
        width: 15,
        required: false,
      },
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const formData = new FormData()
    formData.set('carrierId', carrierId)
    formData.set('name', name)
    formData.set('columns', JSON.stringify(columns))
    await onCreateAction(formData)
    setShowForm(false)
    setName('')
    setColumns([])
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
      <h3 className="mb-4 text-lg font-semibold">새 양식 만들기</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="new-carrier" className="mb-1 block text-sm font-medium">
              택배사
            </label>
            <select
              id="new-carrier"
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {carriers.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-name" className="mb-1 block text-sm font-medium">
              양식 이름
            </label>
            <input
              id="new-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="양식 이름"
              className="w-full rounded-md border px-3 py-2 text-sm"
              required
            />
          </div>
        </div>

        {/* Column builder */}
        <div>
          <label className="mb-2 block text-sm font-medium">열 구성</label>

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
              추가
            </button>
          </div>

          {/* Column list */}
          {columns.length > 0 && (
            <div className="rounded-md border">
              {columns.map((col, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                >
                  <span className="w-6 text-center text-xs text-muted-foreground">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm">{col.header}</span>
                  <span className="font-mono text-xs text-muted-foreground">{col.field}</span>
                  <button
                    type="button"
                    onClick={() => moveColumn(idx, 'up')}
                    disabled={idx === 0}
                    className="px-1 text-xs disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveColumn(idx, 'down')}
                    disabled={idx === columns.length - 1}
                    className="px-1 text-xs disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeColumn(idx)}
                    className="px-1 text-xs text-red-500 hover:text-red-700"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!name || columns.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            저장
          </button>
        </div>
      </form>
    </div>
  )
}

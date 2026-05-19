'use client'

import { useState } from 'react'
import type { CarrierTemplate, CarrierTemplateColumn } from '@/lib/shipping/types'
import type { OrderFieldDef } from '@/lib/shipping/excel/templates'

/** 합치기 구분자 프리셋 — value 는 실제 join 문자열, label 은 화면 표시용 */
const JOIN_SEPARATORS: { value: string; label: string }[] = [
  { value: ' ', label: '공백' },
  { value: '[,]', label: '[,]' },
  { value: '(,)', label: '(,)' },
  { value: ' / ', label: ' / ' },
  { value: '#', label: '#' },
  { value: '<,>', label: '<,>' },
]

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
  const fieldLabelMap = new Map(availableFields.map((field) => [field.field, field.label]))
  const getFieldLabel = (field: string) => fieldLabelMap.get(field) ?? field
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

  const addExtraField = (index: number, field: string) => {
    if (!field) return
    setColumns((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c
        const current = c.extraFields ?? []
        if (c.field === field || current.includes(field)) return c
        return { ...c, extraFields: [...current, field] }
      }),
    )
  }

  const removeExtraField = (index: number, field: string) => {
    setColumns((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c
        const next = (c.extraFields ?? []).filter((f) => f !== field)
        return { ...c, extraFields: next.length > 0 ? next : undefined }
      }),
    )
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
            열 구성 <span className="text-xs text-muted-foreground">(헤더와 출력내용을 자유롭게 수정 가능 — 출력내용에 값을 넣으면 모든 행에 고정값이 채워집니다)</span>
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
                  {f.label}
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

          {/* Column list — header text & 출력내용(고정값) 인라인 편집 */}
          {columns.length > 0 && (
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[2rem_1fr_16rem_1fr_6rem] items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>#</span>
                <span>헤더 <span className="normal-case text-[10px] text-muted-foreground/80">(Excel 표시 텍스트)</span></span>
                <span>출력 항목 <span className="normal-case text-[10px] text-muted-foreground/80">(실제 출력 데이터 + 합치기)</span></span>
                <span>출력내용 <span className="normal-case text-[10px] text-muted-foreground/80">(비우면 자동, 입력 시 모든 행에 고정)</span></span>
                <span className="text-right">동작</span>
              </div>
              {columns.map((col, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[2rem_1fr_16rem_1fr_6rem] items-start gap-2 border-b px-3 py-1.5 last:border-b-0"
                >
                  <span className="pt-1.5 text-center text-xs text-muted-foreground">{idx + 1}</span>
                  <input
                    type="text"
                    value={col.header}
                    onChange={(e) => updateColumn(idx, { header: e.target.value })}
                    className="rounded border px-2 py-1 text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <select
                      value={col.field}
                      onChange={(e) => updateColumn(idx, { field: e.target.value })}
                      className="rounded border bg-white px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                      aria-label="출력 항목 선택"
                      title="이 컬럼에 들어갈 데이터 항목"
                    >
                      {availableFields.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label}
                        </option>
                      ))}
                      {/* 현재 col.field 가 availableFields 에 없을 수 있으므로 fallback */}
                      {!availableFields.some((f) => f.field === col.field) && (
                        <option value={col.field}>{col.field}</option>
                      )}
                    </select>
                    {(col.extraFields ?? []).map((extra) => (
                      <span
                        key={extra}
                        className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700"
                      >
                        + {getFieldLabel(extra)}
                        <button
                          type="button"
                          onClick={() => removeExtraField(idx, extra)}
                          className="text-emerald-500 hover:text-emerald-800"
                          aria-label={`${getFieldLabel(extra)} 합치기 해제`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      onChange={(e) => {
                        addExtraField(idx, e.target.value)
                        e.currentTarget.value = ''
                      }}
                      className="rounded border bg-white px-1 py-0.5 text-[11px] text-muted-foreground"
                      aria-label="필드 합치기"
                      title="이 컬럼에 합칠 필드 선택"
                    >
                      <option value="">+ 합치기</option>
                      {availableFields
                        .filter(
                          (f) =>
                            f.field !== col.field &&
                            !(col.extraFields ?? []).includes(f.field),
                        )
                        .map((f) => (
                          <option key={f.field} value={f.field}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                    {(col.extraFields ?? []).length > 0 && (
                      <select
                        value={col.joinSeparator ?? ' '}
                        onChange={(e) => updateColumn(idx, { joinSeparator: e.target.value })}
                        className="rounded border bg-white px-1 py-0.5 text-[11px]"
                        aria-label="구분자"
                        title="합쳐진 값 사이에 들어갈 구분자"
                      >
                        {JOIN_SEPARATORS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <input
                    type="text"
                    value={col.fixedValue ?? ''}
                    onChange={(e) => updateColumn(idx, { fixedValue: e.target.value })}
                    placeholder="자동 (필드값 사용)"
                    className="rounded border px-2 py-1 text-sm"
                  />
                  <div className="flex items-center justify-end gap-1 pt-0.5">
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

'use client'

import { useState, useEffect, useCallback } from 'react'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, type ExcelMapping } from './actions'

const PRODUCT_FIELDS = [
  { value: 'internal_sku', label: '상품코드 (필수)', required: true },
  { value: 'name', label: '상품명' },
  { value: 'cost_price', label: '원가' },
  { value: 'base_price', label: '판매가' },
  { value: 'warehouse_location', label: '창고위치' },
  { value: 'category_id', label: '카테고리' },
  { value: 'description', label: '설명' },
]

interface Template {
  id: string
  name: string
  mappings: ExcelMapping[]
  isDefault: boolean
}

export default function ExcelTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => {
    const data = await getTemplates()
    setTemplates(data as Template[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const handleNew = () => {
    setIsNew(true)
    setEditing({
      id: '',
      name: '',
      mappings: [{ field: 'internal_sku', excelColumn: '' }],
      isDefault: false,
    })
  }

  const handleEdit = (t: Template) => {
    setIsNew(false)
    setEditing({ ...t, mappings: [...t.mappings] })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('이 양식을 삭제하시겠습니까?')) return
    await deleteTemplate(id)
    await load()
  }

  const handleSave = async () => {
    if (!editing) return
    try {
      if (isNew) {
        await createTemplate(editing.name, editing.mappings)
      } else {
        await updateTemplate(editing.id, editing.name, editing.mappings, editing.isDefault)
      }
      setEditing(null)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장 실패')
    }
  }

  const addMapping = () => {
    if (!editing) return
    setEditing({
      ...editing,
      mappings: [...editing.mappings, { field: '', excelColumn: '' }],
    })
  }

  const removeMapping = (index: number) => {
    if (!editing) return
    setEditing({
      ...editing,
      mappings: editing.mappings.filter((_, i) => i !== index),
    })
  }

  const updateMapping = (index: number, key: 'field' | 'excelColumn', value: string) => {
    if (!editing) return
    const updated = editing.mappings.map((m, i) =>
      i === index ? { ...m, [key]: value } : m
    )
    setEditing({ ...editing, mappings: updated })
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">로딩 중...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">엑셀 양식 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            상품 일괄 업로드 시 사용할 엑셀 컬럼 매핑을 설정합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
        >
          양식 추가
        </button>
      </div>

      {/* Template list */}
      {templates.length === 0 && !editing ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          등록된 양식이 없습니다. 양식을 추가해주세요.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  {t.isDefault && (
                    <span className="rounded bg-black px-1.5 py-0.5 text-xs text-white">기본</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.mappings.map((m) => {
                    const label = PRODUCT_FIELDS.find((f) => f.value === m.field)?.label ?? m.field
                    return `${label} = "${m.excelColumn}"`
                  }).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleEdit(t)}
                  className="rounded px-2 py-1 text-sm hover:bg-muted"
                >
                  편집
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(t.id)}
                  className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold">
              {isNew ? '양식 추가' : '양식 편집'}
            </h3>

            <div className="mt-4 space-y-4">
              {/* Name */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">양식 이름</label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="예: 이카운트 ESA009M"
                  className="rounded-md border px-3 py-1.5 text-sm"
                />
              </div>

              {/* Default checkbox */}
              {!isNew && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.isDefault}
                    onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  기본 양식으로 설정
                </label>
              )}

              {/* Mappings */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">컬럼 매핑</label>
                  <button
                    type="button"
                    onClick={addMapping}
                    className="rounded border px-2 py-1 text-xs hover:bg-muted"
                  >
                    매핑 추가
                  </button>
                </div>
                <div className="space-y-2">
                  {editing.mappings.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={m.field}
                        onChange={(e) => updateMapping(idx, 'field', e.target.value)}
                        className="flex-1 rounded-md border px-2 py-1.5 text-sm"
                      >
                        <option value="">필드 선택</option>
                        {PRODUCT_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">=</span>
                      <input
                        type="text"
                        value={m.excelColumn}
                        onChange={(e) => updateMapping(idx, 'excelColumn', e.target.value)}
                        placeholder="엑셀 컬럼명"
                        className="flex-1 rounded-md border px-2 py-1.5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeMapping(idx)}
                        className="rounded px-1.5 py-1 text-xs text-red-500 hover:bg-red-50"
                      >
                        X
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, X, RefreshCw } from 'lucide-react'

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡', naver: '네이버', gmarket: 'G마켓', auction: '옥션',
  '11st': '11번가', cafe24: 'Cafe24', ohouse: '오늘의집', kakao: '카카오',
  ably: '에이블리', ssgmall: 'SSG몰',
}
const marketLabel = (id: string) => MARKETPLACE_LABELS[id] ?? id

interface MappingCodeRow {
  id: string
  code: string
  name: string
  note: string | null
  isActive: boolean
  sourcesCount: number
  componentsCount: number
  updatedAt: string
}

interface UnmappedItem {
  marketplaceId: string
  marketplaceItemId: string
  productName: string | null
  optionText: string | null
  occurrences: number
  lastSeenAt: string | null
}

interface SourceForm {
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
  productNameSnapshot: string
  optionNameSnapshot: string
}
interface ComponentForm {
  sku: string
  quantity: number
}
interface FormState {
  id: string | null
  code: string
  name: string
  note: string
  isActive: boolean
  sources: SourceForm[]
  components: ComponentForm[]
}

const emptyForm = (): FormState => ({
  id: null, code: '', name: '', note: '', isActive: true,
  sources: [], components: [{ sku: '', quantity: 1 }],
})

export function MappingManager() {
  const [codes, setCodes] = useState<MappingCodeRow[]>([])
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [codesRes, unmappedRes] = await Promise.all([
        fetch('/api/products/mapping-codes').then((r) => r.json()),
        fetch('/api/products/mapping-codes/unmapped').then((r) => r.json()),
      ])
      setCodes(codesRes.codes ?? [])
      setUnmapped(unmappedRes.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const filtered = codes.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  })

  async function openCreate(prefillSource?: UnmappedItem) {
    const form = emptyForm()
    if (prefillSource) {
      form.name = prefillSource.productName ?? ''
      form.sources.push({
        marketplaceId: prefillSource.marketplaceId,
        marketplaceProductId: prefillSource.marketplaceItemId,
        marketplaceOptionId: '',
        productNameSnapshot: prefillSource.productName ?? '',
        optionNameSnapshot: prefillSource.optionText ?? '',
      })
    }
    setEditing(form)
  }

  async function openEdit(id: string) {
    const res = await fetch(`/api/products/mapping-codes/${id}`)
    if (!res.ok) return alert('매핑코드를 불러올 수 없습니다')
    const data = await res.json()
    setEditing({
      id: data.code.id,
      code: data.code.code,
      name: data.code.name,
      note: data.code.note ?? '',
      isActive: data.code.isActive,
      sources: (data.sources ?? []).map((s: {
        marketplaceId: string; marketplaceProductId: string; marketplaceOptionId: string
        productNameSnapshot: string | null; optionNameSnapshot: string | null
      }) => ({
        marketplaceId: s.marketplaceId,
        marketplaceProductId: s.marketplaceProductId,
        marketplaceOptionId: s.marketplaceOptionId ?? '',
        productNameSnapshot: s.productNameSnapshot ?? '',
        optionNameSnapshot: s.optionNameSnapshot ?? '',
      })),
      components: (data.components ?? []).map((c: { sku: string; quantity: number }) => ({
        sku: c.sku, quantity: c.quantity,
      })),
    })
  }

  async function handleSave() {
    if (!editing) return
    if (!editing.code.trim() || !editing.name.trim()) {
      return alert('매핑코드와 이름을 입력하세요')
    }
    if (editing.components.length === 0 || editing.components.some((c) => !c.sku.trim())) {
      return alert('SKU 구성품을 1개 이상 입력하세요')
    }

    setSaving(true)
    try {
      const url = editing.id
        ? `/api/products/mapping-codes/${editing.id}`
        : '/api/products/mapping-codes'
      const method = editing.id ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: editing.code.trim(),
          name: editing.name.trim(),
          note: editing.note.trim() || null,
          isActive: editing.isActive,
          sources: editing.sources.filter((s) => s.marketplaceId && s.marketplaceProductId).map((s) => ({
            marketplaceId: s.marketplaceId,
            marketplaceProductId: s.marketplaceProductId.trim(),
            marketplaceOptionId: s.marketplaceOptionId.trim(),
            productNameSnapshot: s.productNameSnapshot.trim() || null,
            optionNameSnapshot: s.optionNameSnapshot.trim() || null,
          })),
          components: editing.components.filter((c) => c.sku.trim()).map((c) => ({
            sku: c.sku.trim(),
            quantity: c.quantity,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return alert(err.error ?? '저장 실패')
      }
      setEditing(null)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, code: string) {
    if (!confirm(`매핑코드 "${code}" 를 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/products/mapping-codes/${id}`, { method: 'DELETE' })
    if (!res.ok) return alert('삭제 실패')
    await reload()
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      {/* 좌측 — 매핑코드 목록 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="코드 또는 이름 검색"
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          />
          <Button onClick={() => openCreate()} size="sm">
            <Plus className="size-3.5" />
            신규 매핑
          </Button>
          <Button onClick={() => void reload()} size="sm" variant="outline">
            <RefreshCw className="size-3.5" />
            새로고침
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">매핑코드</th>
                <th className="px-3 py-2 text-left font-medium">이름</th>
                <th className="px-3 py-2 text-right font-medium">마켓상품</th>
                <th className="px-3 py-2 text-right font-medium">구성품</th>
                <th className="px-3 py-2 text-center font-medium">상태</th>
                <th className="px-3 py-2 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">불러오는 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">
                  {search ? '검색 결과가 없습니다' : '매핑코드가 없습니다. 우측 미매핑 목록에서 항목을 클릭해 추가하거나, 신규 매핑 버튼을 누르세요.'}
                </td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => void openEdit(c.id)}
                      className="text-blue-600 hover:underline"
                    >
                      {c.code}
                    </button>
                  </td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.sourcesCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.componentsCount}</td>
                  <td className="px-3 py-2 text-center">
                    {c.isActive ? <Badge variant="secondary">활성</Badge> : <Badge variant="outline">비활성</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDelete(c.id, c.code)}
                      aria-label="삭제"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 우측 — 미매핑 마켓상품 */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">미매핑 마켓상품</h2>
          <span className="text-xs text-muted-foreground">최근 90일 · 빈도순</span>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[600px] overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중...</div>
            ) : unmapped.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">미매핑 항목 없음</div>
            ) : unmapped.map((u) => (
              <button
                key={`${u.marketplaceId}:${u.marketplaceItemId}`}
                type="button"
                onClick={() => void openCreate(u)}
                className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium">
                    {marketLabel(u.marketplaceId)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{u.occurrences}건</span>
                </div>
                <div className="mt-1 truncate text-xs">{u.productName ?? '(이름 없음)'}</div>
                {u.optionText && (
                  <div className="truncate text-[10px] text-muted-foreground">{u.optionText}</div>
                )}
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {u.marketplaceItemId}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <EditDialog
          state={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  )
}

interface DialogProps {
  state: FormState
  onChange: (s: FormState) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
}

function EditDialog({ state, onChange, onClose, onSave, saving }: DialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{state.id ? '매핑코드 편집' : '신규 매핑코드'}</h2>
          <button onClick={onClose} aria-label="닫기" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">매핑코드 *</label>
              <input
                type="text"
                value={state.code}
                onChange={(e) => onChange({ ...state, code: e.target.value })}
                placeholder="예: MC-A001"
                className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">이름 *</label>
              <input
                type="text"
                value={state.name}
                onChange={(e) => onChange({ ...state, name: e.target.value })}
                placeholder="예: 갤러그 라떼 단품"
                className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">메모</label>
            <input
              type="text"
              value={state.note}
              onChange={(e) => onChange({ ...state, note: e.target.value })}
              className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.isActive}
              onChange={(e) => onChange({ ...state, isActive: e.target.checked })}
            />
            활성
          </label>

          {/* Sources */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">마켓상품 ({state.sources.length})</label>
              <button
                type="button"
                onClick={() => onChange({
                  ...state,
                  sources: [...state.sources, {
                    marketplaceId: '', marketplaceProductId: '', marketplaceOptionId: '',
                    productNameSnapshot: '', optionNameSnapshot: '',
                  }],
                })}
                className="text-xs text-blue-600 hover:underline"
              >
                + 행 추가
              </button>
            </div>
            <div className="space-y-1">
              {state.sources.length === 0 && (
                <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  마켓상품을 추가하지 않으면 자동매핑이 동작하지 않습니다
                </div>
              )}
              {state.sources.map((s, idx) => (
                <div key={idx} className="grid grid-cols-[80px_140px_1fr_24px] items-center gap-1.5 rounded-md border p-1.5">
                  <select
                    value={s.marketplaceId}
                    onChange={(e) => {
                      const next = [...state.sources]
                      next[idx] = { ...next[idx], marketplaceId: e.target.value }
                      onChange({ ...state, sources: next })
                    }}
                    className="rounded border px-1.5 py-1 text-xs"
                  >
                    <option value="">마켓</option>
                    {Object.entries(MARKETPLACE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={s.marketplaceProductId}
                    onChange={(e) => {
                      const next = [...state.sources]
                      next[idx] = { ...next[idx], marketplaceProductId: e.target.value }
                      onChange({ ...state, sources: next })
                    }}
                    placeholder="상품ID"
                    className="rounded border px-1.5 py-1 font-mono text-xs"
                  />
                  <input
                    type="text"
                    value={s.productNameSnapshot}
                    onChange={(e) => {
                      const next = [...state.sources]
                      next[idx] = { ...next[idx], productNameSnapshot: e.target.value }
                      onChange({ ...state, sources: next })
                    }}
                    placeholder="상품명 (참조용)"
                    className="rounded border px-1.5 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => onChange({ ...state, sources: state.sources.filter((_, i) => i !== idx) })}
                    aria-label="행 제거"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Components */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">SKU 구성품 ({state.components.length}) *</label>
              <button
                type="button"
                onClick={() => onChange({
                  ...state,
                  components: [...state.components, { sku: '', quantity: 1 }],
                })}
                className="text-xs text-blue-600 hover:underline"
              >
                + 행 추가
              </button>
            </div>
            <div className="space-y-1">
              {state.components.map((c, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_24px] items-center gap-1.5 rounded-md border p-1.5">
                  <input
                    type="text"
                    value={c.sku}
                    onChange={(e) => {
                      const next = [...state.components]
                      next[idx] = { ...next[idx], sku: e.target.value }
                      onChange({ ...state, components: next })
                    }}
                    placeholder="SKU (내부 품목코드)"
                    className="rounded border px-1.5 py-1 font-mono text-xs"
                  />
                  <input
                    type="number"
                    min={1}
                    value={c.quantity}
                    onChange={(e) => {
                      const next = [...state.components]
                      next[idx] = { ...next[idx], quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }
                      onChange({ ...state, components: next })
                    }}
                    className="rounded border px-1.5 py-1 text-right text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => onChange({ ...state, components: state.components.filter((_, i) => i !== idx) })}
                    aria-label="행 제거"
                    disabled={state.components.length <= 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} size="sm">취소</Button>
            <Button onClick={onSave} disabled={saving} size="sm">
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

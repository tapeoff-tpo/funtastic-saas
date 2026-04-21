'use client'

import { useState } from 'react'
import { toast } from 'sonner'

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  '11st': '11번가',
  cafe24: 'Cafe24',
  ohouse: '오늘의집',
  kakao: '카카오',
  ably: '에이블리',
  ssgmall: 'SSG몰',
}

interface CategoryLink {
  id?: string
  marketplaceId: string
  marketplaceCategoryId: string | null
  marketplaceCategoryName: string | null
}

interface CategoryEditorProps {
  productId: string
  existingLinks: CategoryLink[]
  onSaved: () => void
}

/**
 * 상품의 마켓별 카테고리 편집 — 추가/수정
 */
export function CategoryEditor({ productId, existingLinks, onSaved }: CategoryEditorProps) {
  const [editing, setEditing] = useState(false)
  const [marketplaceId, setMarketplaceId] = useState('coupang')
  const [categoryId, setCategoryId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!categoryId.trim()) {
      toast.error('카테고리 ID를 입력하세요.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/products/marketplace-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          marketplaceId,
          categoryId: categoryId.trim(),
          categoryName: categoryName.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || '저장 실패')
        return
      }
      toast.success('카테고리가 저장되었습니다')
      setEditing(false)
      setCategoryId('')
      setCategoryName('')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
      >
        + 마켓 카테고리 추가/수정
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-md border bg-blue-50/30 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">마켓플레이스</label>
          <select
            value={marketplaceId}
            onChange={(e) => {
              setMarketplaceId(e.target.value)
              // Pre-fill from existing link if exists
              const existing = existingLinks.find((l) => l.marketplaceId === e.target.value)
              if (existing) {
                setCategoryId(existing.marketplaceCategoryId ?? '')
                setCategoryName(existing.marketplaceCategoryName ?? '')
              } else {
                setCategoryId('')
                setCategoryName('')
              }
            }}
            className="w-full rounded border px-2 py-1 text-sm"
          >
            {Object.entries(MARKETPLACE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">카테고리 ID</label>
          <input
            type="text"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="예: 80783"
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">카테고리 이름</label>
        <input
          type="text"
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
          placeholder="예: 주방용품>주방잡화>주방소품>기타주방잡화"
          className="w-full rounded border px-2 py-1 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          나중에 확인용으로 사용됩니다 (선택사항)
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => { setEditing(false); setCategoryId(''); setCategoryName('') }}
          className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !categoryId.trim()}
          className="rounded-md bg-black px-3 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

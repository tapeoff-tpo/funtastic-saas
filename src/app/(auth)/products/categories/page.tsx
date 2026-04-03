'use client'

import { useState, useEffect, useTransition } from 'react'
import type { CategoryMapping } from '@/lib/products/types'

export default function CategoryMappingPage() {
  const [isPending, startTransition] = useTransition()
  const [mappings, setMappings] = useState<CategoryMapping[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form fields
  const [formCategory, setFormCategory] = useState('')
  const [formMarketplace, setFormMarketplace] = useState('coupang')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [formCategoryName, setFormCategoryName] = useState('')

  const MARKETPLACE_OPTIONS = [
    { value: 'coupang', label: '쿠팡' },
    { value: 'naver', label: '네이버' },
    { value: 'gmarket', label: 'G마켓' },
    { value: 'auction', label: '옥션' },
    { value: '11st', label: '11번가' },
    { value: 'cafe24', label: 'Cafe24' },
  ]

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { getCategoryMappingsAction, getInternalCategoriesAction } = await import(
        '@/lib/products/ui-actions'
      )
      const [mappingData, categoryData] = await Promise.all([
        getCategoryMappingsAction(),
        getInternalCategoriesAction(),
      ])
      if (cancelled) return
      setMappings(mappingData)
      setCategories(categoryData)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const handleSave = () => {
    if (!formCategory.trim() || !formCategoryId.trim()) {
      alert('내부 카테고리와 마켓 카테고리 ID는 필수입니다.')
      return
    }

    startTransition(async () => {
      const { saveCategoryMappingAction } = await import('@/lib/products/ui-actions')
      const result = await saveCategoryMappingAction({
        internalCategory: formCategory.trim(),
        marketplaceId: formMarketplace,
        marketplaceCategoryId: formCategoryId.trim(),
        marketplaceCategoryName: formCategoryName.trim() || undefined,
      })

      if (result.success) {
        setShowForm(false)
        setFormCategory('')
        setFormCategoryId('')
        setFormCategoryName('')
        // Reload mappings
        const { getCategoryMappingsAction } = await import('@/lib/products/ui-actions')
        const updated = await getCategoryMappingsAction()
        setMappings(updated)
      } else {
        alert(`저장 실패: ${result.error}`)
      }
    })
  }

  const handleDelete = (mappingId: string) => {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) return

    startTransition(async () => {
      const { deleteCategoryMappingAction } = await import('@/lib/products/ui-actions')
      const result = await deleteCategoryMappingAction(mappingId)

      if (result.success) {
        setMappings((prev) => prev.filter((m) => m.id !== mappingId))
      } else {
        alert(`삭제 실패: ${result.error}`)
      }
    })
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        카테고리 매핑을 불러오는 중...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">카테고리 매핑</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            내부 카테고리를 마켓플레이스 카테고리에 매핑합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
        >
          매핑 추가
        </button>
      </div>

      {/* Add mapping form */}
      {showForm && (
        <div className="space-y-3 rounded-md border p-4">
          <h3 className="font-medium">새 매핑 추가</h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fm-category" className="text-xs text-muted-foreground">
                내부 카테고리
              </label>
              {categories.length > 0 ? (
                <select
                  id="fm-category"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  <option value="">선택...</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="fm-category"
                  type="text"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  placeholder="카테고리 ID"
                  className="rounded-md border px-3 py-1.5 text-sm"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="fm-marketplace" className="text-xs text-muted-foreground">
                마켓플레이스
              </label>
              <select
                id="fm-marketplace"
                value={formMarketplace}
                onChange={(e) => setFormMarketplace(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                {MARKETPLACE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="fm-cat-id" className="text-xs text-muted-foreground">
                마켓 카테고리 ID
              </label>
              <input
                id="fm-cat-id"
                type="text"
                value={formCategoryId}
                onChange={(e) => setFormCategoryId(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="fm-cat-name" className="text-xs text-muted-foreground">
                마켓 카테고리명
              </label>
              <input
                id="fm-cat-name"
                type="text"
                value={formCategoryName}
                onChange={(e) => setFormCategoryName(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* Mappings table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b">
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">내부 카테고리</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">마켓플레이스</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">마켓 카테고리 ID</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">마켓 카테고리명</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[80px]">작업</th>
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 ? (
              <tr>
                <td colSpan={5} className="h-32 text-center text-muted-foreground">
                  등록된 카테고리 매핑이 없습니다.
                </td>
              </tr>
            ) : (
              mappings.map((mapping, idx) => (
                <tr
                  key={mapping.id}
                  className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                >
                  <td className="px-3 py-2">{mapping.internalCategory}</td>
                  <td className="px-3 py-2">{mapping.marketplaceId}</td>
                  <td className="px-3 py-2 font-mono text-sm">{mapping.marketplaceCategoryId}</td>
                  <td className="px-3 py-2">{mapping.marketplaceCategoryName ?? '-'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(mapping.id)}
                      disabled={isPending}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

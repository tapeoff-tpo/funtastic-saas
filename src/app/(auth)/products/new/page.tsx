'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { VariantFormData } from '@/lib/products/types'

export default function NewProductPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Product fields
  const [name, setName] = useState('')
  const [internalSku, setInternalSku] = useState('')
  const [description, setDescription] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')

  // Variants
  const [variants, setVariants] = useState<VariantFormData[]>([])

  const addVariant = () => {
    setVariants((prev) => [
      ...prev,
      { sku: '', optionName: '', optionValues: {}, priceAdjustment: 0 },
    ])
  }

  const removeVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index))
  }

  const updateVariant = (index: number, field: keyof VariantFormData, value: string | number) => {
    setVariants((prev) =>
      prev.map((v, i) => {
        if (i !== index) return v
        if (field === 'optionValues') {
          // Parse "key=value, key2=value2" format
          const pairs = (value as string).split(',').map((p) => p.trim())
          const obj: Record<string, string> = {}
          for (const pair of pairs) {
            const [k, val] = pair.split('=').map((s) => s.trim())
            if (k && val) obj[k] = val
          }
          return { ...v, optionValues: obj }
        }
        return { ...v, [field]: value }
      }),
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim() || !internalSku.trim() || !basePrice.trim()) {
      setError('상품명, 상품코드, 판매가는 필수 항목입니다.')
      return
    }

    startTransition(async () => {
      const { createProductAction } = await import('@/lib/products/ui-actions')
      const result = await createProductAction({
        name: name.trim(),
        internalSku: internalSku.trim(),
        description: description.trim() || undefined,
        basePrice: Number(basePrice),
        costPrice: costPrice ? Number(costPrice) : undefined,
        categoryId: categoryId || undefined,
        variants: variants.map((v) => ({
          ...v,
          sku: v.sku.trim(),
          optionName: v.optionName || undefined,
          optionValues: v.optionValues && Object.keys(v.optionValues).length > 0
            ? v.optionValues
            : undefined,
          priceAdjustment: Number(v.priceAdjustment ?? 0),
        })),
      })

      if (result.success) {
        router.push(`/products/${result.data.productId}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">상품등록</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          새 상품을 등록합니다. 옵션(변형)을 추가하여 사이즈/색상 등을 관리할 수 있습니다.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic product info */}
        <div className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">기본 정보</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="name" className="text-sm font-medium">상품명 *</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="sku" className="text-sm font-medium">상품코드 (SKU) *</label>
              <input
                id="sku"
                type="text"
                value={internalSku}
                onChange={(e) => setInternalSku(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="description" className="text-sm font-medium">설명</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-md border px-3 py-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="basePrice" className="text-sm font-medium">판매가 *</label>
              <input
                id="basePrice"
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
                min="0"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="costPrice" className="text-sm font-medium">원가</label>
              <input
                id="costPrice"
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
                min="0"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="categoryId" className="text-sm font-medium">카테고리</label>
              <input
                id="categoryId"
                type="text"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                placeholder="카테고리 ID"
                className="rounded-md border px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Variant builder */}
        <div className="space-y-4 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">옵션 (변형)</h2>
            <button
              type="button"
              onClick={addVariant}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              옵션 추가
            </button>
          </div>

          {variants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              옵션이 없습니다. &quot;옵션 추가&quot;를 클릭하여 사이즈, 색상 등의 변형을 추가하세요.
            </p>
          ) : (
            <div className="space-y-3">
              {variants.map((variant, idx) => (
                <div key={idx} className="flex items-start gap-3 rounded border p-3">
                  <div className="grid flex-1 grid-cols-4 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">옵션명</label>
                      <input
                        type="text"
                        value={variant.optionName ?? ''}
                        onChange={(e) => updateVariant(idx, 'optionName', e.target.value)}
                        placeholder="색상, 사이즈 등"
                        className="rounded border px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">옵션값</label>
                      <input
                        type="text"
                        value={
                          variant.optionValues
                            ? Object.entries(variant.optionValues)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(', ')
                            : ''
                        }
                        onChange={(e) => updateVariant(idx, 'optionValues', e.target.value)}
                        placeholder="color=빨강, size=L"
                        className="rounded border px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">SKU</label>
                      <input
                        type="text"
                        value={variant.sku}
                        onChange={(e) => updateVariant(idx, 'sku', e.target.value)}
                        className="rounded border px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">가격조정</label>
                      <input
                        type="number"
                        value={variant.priceAdjustment ?? 0}
                        onChange={(e) => updateVariant(idx, 'priceAdjustment', Number(e.target.value))}
                        className="rounded border px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariant(idx)}
                    className="mt-5 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <a
            href="/products"
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </a>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? '등록 중...' : '상품 등록'}
          </button>
        </div>
      </form>
    </div>
  )
}

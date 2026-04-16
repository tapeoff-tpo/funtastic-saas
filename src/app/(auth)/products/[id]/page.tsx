'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import type { ProductDetail, VariantFormData, ProductMarketplaceLink } from '@/lib/products/types'

const SYNC_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  synced: 'default',
  pending: 'outline',
  error: 'destructive',
}

const SYNC_STATUS_LABELS: Record<string, string> = {
  synced: '동기화됨',
  pending: '대기중',
  error: '오류',
}

const FIELD_LABELS: Record<string, string> = {
  name: '상품명',
  internal_sku: '상품코드',
  base_price: '판매가',
  cost_price: '원가',
  description: '설명',
  category_id: '카테고리',
}

export default function EditProductPage() {
  const router = useRouter()
  const params = useParams()
  const productId = params.id as string

  const [isPending, startTransition] = useTransition()
  const [isSyncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // Form fields
  const [name, setName] = useState('')
  const [internalSku, setInternalSku] = useState('')
  const [description, setDescription] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [defaultCarrierId, setDefaultCarrierId] = useState('')
  const [variants, setVariants] = useState<VariantFormData[]>([])
  const [changeLogs, setChangeLogs] = useState<Array<{
    id: string; fieldName: string; oldValue: string | null; newValue: string | null; createdAt: Date | string
  }>>([])

  // Load product data
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { getProductByIdAction } = await import('@/lib/products/ui-actions')
      const data = await getProductByIdAction(productId)
      if (cancelled) return

      if (!data) {
        setError('상품을 찾을 수 없습니다.')
        setLoading(false)
        return
      }

      setProduct(data)
      setName(data.name)
      setInternalSku(data.internalSku)
      setDescription(data.description ?? '')
      setBasePrice(data.basePrice)
      setCostPrice(data.costPrice ?? '')
      setCategoryId(data.categoryId ?? '')
      setDefaultCarrierId(data.defaultCarrierId ?? '')
      setVariants(
        data.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          optionName: v.optionName ?? '',
          optionValues: v.optionValues ?? {},
          priceAdjustment: Number(v.priceAdjustment),
        })),
      )
      setLoading(false)

      const { getProductChangeLogsAction } = await import('@/lib/products/ui-actions')
      const logs = await getProductChangeLogsAction(productId)
      if (!cancelled) setChangeLogs(logs)
    }
    void load()
    return () => { cancelled = true }
  }, [productId])

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
      const { updateProductAction } = await import('@/lib/products/ui-actions')
      const result = await updateProductAction(productId, {
        name: name.trim(),
        internalSku: internalSku.trim(),
        description: description.trim() || undefined,
        basePrice: Number(basePrice),
        costPrice: costPrice ? Number(costPrice) : undefined,
        categoryId: categoryId || undefined,
        defaultCarrierId: defaultCarrierId || undefined,
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
        router.push('/products')
      } else {
        setError(result.error)
      }
    })
  }

  const handleSyncOne = async (link: ProductMarketplaceLink) => {
    setSyncing(true)
    const { syncProductAction } = await import('@/lib/products/ui-actions')
    const result = await syncProductAction(productId, link.marketplaceId, link.id)
    if (!result.success) {
      alert(`동기화 실패: ${result.error}`)
    } else {
      // Reload product to see updated sync status
      window.location.reload()
    }
    setSyncing(false)
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    const { syncAllAction } = await import('@/lib/products/ui-actions')
    const result = await syncAllAction(productId)
    if (result.success) {
      const failed = result.data.results.filter((r) => !r.success)
      if (failed.length > 0) {
        alert(`일부 마켓 동기화 실패: ${failed.map((f) => f.marketplaceId).join(', ')}`)
      }
      window.location.reload()
    } else {
      alert(`전체 동기화 실패: ${result.error}`)
    }
    setSyncing(false)
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        상품 정보를 불러오는 중...
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        {error ?? '상품을 찾을 수 없습니다.'}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">상품 수정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          상품 정보를 수정하고 마켓플레이스 동기화 상태를 확인합니다.
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

          <div className="grid grid-cols-4 gap-4">
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
            <div className="flex flex-col gap-1">
              <label htmlFor="defaultCarrierId" className="text-sm font-medium">택배사</label>
              <select
                id="defaultCarrierId"
                value={defaultCarrierId}
                onChange={(e) => setDefaultCarrierId(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                <option value="">선택 안함</option>
                <option value="cj">CJ대한통운</option>
                <option value="kyungdong">경동택배</option>
                <option value="daesin">대신택배</option>
              </select>
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
              옵션이 없습니다.
            </p>
          ) : (
            <div className="space-y-3">
              {variants.map((variant, idx) => (
                <div key={variant.id ?? `new-${idx}`} className="flex items-start gap-3 rounded border p-3">
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

        {/* Marketplace sync status */}
        {product.marketplaceLinks.length > 0 && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">마켓플레이스 연동 현황</h2>
              <button
                type="button"
                onClick={() => void handleSyncAll()}
                disabled={isSyncing}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
              >
                {isSyncing ? '동기화 중...' : '전체 동기화'}
              </button>
            </div>

            <div className="space-y-2">
              {product.marketplaceLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between rounded border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{link.marketplaceId}</span>
                      <Badge variant={SYNC_STATUS_VARIANT[link.syncStatus] ?? 'outline'}>
                        {SYNC_STATUS_LABELS[link.syncStatus] ?? link.syncStatus}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {link.lastSyncedAt && (
                        <span>
                          마지막 동기화: {new Date(link.lastSyncedAt).toLocaleString('ko-KR')}
                        </span>
                      )}
                      {link.lastSyncError && (
                        <span className="ml-2 text-red-500">
                          오류: {link.lastSyncError}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSyncOne(link)}
                    disabled={isSyncing}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    동기화
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Change log */}
        <div className="space-y-4 rounded-md border p-4">
          <h2 className="font-semibold">변경이력</h2>
          {changeLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">변경 이력이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1.5">날짜</th>
                    <th className="px-2 py-1.5">항목</th>
                    <th className="px-2 py-1.5">이전값</th>
                    <th className="px-2 py-1.5">변경값</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLogs.map((log) => (
                    <tr key={log.id} className="border-b">
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString('ko-KR')}
                      </td>
                      <td className="px-2 py-1.5">
                        {FIELD_LABELS[log.fieldName] ?? log.fieldName}
                      </td>
                      <td className="px-2 py-1.5">{log.oldValue ?? '-'}</td>
                      <td className="px-2 py-1.5 font-medium">{log.newValue ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}

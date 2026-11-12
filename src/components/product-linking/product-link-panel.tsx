'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  LINK_LABELS,
  type LinkTarget,
  type LinkChange,
} from '@/lib/product-linking/plan'
import {
  previewProductLinkAction,
  applyProductLinkAction,
  requestWorkflowPurchaseAction,
} from './actions'

type Preview = {
  itemId: string
  target: LinkTarget
  productName: string
  changes: LinkChange[]
  token: string
}

const allTargets = Object.keys(LINK_LABELS) as LinkTarget[]
function display(value: unknown) {
  if (value == null) return '미입력'
  if (Array.isArray(value))
    return value.map((entry) => entry.optionName ?? `${entry.label}: ${entry.value}`).join(' · ')
  return String(value)
}

export function ProductLinkPanel({
  itemId,
  disabled = false,
  showPurchase = false,
  initialPurchaseId,
  targets = allTargets,
  onApplied,
}: {
  itemId: string
  disabled?: boolean
  showPurchase?: boolean
  initialPurchaseId?: string | null
  targets?: LinkTarget[]
  onApplied?: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, startTransition] = useTransition()
  const [purchaseId, setPurchaseId] = useState<string | null>(initialPurchaseId ?? null)
  const router = useRouter()

  function compare(target: LinkTarget) {
    startTransition(async () => {
      setPreview(null)
      const result = await previewProductLinkAction(itemId, target)
      if (result.success) setPreview(result.preview)
      else toast.error(result.error)
    })
  }

  function apply() {
    if (!preview || preview.itemId !== itemId) return
    startTransition(async () => {
      const result = await applyProductLinkAction(
        itemId,
        preview.target,
        preview.token,
      )
      setPreview(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.changed}개 항목을 동기화했습니다.`)
      if (onApplied) onApplied()
      else router.refresh()
    })
  }

  return (
    <details className="rounded-md border bg-muted/10">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
        상품 업무 연계 · 변경 비교 후 동기화
      </summary>
      <div className="space-y-3 border-t p-3">
        <p className="text-xs text-muted-foreground">
          확정 상품명과 사방넷코드로 연결합니다. 수정한 정보를 저장한 뒤
          동기화할 항목을 선택하세요.
        </p>
        {showPurchase && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const decision = form.get('sampleDecision')
              if (decision !== 'approved' && decision !== 'skipped') return
              startTransition(async () => {
                const result = await requestWorkflowPurchaseAction(
                  itemId,
                  Number(form.get('quantity')),
                  decision,
                )
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                setPurchaseId(result.id)
                toast.success(
                  result.existing
                    ? '이미 연결된 발주 요청이 있습니다.'
                    : '발주 요청 목록에 추가했습니다.',
                )
              })
            }}
          >
            <label className="text-xs">
              샘플 결과
              <select
                name="sampleDecision"
                required
                defaultValue=""
                className="block rounded border bg-background px-2 py-1.5"
              >
                <option value="" disabled>
                  선택
                </option>
                <option value="approved">샘플 합격</option>
                <option value="skipped">샘플 생략</option>
              </select>
            </label>
            <label className="text-xs">
              발주 수량
              <input
                name="quantity"
                type="number"
                min="1"
                max="1000000"
                required
                className="block w-24 rounded border px-2 py-1.5"
              />
            </label>
            <button
              type="submit"
              disabled={disabled || pending || !!purchaseId}
              className="rounded border px-2 py-1.5 text-xs disabled:opacity-50"
            >
              정식 발주 요청 추가
            </button>
            {purchaseId && (
              <a
                href="/purchasing/orders?status=purchased"
                className="text-xs underline"
              >
                발주 목록 보기
              </a>
            )}
          </form>
        )}
        <div className="flex flex-wrap gap-2">
          {targets.map((target) => (
            <button
              type="button"
              key={target}
              disabled={pending || disabled}
              className="rounded border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              onClick={() => compare(target)}
            >
              {LINK_LABELS[target]}
            </button>
          ))}
        </div>
        {preview && preview.itemId === itemId && (
          <section
            aria-label="상품 동기화 변경 비교"
            className="space-y-2 rounded border bg-background p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm">
                {preview.productName} · {LINK_LABELS[preview.target]}
              </strong>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="동기화 비교 닫기"
              >
                ×
              </button>
            </div>
            <div className="max-h-72 overflow-auto">
              {preview.changes.length ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="p-2 text-left">항목</th>
                      <th className="p-2 text-left">기존 값</th>
                      <th className="p-2 text-left">반영할 값</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.changes.map((change) => (
                      <tr key={change.key} className="border-t">
                        <td className="p-2">{change.label}</td>
                        <td className="max-w-64 break-words p-2 text-muted-foreground">
                          {display(change.before)}
                        </td>
                        <td className="max-w-64 break-words p-2">
                          {display(change.after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-3 text-xs text-muted-foreground">
                  변경된 항목이 없습니다.
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={pending || !preview.changes.length || disabled}
              onClick={apply}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              {pending
                ? '처리 중…'
                : `${preview.changes.length}개 항목 동기화 적용`}
            </button>
          </section>
        )}
      </div>
    </details>
  )
}

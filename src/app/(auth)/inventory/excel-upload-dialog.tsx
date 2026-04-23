'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface UploadResult {
  total: number
  success: number
  failed: number
  errors: Array<{ sku: string; error: string }>
}

interface ExcelUploadDialogProps {
  onClose: () => void
}

export function ExcelUploadDialog({ onClose }: ExcelUploadDialogProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/inventory/bulk-upload', {
        method: 'POST',
        body: formData,
      })
      const data = (await res.json()) as UploadResult
      setResult(data)
    } catch {
      setResult({ total: 0, success: 0, failed: 1, errors: [{ sku: '-', error: '업로드 중 오류가 발생했습니다.' }] })
    } finally {
      setUploading(false)
    }
  }

  const handleDone = () => {
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">엑셀 재고/상품 업로드</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          필수: 상품코드 · 상품명 · 수량(재고). 선택: 창고 · 원가 · 판매가 · 택배사.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          📄 사방넷 <strong>재고코드관리 &gt; 다운로드</strong> 파일 그대로 업로드 가능 — 헤더가
          2·3행에 걸쳐있고 &apos;현재고 가용&apos;을 수량으로 읽음.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          상품코드 기준으로 상품 테이블도 자동 동기화됩니다.
        </p>

        <div className="mt-4 space-y-4">
          {!result ? (
            <>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {uploading ? '업로드 중...' : '업로드'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-md border p-4">
                <p className="font-medium">
                  총 {result.total}건 중 {result.success}건 성공, {result.failed}건 실패
                </p>

                {result.errors.length > 0 && (
                  <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-sm text-red-600">
                        상품코드: {err.sku} - {err.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={handleDone}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  완료
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

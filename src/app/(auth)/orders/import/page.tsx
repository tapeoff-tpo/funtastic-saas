'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'

interface ImportError {
  row: number
  errors: string[]
}

interface ImportResult {
  imported: number
  skipped: number
  errors: ImportError[]
}

export default function OrderImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [marketplaceId, setMarketplaceId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = useCallback((selectedFile: File) => {
    setFile(selectedFile)
    setResult(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile) handleFile(droppedFile)
    },
    [handleFile],
  )

  const handleUpload = async () => {
    if (!file || !marketplaceId.trim()) return

    setUploading(true)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('marketplaceId', marketplaceId.trim())

      const res = await fetch('/api/orders/import', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (!res.ok) {
        setResult({
          imported: 0,
          skipped: 0,
          errors: [{ row: 0, errors: [data.error || '업로드 실패'] }],
        })
      } else {
        setResult(data)
      }
    } catch {
      setResult({
        imported: 0,
        skipped: 0,
        errors: [{ row: 0, errors: ['네트워크 오류'] }],
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">주문 엑셀 업로드</h1>
          <p className="mt-1 text-muted-foreground">
            엑셀 파일로 주문을 일괄 등록합니다.
          </p>
        </div>
        <Link
          href="/orders"
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          주문관리로 돌아가기
        </Link>
      </div>

      <div className="mt-6 max-w-2xl space-y-6">
        {/* Template download */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">양식 다운로드</p>
              <p className="text-xs text-muted-foreground">
                아래 양식에 맞춰 데이터를 입력 후 업로드하세요.
              </p>
            </div>
            <a
              href="/api/orders/import/template"
              download
              className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              양식 다운로드
            </a>
          </div>
        </div>

        {/* Marketplace selection */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            마켓플레이스 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={marketplaceId}
            onChange={(e) => setMarketplaceId(e.target.value)}
            placeholder="예: 도매꾹, 오너클랜, 기타"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            주문이 들어온 마켓/채널명을 입력하세요.
          </p>
        </div>

        {/* File drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? 'border-primary bg-primary/5'
              : file
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-gray-300'
          }`}
        >
          {file ? (
            <div>
              <p className="text-sm font-medium text-emerald-700">{file.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </p>
              <button
                onClick={() => {
                  setFile(null)
                  setResult(null)
                }}
                className="mt-2 text-xs text-red-500 hover:underline"
              >
                파일 제거
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">
                Excel 파일을 여기에 드래그하거나
              </p>
              <label className="mt-2 inline-block cursor-pointer rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted">
                파일 선택
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </label>
            </div>
          )}
        </div>

        {/* Upload button */}
        <button
          onClick={handleUpload}
          disabled={!file || !marketplaceId.trim() || uploading}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              업로드 중...
            </span>
          ) : (
            '업로드'
          )}
        </button>

        {/* Results */}
        {result && (
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">업로드 결과</h3>
            <div className="mt-3 space-y-2">
              {result.imported > 0 && (
                <p className="text-sm text-emerald-600">
                  ✅ {result.imported}건 등록 완료
                </p>
              )}
              {result.skipped > 0 && (
                <p className="text-sm text-muted-foreground">
                  ⏭ {result.skipped}건 스킵 (중복)
                </p>
              )}
              {result.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-600">
                    ❌ {result.errors.length}건 오류
                  </p>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-red-500">
                    {result.errors.map((e, i) => (
                      <li key={i}>
                        {e.row > 0 ? `행 ${e.row}: ` : ''}
                        {e.errors.join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.imported > 0 && result.errors.length === 0 && (
                <Link
                  href="/orders"
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  주문관리에서 확인하기 →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

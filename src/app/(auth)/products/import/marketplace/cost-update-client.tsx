'use client'

import { useRef, useState } from 'react'

interface UpdateResult {
  total: number
  updated: number
  skipped: number
  noCost: number
  message: string
}

export function CostUpdateClient() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<UpdateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setFileName(file?.name ?? null)
    setResult(null)
    setError(null)
  }

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '업데이트 실패')
      } else {
        setResult(data)
      }
    } catch {
      setError('요청 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-5">
      <div>
        <h2 className="font-semibold">원가 일괄 업데이트</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          ESA009M 양식 Excel을 올리면 <strong>품목코드</strong>로 매칭하여{' '}
          <strong>원화 원가(works 신규 원가)</strong>를 자동으로 입력합니다.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-md border px-4 py-2 text-sm hover:bg-gray-50">
          {fileName ?? 'Excel 파일 선택'}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
        <button
          type="button"
          onClick={handleUpload}
          disabled={!fileName || loading}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? '업데이트 중...' : '원가 업데이트'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {result && (
        <div className="space-y-3 rounded-md bg-gray-50 p-4">
          <p className="text-sm font-medium text-green-700">{result.message}</p>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border bg-white p-3 text-center">
              <p className="text-xl font-bold">{result.total}</p>
              <p className="text-xs text-muted-foreground">전체 행</p>
            </div>
            <div className="rounded-md border bg-white p-3 text-center">
              <p className="text-xl font-bold text-green-600">{result.updated}</p>
              <p className="text-xs text-muted-foreground">업데이트</p>
            </div>
            <div className="rounded-md border bg-white p-3 text-center">
              <p className="text-xl font-bold text-yellow-600">{result.skipped}</p>
              <p className="text-xs text-muted-foreground">미매칭</p>
            </div>
            <div className="rounded-md border bg-white p-3 text-center">
              <p className="text-xl font-bold text-gray-400">{result.noCost}</p>
              <p className="text-xs text-muted-foreground">원가없음</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useRef, useState, useEffect } from 'react'

interface UpdateResult {
  total: number
  updated: number
  inserted: number
  skipped: number
  message: string
}

interface Template {
  id: string
  name: string
  mappings: Array<{ field: string; excelColumn: string }>
  isDefault: boolean
}

const FIELD_LABELS: Record<string, string> = {
  internal_sku: '상품코드',
  name: '상품명',
  cost_price: '원가',
  base_price: '판매가',
  warehouse_location: '창고위치',
  category_id: '카테고리',
  description: '설명',
}

export function CostUpdateClient() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<UpdateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')

  useEffect(() => {
    async function loadTemplates() {
      const { getTemplates } = await import('@/app/(auth)/settings/excel-templates/actions')
      const data = await getTemplates()
      setTemplates(data as Template[])
      const defaultTemplate = (data as Template[]).find((t) => t.isDefault)
      if (defaultTemplate) setSelectedTemplateId(defaultTemplate.id)
    }
    void loadTemplates()
  }, [])

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)

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
    if (selectedTemplateId) {
      formData.append('templateId', selectedTemplateId)
    }

    try {
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        body: formData,
      })
      const text = await res.text()
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(text) } catch { /* not json */ }
      if (!res.ok) {
        setError(`[${res.status}] ${(data.error as string) ?? text.slice(0, 200)}`)
      } else {
        setResult(data as unknown as UpdateResult)
      }
    } catch (e) {
      setError(`요청 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-5">
      <div>
        <h2 className="font-semibold">상품 일괄 업데이트</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Excel 파일을 올리면 양식 설정에 따라 상품 정보를 일괄 업데이트합니다.
        </p>
      </div>

      {/* Template selector */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">엑셀 양식</label>
        <div className="flex items-center gap-2">
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          >
            <option value="">자동감지 (기본)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.isDefault ? ' (기본)' : ''}
              </option>
            ))}
          </select>
          <a
            href="/settings/excel-templates"
            className="whitespace-nowrap rounded-md border px-2 py-1.5 text-sm hover:bg-muted"
          >
            양식 관리
          </a>
        </div>
        {selectedTemplate && (
          <p className="text-xs text-muted-foreground">
            매핑: {selectedTemplate.mappings.map((m) =>
              `${FIELD_LABELS[m.field] ?? m.field} = "${m.excelColumn}"`
            ).join(', ')}
          </p>
        )}
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
          onClick={() => void handleUpload()}
          disabled={!fileName || loading}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? '업데이트 중...' : '업데이트'}
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
              <p className="text-xl font-bold text-blue-600">{result.inserted}</p>
              <p className="text-xs text-muted-foreground">신규 추가</p>
            </div>
            <div className="rounded-md border bg-white p-3 text-center">
              <p className="text-xl font-bold text-gray-400">{result.skipped}</p>
              <p className="text-xs text-muted-foreground">스킵</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

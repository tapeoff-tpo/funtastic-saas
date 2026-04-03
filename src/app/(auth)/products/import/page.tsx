'use client'

import { useState, useTransition, useCallback } from 'react'

interface ImportResult {
  created: number
  updated: number
  errors: string[]
}

export default function ProductImportPage() {
  const [isPending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string[][] | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = useCallback((selectedFile: File) => {
    setFile(selectedFile)
    setResult(null)

    // Read first few rows for preview using FileReader
    const reader = new FileReader()
    reader.onload = () => {
      // For preview, we show file info since parsing xlsx requires ExcelJS
      setPreview([
        ['파일명', selectedFile.name],
        ['크기', `${(selectedFile.size / 1024).toFixed(1)} KB`],
        ['타입', selectedFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ])
    }
    reader.readAsArrayBuffer(selectedFile)
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

  const handleImport = () => {
    if (!file) return

    startTransition(async () => {
      const formData = new FormData()
      formData.append('file', file)

      const { importExcelAction } = await import('@/lib/products/ui-actions')
      const res = await importExcelAction(formData)

      if (res.success) {
        setResult(res.data)
      } else {
        alert(`가져오기 실패: ${res.error}`)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">엑셀 가져오기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          엑셀 파일로 상품을 일괄 등록하거나 업데이트합니다.
        </p>
      </div>

      {/* Template download */}
      <div className="rounded-md border p-4">
        <p className="text-sm">
          엑셀 양식이 필요하시면{' '}
          <a href="/api/products/export?template=true" className="text-blue-600 underline">
            빈 템플릿을 다운로드
          </a>
          하세요.
        </p>
      </div>

      {/* File upload area */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 transition-colors ${
          dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.xlsx,.xls'
          input.onchange = (e) => {
            const target = e.target as HTMLInputElement
            const selectedFile = target.files?.[0]
            if (selectedFile) handleFile(selectedFile)
          }
          input.click()
        }}
      >
        {file ? (
          <div className="text-center">
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              다른 파일을 선택하려면 클릭하세요
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="font-medium">엑셀 파일을 여기에 드래그하거나 클릭하세요</p>
            <p className="mt-1 text-sm text-muted-foreground">.xlsx, .xls 파일 지원</p>
          </div>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div className="space-y-3">
          <h2 className="font-semibold">파일 정보</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <tbody>
                {preview.map((row, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="px-3 py-2 font-medium text-muted-foreground">{row[0]}</td>
                    <td className="px-3 py-2">{row[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button */}
      {file && !result && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleImport}
            disabled={isPending}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? '가져오는 중...' : '가져오기 실행'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3 rounded-md border p-4">
          <h2 className="font-semibold">가져오기 결과</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{result.created}</p>
              <p className="text-muted-foreground">신규 등록</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{result.updated}</p>
              <p className="text-muted-foreground">업데이트</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-red-600">
                오류 {result.errors.length}건
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-red-500">
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <a
              href="/products"
              className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
            >
              상품 목록으로
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

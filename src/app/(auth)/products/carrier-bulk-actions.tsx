'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'

export function CarrierBulkActions() {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/products/carriers/import', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const err = await res.text()
        toast.error(`업로드 실패: ${err.slice(0, 200)}`)
        return
      }
      const data = await res.json() as {
        totalRows: number
        updated: number
        skipped: number
        errors: Array<{ row: number; sku: string; reason: string }>
      }
      const msg = `${data.updated}건 적용 / 전체 ${data.totalRows}건`
      if (data.errors.length > 0) {
        toast.warning(`${msg} · 오류 ${data.errors.length}건`, {
          description: data.errors.slice(0, 3).map((e) => `${e.sku}: ${e.reason}`).join('\n'),
          duration: 8000,
        })
      } else {
        toast.success(msg)
      }
      // 페이지 리프레시로 최신 상태 반영
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      toast.error(`업로드 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <a
        href="/api/products/carriers/export"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100"
        title="택배사가 지정되지 않은 상품을 엑셀로 다운로드"
      >
        택배사 미지정 다운로드
      </a>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        title="채워진 택배사 엑셀을 업로드해 일괄 적용"
      >
        {uploading ? '업로드 중…' : '택배사 일괄 적용'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
    </>
  )
}

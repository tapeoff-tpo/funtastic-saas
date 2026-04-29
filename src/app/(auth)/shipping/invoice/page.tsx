'use client'

import { useState, useRef, useTransition } from 'react'
import { toast } from 'sonner'

export default function InvoicePage() {
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, startImport] = useTransition()
  const [importResult, setImportResult] = useState<{
    matched: number; unmatched: number; skipped: number
    unmatchedRows?: { rowNum: number; orderId: string; trackingNumber: string }[]
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImport = () => {
    if (!importFile) return
    startImport(async () => {
      const formData = new FormData()
      formData.append('file', importFile)
      try {
        const res = await fetch('/api/shipping/cj/import', { method: 'POST', body: formData })
        const data = await res.json()
        if (!res.ok) { toast.error(data.error ?? '임포트 실패'); return }
        setImportResult(data)
        toast.success(`${data.matched}건 매칭 완료`)
        setImportFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } catch {
        toast.error('네트워크 오류')
      }
    })
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">운송장 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CJ 발주서 내보내기 → CJ 웹 등록 → 운송장 엑셀 가져오기
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── CJ 발주서 내보내기 ── */}
        <section className="rounded-xl border p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-base">① CJ 발주서 내보내기</h2>
            <p className="text-sm text-muted-foreground mt-1">
              주문관리에서 출고할 주문을 선택한 뒤 아래 버튼을 누르거나,
              주문관리 페이지에서 직접 내보내세요.
            </p>
          </div>
          <a
            href="/orders"
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            주문관리로 이동 →
          </a>
          <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-1">
            <div>1. 주문관리에서 출고할 주문 선택</div>
            <div>2. 하단 액션바 → "CJ 발주서" 버튼 클릭</div>
            <div>3. 다운로드된 엑셀을 CJ 웹에 업로드</div>
            <div>4. CJ에서 운송장번호가 부여된 엑셀 다운로드</div>
          </div>
        </section>

        {/* ── 운송장 엑셀 가져오기 ── */}
        <section className="rounded-xl border p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-base">② 운송장 엑셀 가져오기</h2>
            <p className="text-sm text-muted-foreground mt-1">
              CJ에서 받은 <strong>송장등록양식.xlsx</strong>을 업로드하면
              주문별로 운송장번호가 자동 연결됩니다.
            </p>
          </div>

          <div
            className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) setImportFile(file)
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            {importFile ? (
              <div>
                <div className="font-medium text-sm">{importFile.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(importFile.size / 1024).toFixed(0)}KB
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                엑셀 파일을 드래그하거나 클릭해서 선택
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleImport}
            disabled={!importFile || importing}
            className="w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {importing ? '처리 중...' : '운송장 가져오기'}
          </button>

          {importResult && (
            <div className="rounded-lg bg-muted/50 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">매칭 성공</span>
                <span className="font-semibold text-green-700">{importResult.matched}건</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">매칭 실패</span>
                <span className={`font-semibold ${importResult.unmatched > 0 ? 'text-red-600' : ''}`}>
                  {importResult.unmatched}건
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">운송장번호 없음 (스킵)</span>
                <span>{importResult.skipped}건</span>
              </div>
              {importResult.unmatchedRows && importResult.unmatchedRows.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-red-600">
                    미매칭 목록 보기
                  </summary>
                  <div className="mt-2 space-y-1">
                    {importResult.unmatchedRows.slice(0, 10).map((r) => (
                      <div key={r.rowNum} className="text-xs text-muted-foreground">
                        행 {r.rowNum}: {r.trackingNumber} (마켓 주문번호: <span className="font-mono">{r.orderId}</span>)
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── 스캔 출고 이동 ── */}
      <section className="rounded-xl border border-black bg-gray-900 p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">③ 스캔 출고</h2>
            <p className="text-sm text-white/70 mt-1">
              운송장 임포트 완료 후 스캔 출고 화면으로 이동하세요.
              바코드 스캔 시 자동으로 출고 처리됩니다.
            </p>
          </div>
          <a
            href="/shipping/scan"
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-gray-100 whitespace-nowrap"
          >
            스캔 출고 →
          </a>
        </div>
      </section>
    </div>
  )
}

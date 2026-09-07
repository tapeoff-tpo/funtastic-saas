'use client'

import { useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { FileUp, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DAOU_WORKS_STAGE_TEMPLATE,
  parseDaouWorksCsvFile,
  type DaouWorksCsvParseResult,
} from '@/lib/new-products/daou-works-import'

type Props = {
  onImported: () => void
}

type ImportResponse = {
  processed: number
  inserted: number
  updated: number
  stageCount: number
}

const BATCH_SIZE = 75

export function DaouWorksImportDialog({ onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [parsed, setParsed] = useState<DaouWorksCsvParseResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [replaceStages, setReplaceStages] = useState(true)
  const [progress, setProgress] = useState<{ current: number; total: number; inserted: number; updated: number } | null>(null)
  const [pending, startTransition] = useTransition()

  function setDialogOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) reset()
  }

  function reset() {
    setParsed(null)
    setFileName('')
    setParseError('')
    setParsing(false)
    setProgress(null)
    setReplaceStages(true)
  }

  async function selectFile(file: File | null) {
    setParsed(null)
    setParseError('')
    setProgress(null)
    setFileName(file?.name ?? '')
    if (!file) return
    if (!/\.csv$/i.test(file.name)) {
      setParseError('다우오피스에서 내려받은 CSV 파일만 선택해주세요.')
      return
    }

    setParsing(true)
    try {
      const result = await parseDaouWorksCsvFile(file)
      setParsed(result)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'CSV 파일을 읽지 못했습니다.')
    } finally {
      setParsing(false)
    }
  }

  function importItems() {
    if (!parsed) return
    startTransition(async () => {
      const totalBatches = Math.ceil(parsed.items.length / BATCH_SIZE)
      let inserted = 0
      let updated = 0
      try {
        for (let index = 0; index < totalBatches; index += 1) {
          setProgress({ current: index + 1, total: totalBatches, inserted, updated })
          const response = await fetch('/api/new-products/daou-works-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: parsed.items.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
              replaceStages: replaceStages && index === 0,
            }),
          })
          const body = await response.json().catch(() => ({})) as Partial<ImportResponse> & { error?: string }
          if (!response.ok || typeof body.processed !== 'number') {
            throw new Error(body.error || 'WORKS 데이터를 저장하지 못했습니다.')
          }
          inserted += body.inserted ?? 0
          updated += body.updated ?? 0
        }
        setProgress({ current: totalBatches, total: totalBatches, inserted, updated })
        toast.success(`WORKS 상품 ${inserted.toLocaleString('ko-KR')}건을 가져왔습니다.${updated > 0 ? ` ${updated.toLocaleString('ko-KR')}건은 최신 원본으로 갱신했습니다.` : ''}`)
        setOpen(false)
        reset()
        onImported()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WORKS 가져오기 중 오류가 발생했습니다.'
        toast.error(message)
        setParseError(`${message} 같은 CSV를 다시 가져오면 이미 저장된 WORKS ID는 중복 생성되지 않습니다.`)
      }
    })
  }

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <Dialog.Root open={open} onOpenChange={setDialogOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} variant="outline"><FileUp />WORKS CSV 가져오기</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(94vw,680px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background shadow-2xl">
          <div className="border-b p-5">
            <Dialog.Title className="text-lg font-semibold">다우 WORKS 상품관리 가져오기</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              같은 WORKS ID는 갱신하고, 옵션·부자재·상품문의와 화면에 없는 원본 항목도 함께 보존합니다.
            </Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="daou-works-csv">WORKS CSV 파일</label>
              <Input id="daou-works-csv" type="file" accept=".csv,text/csv" disabled={pending || parsing} onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} />
              {fileName && <p className="text-xs text-muted-foreground">선택한 파일: {fileName}</p>}
            </div>

            {parsing && <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" />CSV 구조를 확인하는 중입니다.</div>}
            {parseError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{parseError}</p>}

            {parsed && (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <SummaryCard label="상품" value={`${parsed.items.length.toLocaleString('ko-KR')}건`} />
                  <SummaryCard label="원본 행" value={`${parsed.rawRowCount.toLocaleString('ko-KR')}행`} />
                  <SummaryCard label="WORKS 단계" value={`${DAOU_WORKS_STAGE_TEMPLATE.length}개`} />
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" checked={replaceStages} disabled={pending} onChange={(event) => setReplaceStages(event.target.checked)} className="mt-0.5" />
                    <span>
                      <strong className="font-medium">진행 단계를 WORKS 기준으로 교체</strong>
                      <span className="mt-0.5 block text-xs text-muted-foreground">기존 SaaS 단계의 상품은 가장 가까운 WORKS 단계로 유지합니다.</span>
                    </span>
                  </label>
                </div>

                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">파일에서 확인한 현재 상태</p>
                  <div className="flex max-h-28 flex-wrap content-start gap-1.5 overflow-y-auto">
                    {parsed.statusCounts.map(({ status, count }) => (
                      <span key={status} className="rounded-md border bg-background px-2 py-1 text-[11px]">{status} <strong>{count.toLocaleString('ko-KR')}</strong></span>
                    ))}
                  </div>
                </div>

                <p className="text-xs leading-5 text-muted-foreground">
                  CSV에는 실제 이미지·첨부파일이 포함되지 않아 파일명과 원본 입력값만 보존됩니다. 중간에 끊겨도 같은 CSV를 다시 가져오면 중복 생성되지 않습니다.
                </p>
              </>
            )}

            {progress && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="flex items-center justify-between gap-3 text-sm font-medium text-violet-900"><span>가져오는 중</span><span>{progress.current} / {progress.total}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${progressPercent}%` }} /></div>
                <p className="mt-2 text-xs text-violet-800">신규 {progress.inserted.toLocaleString('ko-KR')}건 · 갱신 {progress.updated.toLocaleString('ko-KR')}건</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline" disabled={pending || parsing}>취소</Button>} />
            <Button type="button" onClick={importItems} disabled={!parsed || pending || parsing}>
              {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {pending ? '가져오는 중...' : `${parsed?.items.length.toLocaleString('ko-KR') ?? 0}건 가져오기`}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card px-3 py-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-semibold">{value}</p></div>
}

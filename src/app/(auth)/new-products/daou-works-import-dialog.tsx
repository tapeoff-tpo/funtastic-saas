'use client'

import { useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { FileUp, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES,
  parseDaouWorksCsvFile,
  type DaouWorksCsvParseResult,
} from '@/lib/new-products/daou-works-import'
import type { NewProductStage } from '@/lib/new-products/workflow'

type Props = {
  stages: NewProductStage[]
  onImported: () => void
}

type ImportResponse = {
  processed: number
  inserted: number
  updated: number
  skippedDuplicateSampleCodes: number
  stageCount: number
}

const BATCH_SIZE = 75

export function DaouWorksImportDialog({ stages, onImported }: Props) {
  const [open, setOpen] = useState(false)
  const [parsed, setParsed] = useState<DaouWorksCsvParseResult | null>(null)
  const [stageMappings, setStageMappings] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number; inserted: number; updated: number; skippedDuplicateSampleCodes: number } | null>(null)
  const [pending, startTransition] = useTransition()

  function setDialogOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) reset()
  }

  function reset() {
    setParsed(null)
    setStageMappings({})
    setFileName('')
    setParseError('')
    setParsing(false)
    setProgress(null)
  }

  async function selectFile(file: File | null) {
    setParsed(null)
    setStageMappings({})
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
      setStageMappings(createSuggestedStageMappings(result, stages))
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'CSV 파일을 읽지 못했습니다.')
    } finally {
      setParsing(false)
    }
  }

  function updateStageMapping(sourceStatus: string, stageId: string) {
    setStageMappings((current) => ({ ...current, [sourceStatus]: stageId }))
  }

  const missingStatuses = parsed?.statusCounts.filter(({ status }) => !stageMappings[status]) ?? []
  const allStatusesMapped = Boolean(parsed) && missingStatuses.length === 0

  function importItems() {
    if (!parsed || !allStatusesMapped) {
      setParseError('파일에 있는 모든 WORKS 상태를 현재 SaaS 단계에 연결해주세요.')
      return
    }

    const mappingsForImport = { ...stageMappings }
    startTransition(async () => {
      const totalBatches = Math.ceil(parsed.items.length / BATCH_SIZE)
      let inserted = 0
      let updated = 0
      let skippedDuplicateSampleCodes = 0
      try {
        for (let index = 0; index < totalBatches; index += 1) {
          setProgress({ current: index + 1, total: totalBatches, inserted, updated, skippedDuplicateSampleCodes })
          const response = await fetch('/api/new-products/daou-works-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: parsed.items.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
              stageMappings: mappingsForImport,
            }),
          })
          const body = await response.json().catch(() => ({})) as Partial<ImportResponse> & { error?: string }
          if (!response.ok || typeof body.processed !== 'number') {
            throw new Error(body.error || 'WORKS 데이터를 저장하지 못했습니다.')
          }
          inserted += body.inserted ?? 0
          updated += body.updated ?? 0
          skippedDuplicateSampleCodes += body.skippedDuplicateSampleCodes ?? 0
        }
        setProgress({ current: totalBatches, total: totalBatches, inserted, updated, skippedDuplicateSampleCodes })
        toast.success(`WORKS 상품 ${inserted.toLocaleString('ko-KR')}건을 가져왔습니다.${updated > 0 ? ` ${updated.toLocaleString('ko-KR')}건은 최신 원본으로 갱신했습니다.` : ''}${skippedDuplicateSampleCodes > 0 ? ` 중복 상품번호 ${skippedDuplicateSampleCodes.toLocaleString('ko-KR')}건은 건너뛰었습니다.` : ''}`)
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
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(94vw,840px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background shadow-2xl">
          <div className="border-b p-5">
            <Dialog.Title className="text-lg font-semibold">다우 WORKS 상품관리 가져오기</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              현재 SaaS 단계는 바꾸지 않고, WORKS 상태별로 넣을 기존 단계를 선택합니다.
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
                <div className="grid gap-2 sm:grid-cols-4">
                  <SummaryCard label="상품" value={`${parsed.items.length.toLocaleString('ko-KR')}건`} />
                  <SummaryCard label="원본 행" value={`${parsed.rawRowCount.toLocaleString('ko-KR')}행`} />
                  <SummaryCard label="WORKS 상태" value={`${parsed.statusCounts.length}개`} />
                  <SummaryCard label="현재 SaaS 단계" value={`${stages.length}개`} />
                </div>

                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">상태 연결</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">현재 단계명과 순서는 변경하지 않습니다. 선택한 SaaS 단계에만 상품을 넣고, WORKS 원본 상태는 상품 상세의 원본 정보에 남깁니다.</p>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">WORKS 상태</th>
                        <th className="w-20 px-3 py-2 text-right font-medium">상품</th>
                        <th className="w-[320px] px-3 py-2 font-medium">넣을 현재 SaaS 단계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {parsed.statusCounts.map(({ status, count }, index) => {
                        const suggestedName = DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES[status]
                        return (
                          <tr key={status} className="align-top">
                            <td className="px-3 py-3 font-medium">{status}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{count.toLocaleString('ko-KR')}</td>
                            <td className="px-3 py-2">
                              <label className="sr-only" htmlFor={`daou-works-stage-${index}`}>{status} SaaS 단계</label>
                              <select
                                id={`daou-works-stage-${index}`}
                                value={stageMappings[status] ?? ''}
                                disabled={pending}
                                onChange={(event) => updateStageMapping(status, event.target.value)}
                                className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                              >
                                <option value="">현재 SaaS 단계 선택</option>
                                {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.position}. {stage.name}</option>)}
                              </select>
                              {suggestedName && <p className="mt-1 text-[11px] text-muted-foreground">추천 연결: {suggestedName}</p>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {missingStatuses.length > 0 && <p className="text-xs text-amber-700">단계 선택 필요: {missingStatuses.map(({ status }) => status).join(', ')}</p>}

                <p className="text-xs leading-5 text-muted-foreground">
                  CSV에는 실제 이미지·첨부파일이 포함되지 않아 파일명과 원본 입력값만 보존됩니다. 중간에 끊겨도 같은 CSV를 다시 가져오면 이미 저장된 WORKS ID는 중복 생성되지 않습니다.
                </p>
              </>
            )}

            {progress && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <div className="flex items-center justify-between gap-3 text-sm font-medium text-violet-900"><span>가져오는 중</span><span>{progress.current} / {progress.total}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${progressPercent}%` }} /></div>
                <p className="mt-2 text-xs text-violet-800">신규 {progress.inserted.toLocaleString('ko-KR')}건 · 갱신 {progress.updated.toLocaleString('ko-KR')}건{progress.skippedDuplicateSampleCodes > 0 ? ` · 중복 상품번호 건너뜀 ${progress.skippedDuplicateSampleCodes.toLocaleString('ko-KR')}건` : ''}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline" disabled={pending || parsing}>취소</Button>} />
            <Button type="button" onClick={importItems} disabled={!allStatusesMapped || pending || parsing}>
              {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {pending ? '가져오는 중...' : !allStatusesMapped ? '단계 매핑 필요' : `${parsed?.items.length.toLocaleString('ko-KR') ?? 0}건 가져오기`}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function createSuggestedStageMappings(parsed: DaouWorksCsvParseResult, stages: NewProductStage[]) {
  const stageIdByName = new Map(stages.map((stage) => [stage.name, stage.id]))
  return Object.fromEntries(parsed.statusCounts.map(({ status }) => {
    const suggestedName = DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES[status]
    return [status, suggestedName ? stageIdByName.get(suggestedName) ?? '' : '']
  }))
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card px-3 py-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-semibold">{value}</p></div>
}

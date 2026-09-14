'use client'

import { useMemo, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  parseChinaFundStatementText,
} from '@/lib/purchasing/china-fund-statement-input'
import type { ChinaFundStatementList } from '@/lib/purchasing/china-fund-statement'

export function ChinaFundStatementPanel() {
  const [showEntries, setShowEntries] = useState(false)
  const [data, setData] = useState<ChinaFundStatementList | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [sourceLabel, setSourceLabel] = useState('중국 정산표 직접 입력')
  const [pasteText, setPasteText] = useState('')
  const [saving, setSaving] = useState(false)
  const parsed = useMemo(() => parseChinaFundStatementText(pasteText), [pasteText])
  const latestBatchFirstEntryId = data?.entries.find((entry) => (
    entry.importBatchId === data.latestImportBatchId
  ))?.id ?? null

  async function loadEntries(nextFrom = from, nextTo = to, nextPage = 1) {
    if (nextFrom && nextTo && nextFrom > nextTo) {
      setError('시작일은 종료일보다 늦을 수 없습니다.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100', page: String(nextPage) })
      if (nextFrom) params.set('from', nextFrom)
      if (nextTo) params.set('to', nextTo)
      const response = await fetch(`/api/purchasing/payment-flow/china-statement?${params.toString()}`, {
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '중국 정산내역을 불러오지 못했습니다.')
      setData(body as ChinaFundStatementList)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '중국 정산내역을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function toggleEntries() {
    const next = !showEntries
    setShowEntries(next)
    if (next && !data && !loading) await loadEntries()
  }

  async function saveEntries() {
    if (parsed.entries.length === 0 || parsed.errors.length > 0) return
    setSaving(true)
    try {
      const response = await fetch('/api/purchasing/payment-flow/china-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceLabel: sourceLabel.trim() || null,
          entries: parsed.entries,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '중국 정산내역을 저장하지 못했습니다.')

      const duplicateCount = Number(body.duplicateCount ?? 0)
      toast.success(
        duplicateCount > 0
          ? `${Number(body.insertedCount ?? 0).toLocaleString('ko-KR')}건 저장 · 중복 ${duplicateCount.toLocaleString('ko-KR')}건 제외`
          : `${Number(body.insertedCount ?? parsed.entries.length).toLocaleString('ko-KR')}건을 저장했습니다.`,
      )
      setImportOpen(false)
      setPasteText('')
      setShowEntries(true)
      await loadEntries()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '중국 정산내역을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function resetRange() {
    setFrom('')
    setTo('')
    void loadEntries('', '', 1)
  }

  async function voidImportBatch(importBatchId: string) {
    if (!window.confirm('가장 최근에 입력한 중국 정산내역 묶음 전체를 취소할까요? 취소 후 다시 입력할 수 있습니다.')) return
    setLoading(true)
    try {
      const response = await fetch(`/api/purchasing/payment-flow/china-statement/${importBatchId}`, {
        method: 'DELETE',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '중국 정산내역을 취소하지 못했습니다.')
      toast.success(`${Number(body.voidedCount ?? 0).toLocaleString('ko-KR')}건을 취소했습니다.`)
      await loadEntries(from, to, 1)
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : '중국 정산내역을 취소하지 못했습니다.')
      setLoading(false)
    }
  }

  return (
    <section className="space-y-3 border-t pt-4" aria-label="중국 정산원장">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">중국 정산원장</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            중국 표의 부호를 그대로 저장합니다. +는 중국 선결제, -는 우리 입금이며 기존 자동 발주차감과 합산하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog.Root open={importOpen} onOpenChange={setImportOpen}>
            <Dialog.Trigger
              render={(props) => (
                <Button {...props} type="button" size="sm" variant="outline">
                  <Plus />
                  정산내역 입력
                </Button>
              )}
            />
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
              <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl">
                <Dialog.Title className="text-base font-semibold">중국 정산내역 입력</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  엑셀에서 날짜·금액·총합 세 열을 복사해 그대로 붙여넣으세요. 총합 계산이 맞는 행만 저장됩니다.
                </Dialog.Description>
                <div className="mt-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="china-statement-source">출처 메모</Label>
                    <Input
                      id="china-statement-source"
                      value={sourceLabel}
                      onChange={(event) => setSourceLabel(event.target.value)}
                      maxLength={200}
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="china-statement-paste">정산표 붙여넣기</Label>
                    <textarea
                      id="china-statement-paste"
                      value={pasteText}
                      onChange={(event) => setPasteText(event.target.value)}
                      className="min-h-52 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder={'날짜\t금액\t총합\n2026. 08. 28\t30000\t30000\n2026. 09. 01\t-95386.34\t14613.66'}
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">중국 기준 +와 -를 바꾸지 말고 그대로 붙여넣어주세요.</p>
                  </div>

                  {pasteText.trim() ? (
                    <div className={`rounded-md border px-3 py-2 text-sm ${parsed.errors.length > 0 ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
                      {parsed.errors.length > 0 ? (
                        <div>
                          <p className="font-medium">확인이 필요한 행 {parsed.errors.length.toLocaleString('ko-KR')}건</p>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {parsed.errors.slice(0, 5).map((item) => (
                              <li key={`${item.lineNumber}:${item.message}`}>{item.lineNumber}행 · {item.message}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="grid gap-1 text-xs sm:grid-cols-2">
                          <p>인식 {parsed.entries.length.toLocaleString('ko-KR')}건</p>
                          <p>시작잔액 {formatCny(parsed.inferredOpeningBalanceCny)} 元</p>
                          <p>중국 선결제 +{formatCny(parsed.advanceTotalCny)} 元</p>
                          <p>우리 입금 -{formatCny(parsed.remittanceTotalCny)} 元</p>
                          <p className="font-semibold sm:col-span-2">마지막 총합 {formatCny(parsed.finalBalanceCny)} 元 · 계산 일치</p>
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Dialog.Close
                      render={(props) => <Button {...props} type="button" variant="outline" disabled={saving}>취소</Button>}
                    />
                    <Button
                      type="button"
                      onClick={() => void saveEntries()}
                      disabled={saving || parsed.entries.length === 0 || parsed.errors.length > 0}
                    >
                      {saving ? <Loader2 className="animate-spin" /> : null}
                      {parsed.entries.length.toLocaleString('ko-KR')}건 저장
                    </Button>
                  </div>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
          <Button type="button" size="sm" variant="outline" onClick={() => void toggleEntries()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : showEntries ? <ChevronUp /> : <ChevronDown />}
            {showEntries ? '내역 접기' : '기간 조회'}
          </Button>
        </div>
      </div>

      {showEntries ? (
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void loadEntries()
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="china-statement-from" className="text-xs">시작일</Label>
              <Input id="china-statement-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="china-statement-to" className="text-xs">종료일</Label>
              <Input id="china-statement-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-40" />
            </div>
            <Button type="submit" size="sm" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : null}조회</Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetRange} disabled={loading}>초기화</Button>
          </form>

          {error ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p> : null}

          {data ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <StatementSummary label="현재 중국 기준 총합" value={currentBalanceLabel(data.currentBalanceCny)} detail={data.currentBalanceAsOf ? `${data.currentBalanceAsOf} 기준` : '등록 내역 없음'} />
                <StatementSummary label="조회기간 중국 선결제" value={`+${formatCny(data.periodAdvanceCny)} 元`} detail="우리 미지급 증가" />
                <StatementSummary label="조회기간 우리 입금" value={`-${formatCny(data.periodRemittanceCny)} 元`} detail="우리 미지급 감소" />
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">날짜</th>
                      <th className="px-3 py-2 text-left font-medium">구분</th>
                      <th className="px-3 py-2 text-right font-medium">중국 기준 금액</th>
                      <th className="px-3 py-2 text-right font-medium">거래 후 총합</th>
                      <th className="px-3 py-2 text-left font-medium">출처</th>
                      <th className="w-12 px-2 py-2"><span className="sr-only">관리</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">선택한 기간의 정산내역이 없습니다.</td></tr>
                    ) : data.entries.map((entry) => (
                      <tr key={entry.id} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{entry.occurredOn}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{entry.direction === 'china_advance' ? '중국 선결제' : '우리 입금'}</td>
                        <td className={`whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums ${entry.signedAmountCny > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {entry.signedAmountCny > 0 ? '+' : ''}{formatCny(entry.signedAmountCny)} 元
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatCny(entry.balanceAfterCny)} 元</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{entry.sourceLabel ?? entry.memo ?? '-'}</td>
                        <td className="px-2 py-2 text-right">
                          {entry.id === latestBatchFirstEntryId ? (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void voidImportBatch(entry.importBatchId)}
                              disabled={loading}
                              aria-label="가장 최근 입력 묶음 취소"
                              title="가장 최근 입력 묶음 취소"
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <p>{data.total.toLocaleString('ko-KR')}건 · {data.page.toLocaleString('ko-KR')} / {data.totalPages.toLocaleString('ko-KR')}페이지</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={loading || data.page <= 1} onClick={() => void loadEntries(from, to, data.page - 1)}>이전</Button>
                  <Button type="button" size="sm" variant="outline" disabled={loading || !data.hasMore} onClick={() => void loadEntries(from, to, data.page + 1)}>다음</Button>
                </div>
              </div>
            </>
          ) : loading ? <p className="py-6 text-center text-sm text-muted-foreground">정산내역을 불러오는 중입니다.</p> : null}
        </div>
      ) : null}
    </section>
  )
}

function StatementSummary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function currentBalanceLabel(value: number | null) {
  if (value === null) return '-'
  if (value > 0) return `미지급 ${formatCny(value)} 元`
  if (value < 0) return `예치금 ${formatCny(Math.abs(value))} 元`
  return '0 元 · 정산 완료'
}

function formatCny(value: number | null) {
  if (value === null) return '-'
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

'use client'

import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import type { ShortMeetingRow } from '@/lib/analytics/short-meeting'
import type { ShortMeetingRawData } from '@/lib/analytics/short-meeting-upload-parser'
import { ShortMeetingTable } from './short-meeting-table'

type Tab = 'products' | 'original'
type Direction = 'ascending' | 'descending'
type SourcePage = {
  rawAvailable: boolean
  headers: string[]
  rows: ShortMeetingRawData['rows']
  totalRows: number
  filteredRows: number
  page: number
  pageSize: number
  totalPages: number
  appliedAt: string | null
}
type RequestState = { key: string; result?: SourcePage; error?: string; versionChanged?: boolean }

export function ShortMeetingTabs({ rows, sheetStatus, rawAvailable, uploadFileName, uploadVersion, meetingDate }: {
  rows: ShortMeetingRow[]
  sheetStatus: 'available' | 'unavailable'
  rawAvailable: boolean
  uploadFileName: string | null
  uploadVersion: string | null
  meetingDate: string
}) {
  const [tab, setTab] = useState<Tab>('products')
  const [originalOpened, setOriginalOpened] = useState(false)
  const id = useId()
  function activateTab(nextTab: Tab) {
    if (nextTab === 'original') setOriginalOpened(true)
    setTab(nextTab)
  }
  function changeTab(event: KeyboardEvent<HTMLButtonElement>, nextTab: Tab) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    activateTab(nextTab)
    document.getElementById(`${id}-${nextTab}`)?.focus()
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="숏미팅 보기" className="flex border-b">
        <button id={`${id}-products`} type="button" role="tab" aria-selected={tab === 'products'} aria-controls={`${id}-products-panel`} tabIndex={tab === 'products' ? 0 : -1} onClick={() => activateTab('products')} onKeyDown={(event) => changeTab(event, 'original')} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === 'products' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>상품별 현황</button>
        <button id={`${id}-original`} type="button" role="tab" aria-selected={tab === 'original'} aria-controls={`${id}-original-panel`} tabIndex={tab === 'original' ? 0 : -1} onClick={() => activateTab('original')} onKeyDown={(event) => changeTab(event, 'products')} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === 'original' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>주문서 원본</button>
      </div>
      <div id={`${id}-products-panel`} role="tabpanel" aria-labelledby={`${id}-products`} hidden={tab !== 'products'}><ShortMeetingTable rows={rows} sheetStatus={sheetStatus} /></div>
      <div id={`${id}-original-panel`} role="tabpanel" aria-labelledby={`${id}-original`} hidden={tab !== 'original'}>{originalOpened && <OriginalOrderTable key={`${meetingDate}:${uploadVersion ?? ''}`} rawAvailable={rawAvailable} uploadFileName={uploadFileName} uploadVersion={uploadVersion} meetingDate={meetingDate} />}</div>
    </div>
  )
}

function OriginalOrderTable({ rawAvailable, uploadFileName, uploadVersion, meetingDate }: { rawAvailable: boolean; uploadFileName: string | null; uploadVersion: string | null; meetingDate: string }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ column: number | 'row'; direction: Direction } | null>(null)
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [requestState, setRequestState] = useState<RequestState | null>(null)
  const query = JSON.stringify({ date: meetingDate, sort: sort?.column ?? 'row', direction: sort?.direction ?? 'ascending', search, page })
  const requestKey = `${query}:${uploadVersion ?? ''}:${retry}`
  const current = requestState?.key === requestKey ? requestState : null
  const result = current?.result ?? null
  const loading = rawAvailable && !current

  useEffect(() => {
    if (!rawAvailable) return
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => {
      fetch('/api/analytics/short-meeting/original', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: query, cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null) as { error?: string } | null
            throw new Error(body?.error || '주문서 원본을 불러오지 못했습니다. 다시 시도해 주세요.')
          }
          return response.json() as Promise<SourcePage>
        })
        .then((data) => {
          if (!active) return
          setRequestState(data.appliedAt !== uploadVersion ? { key: requestKey, versionChanged: true } : { key: requestKey, result: data })
        })
        .catch((error: unknown) => { if (active && !controller.signal.aborted) setRequestState({ key: requestKey, error: error instanceof Error ? error.message : '주문서 원본을 불러오지 못했습니다. 다시 시도해 주세요.' }) })
    }, search ? 300 : 0)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [rawAvailable, query, requestKey, search, uploadVersion])

  function changeSort(column: number | 'row') {
    setSort((previous) => ({ column, direction: previous?.column === column && previous.direction === 'ascending' ? 'descending' : 'ascending' }))
    setPage(1)
  }

  const unavailable = !rawAvailable || (result && !result.rawAvailable)
  const headers = result?.headers ?? []
  const totalPages = Math.max(1, result?.totalPages ?? 1)
  function heading(column: number | 'row', title: string) {
    const direction = sort?.column === column ? sort.direction : undefined
    const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
    return <th scope="col" aria-sort={direction} key={column} className="whitespace-nowrap px-3 py-2 text-left font-medium"><button type="button" onClick={() => changeSort(column)} className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"><span>{title}</span><Icon aria-hidden="true" className="size-3.5 shrink-0" /></button></th>
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">주문서 원본</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">업로드한 주문서를 원본 행과 열 순서대로 표시합니다. 열 제목을 눌러 정렬할 수 있습니다.</p>
          {uploadFileName && <p className="mt-2 text-xs text-muted-foreground">기준일 {meetingDate} · <span data-no-translate>{uploadFileName}</span>{result?.rawAvailable && ` · 총 ${result.totalRows.toLocaleString('ko-KR')}행`}</p>}
        </div>
        {rawAvailable && <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"><Search className="size-4 text-muted-foreground" /><span className="sr-only">원본 검색</span><input className="w-56 bg-transparent outline-none" placeholder="상품코드, 상품명, 주문번호 검색" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>}
      </div>
      {unavailable ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">{uploadFileName ? '이전에 반영된 주문서의 원본 행이 저장되어 있지 않습니다. 원본을 보려면 주문서를 다시 업로드해 주세요.' : '이 기준일에 반영된 주문서가 없습니다. 주문서를 업로드해 주세요.'}</p>
      ) : current?.versionChanged ? <div role="alert" className="px-4 py-10 text-center text-sm text-amber-700">주문서가 새로 반영되어 화면을 새로고침해야 합니다. <button type="button" onClick={() => window.location.reload()} className="underline">새로고침</button></div>
        : loading ? <p role="status" className="px-4 py-12 text-center text-sm text-muted-foreground">주문서 원본을 불러오는 중입니다.</p>
        : current?.error ? <div role="alert" className="px-4 py-10 text-center text-sm text-red-700">{current.error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">다시 시도</button></div>
          : result && (
            <>
              <div className="px-4 py-2 text-xs text-muted-foreground">{result.filteredRows.toLocaleString('ko-KR')}개 행 · 좌우로 이동해 모든 열을 확인하세요.</div>
              <div className="overflow-x-auto">
                <table className="w-max min-w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground"><tr>{heading('row', '행')}{headers.map((header, index) => heading(index, header || `${index + 1}열`))}</tr></thead>
                  <tbody>
                    {result.rows.length === 0 ? <tr><td className="px-3 py-12 text-center text-muted-foreground" colSpan={headers.length + 1}>{result.totalRows ? '검색 조건에 맞는 주문이 없습니다.' : '표시할 주문서 원본 행이 없습니다.'}</td></tr> : result.rows.map((row) => (
                      <tr className="border-t" key={row.rowNumber}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{row.rowNumber}{row.excludedReason && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800" title={row.excludedReason}>집계 제외<span className="sr-only">: {row.excludedReason}</span></span>}</td>
                        {headers.map((_, index) => <td key={index} data-no-translate className="whitespace-pre-wrap px-3 py-2">{row.cells[index] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-3 border-t px-4 py-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border px-3 py-1 disabled:opacity-40">이전</button><span>{result.page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-1 disabled:opacity-40">다음</button></div>
            </>
          )}
    </section>
  )
}

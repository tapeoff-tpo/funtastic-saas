'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ensureManualRegistrationGroup } from './group-actions'
import { useRegistrationSelection } from './selection-panel'

type Status = 'all' | 'missing' | 'complete'
export function RegistrationFilters({ query, status, missingMalls, targets, match = 'any' }: {
  match?: 'any' | 'all'
  query: string
  status: Status
  missingMalls: string[]
  targets: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [search, setSearch] = useState(query)
  const [selectedStatus, setStatus] = useState<Status>(status)
  const [selectedMalls, setMalls] = useState(missingMalls)
  const [selectedMatch, setMatch] = useState(match)
  function apply() {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (selectedStatus !== 'all') params.set('status', selectedStatus)
    if (selectedMalls.length) params.set('missingMalls', selectedMalls.join(','))
    if (selectedMalls.length > 1) params.set('missingMatch', selectedMatch)
    router.push(`/operations/marketplace-registration?${params}`)
  }
  return <div className="space-y-2">
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); apply() }}>
      <input aria-label="상품명·SKU·등록번호 검색" placeholder="상품명·대표코드·옵션 SKU·등록번호 검색" value={search}
        onChange={(event) => setSearch(event.target.value)} className="min-w-48 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm" />
      <label className="flex items-center gap-2 text-xs">등록상태
        <select aria-label="등록상태" value={selectedStatus} onChange={(event) => {
          const value = event.target.value as Status
          setStatus(value)
          if (value === 'complete') setMalls([])
        }} className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="all">전체 상품</option><option value="missing">미등록 몰 있음</option><option value="complete">전체 몰 등록</option>
        </select>
      </label>
      <details className="relative">
        <summary className="cursor-pointer rounded-md border bg-background px-3 py-1.5 text-sm">미등록 몰 {selectedMalls.length ? `${selectedMalls.length}개` : '선택'} ▾</summary>
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-md border bg-popover p-2 shadow-lg">
          <button type="button" onClick={() => setMalls([])} className="mb-2 text-xs text-muted-foreground underline">선택 해제</button>
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-auto">
            {targets.map((target) => <label key={target.id} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={selectedMalls.includes(target.id)} onChange={() => {
                setMalls((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])
                setStatus('missing')
              }} />{target.label}
            </label>)}
          </div>
        </div>
      </details>
      {selectedMalls.length > 1 && <label className="flex items-center gap-2 text-xs">몰 조건
        <select aria-label="몰 조건" value={selectedMatch} onChange={(event) => setMatch(event.target.value as 'any' | 'all')}
          className="rounded-md border bg-background px-2 py-1.5 text-sm">
          <option value="any">선택 몰 중 하나라도 미등록</option>
          <option value="all">선택 몰 모두 미등록</option>
        </select>
      </label>}
      <button className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">검색</button>
      <Link href="/operations/marketplace-registration" className="px-2 text-xs text-muted-foreground underline">초기화</Link>
    </form>
    {selectedMalls.length > 0 && <p className="text-xs text-muted-foreground">
      미등록 확인 대상 · {targets.filter((target) => selectedMalls.includes(target.id)).map((target) => target.label).join(', ')}
    </p>}
  </div>
}

export function RegistrationProductLink({ rowId, sku, label, href, selected, groupKey, optionCount }: {
  rowId: string | null; sku: string; label: string; href: string; selected: boolean; groupKey?: string; optionCount?: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const selection = useRegistrationSelection()
  const code = sku.replace(/-[0-9]{4}$/, '')
  function select() { return selection?.begin({ key: groupKey ?? code, code, name: label, optionCount }) }
  const [createdRowId, setCreatedRowId] = useState<string | null>(null)
  const linkedRowId = rowId ?? createdRowId
  const style = 'block w-full truncate text-left text-primary hover:underline'
  const linkedUrl = linkedRowId ? new URL(href, 'https://registration.local') : null
  if (linkedUrl && linkedRowId) linkedUrl.searchParams.set('row', linkedRowId)
  if (linkedUrl) return <Link onClick={(event) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) select()
  }} href={linkedUrl.pathname + linkedUrl.search} scroll={false} prefetch={false}
    aria-current={selected ? 'true' : undefined} title={label} className={style}>{label}</Link>
  return <button type="button" title={label} disabled={pending} className={style} onClick={() => {
    const token = select()
    startTransition(async () => {
      try {
        const result = await ensureManualRegistrationGroup(sku)
        if (token !== undefined && !selection?.isCurrent(token)) return
        if (result.error || !result.rowId) {
          if (token !== undefined) selection?.cancel(token)
          toast.error(result.error || '상품을 연결하지 못했습니다.')
          return
        }
        const url = new URL(href, window.location.origin)
        setCreatedRowId(result.rowId)
        url.searchParams.set('row', result.rowId)
        url.searchParams.set('group', code)
        router.push(url.pathname + url.search, { scroll: false })
      } catch {
        if (token !== undefined) {
          if (!selection?.isCurrent(token)) return
          selection.cancel(token)
        }
        toast.error('상품을 연결하지 못했습니다. 다시 시도해주세요.')
      }
    })
  }} aria-busy={pending}>{label}</button>
}

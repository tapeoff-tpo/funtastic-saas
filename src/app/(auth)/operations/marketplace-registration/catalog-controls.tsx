'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ensureManualRegistrationGroup } from './group-actions'

type Status = 'all' | 'missing' | 'complete'
type Preset = { status: Status; malls: string[] }
const PRESETS_KEY = 'registration-filter-presets-v1'

export function RegistrationFilters({ query, status, missingMalls, targets }: {
  query: string
  status: Status
  missingMalls: string[]
  targets: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [search, setSearch] = useState(query)
  const [selectedStatus, setStatus] = useState<Status>(status)
  const [selectedMalls, setMalls] = useState(missingMalls)
  const [name, setName] = useState('필터1')
  const [presets, setPresets] = useState<Record<string, Preset>>({})
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        setPresets(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, Preset] => {
          const value = entry[1] as Preset | null
          return Boolean(value && ['all', 'missing', 'complete'].includes(value.status)
            && Array.isArray(value.malls) && value.malls.every((id) => typeof id === 'string'))
        })))
      }
    } catch { /* The current filters remain usable when storage is unavailable. */ }
  }, [])
  function apply(value: Preset) {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (value.status !== 'all') params.set('status', value.status)
    if (value.malls.length) params.set('missingMalls', value.malls.join(','))
    router.push(`/operations/marketplace-registration?${params}`)
  }
  return <div className="space-y-2">
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); apply({ status: selectedStatus, malls: selectedMalls }) }}>
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
      <button className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">적용</button>
    </form>
    <div className="flex flex-wrap items-center gap-2">
      {Object.entries(presets).map(([label, preset]) => <span key={label} className="inline-flex rounded-md border bg-background text-xs">
        <button type="button" onClick={() => { setStatus(preset.status); setMalls(preset.malls); apply(preset) }} className="px-2 py-1">{label}</button>
        <button type="button" aria-label={`${label} 필터 삭제`} className="px-1.5 text-muted-foreground" onClick={() => {
          const next = { ...presets }; delete next[label]
          setPresets(next)
          try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)) } catch { /* Keep the in-memory filters. */ }
        }}>×</button>
      </span>)}
      <details className="relative text-xs">
        <summary className="cursor-pointer text-muted-foreground">필터 저장</summary>
        <div className="absolute left-0 z-40 mt-1 flex gap-2 rounded-md border bg-popover p-2 shadow-lg">
          <input aria-label="저장할 필터 이름" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} className="w-32 rounded border bg-background px-2 py-1" />
          <button type="button" className="whitespace-nowrap rounded border px-2 py-1" onClick={() => {
            const label = name.trim()
            if (!label) return
            const next = { ...presets, [label]: { status: selectedStatus, malls: selectedMalls } }
            setPresets(next)
            try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)) } catch { toast.error('이 브라우저에 필터를 저장하지 못했습니다.') }
          }}>저장</button>
        </div>
      </details>
    </div>
  </div>
}

export function RegistrationProductLink({ rowId, sku, label, href, selected }: {
  rowId: string | null; sku: string; label: string; href: string; selected: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const style = 'block w-full truncate text-left text-primary hover:underline'
  if (rowId) return <Link href={href} scroll={false} prefetch={false} aria-current={selected ? 'true' : undefined} title={label} className={style}>{label}</Link>
  return <button type="button" title={label} disabled={pending} className={style} onClick={() => startTransition(async () => {
    try {
      const result = await ensureManualRegistrationGroup(sku)
      if (result.error || !result.rowId) { toast.error(result.error || '상품을 연결하지 못했습니다.'); return }
      const url = new URL(href, window.location.origin)
      url.searchParams.set('row', result.rowId)
      router.push(url.pathname + url.search, { scroll: false })
    } catch { toast.error('상품을 연결하지 못했습니다. 다시 시도해주세요.') }
  })}>{pending ? '연결 중…' : label}</button>
}

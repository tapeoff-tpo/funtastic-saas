'use client'

import { ExternalLink, FileSpreadsheet, Loader2, RefreshCw, Square, Upload } from 'lucide-react'

export type SupplierRegistrationMode = 'excel' | 'individual'
export type SupplierRegistrationItemStatus = 'queued' | 'running' | 'login_required' | 'review_required' | 'prepared' | 'failed' | 'stopped' | 'succeeded'
export type SupplierRegistrationProgressItem = {
  id: string
  name: string
  status: SupplierRegistrationItemStatus
  message?: string
  canOpen?: boolean
  canStop?: boolean
  canCheck?: boolean
}

export type SupplierRegistrationControlsProps = {
  mode: SupplierRegistrationMode
  onModeChange: (mode: SupplierRegistrationMode) => void
  selectedCount: number
  busy?: boolean
  disabled?: boolean
  onStart: () => void
  items?: SupplierRegistrationProgressItem[]
  onOpen?: (id: string) => void
  onStop?: (id: string) => void
  onCheck?: (id: string) => void
}

const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
const statusColors: Record<SupplierRegistrationItemStatus, string> = {
  queued: 'border-slate-200 bg-slate-50 text-slate-700',
  running: 'border-blue-200 bg-blue-50 text-blue-800',
  login_required: 'border-amber-300 bg-amber-50 text-amber-900',
  review_required: 'border-amber-300 bg-amber-50 text-amber-900',
  prepared: 'border-violet-200 bg-violet-50 text-violet-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
  stopped: 'border-slate-200 bg-slate-50 text-slate-700',
  succeeded: 'border-emerald-200 bg-emerald-50 text-emerald-800',
}

function statusText(status: SupplierRegistrationItemStatus, mode: SupplierRegistrationMode) {
  if (status === 'prepared') return mode === 'individual' ? '입력·저장 완료' : '파일 준비 완료'
  return {
    queued: '대기 중', running: '진행 중', login_required: '로그인 필요', review_required: '확인 필요',
    failed: '실패', stopped: '중지됨', succeeded: '쿠팡 검수완료',
  }[status]
}

export function SupplierRegistrationControls({
  mode, onModeChange, selectedCount, busy = false, disabled = false, onStart, items = [], onOpen, onStop, onCheck,
}: SupplierRegistrationControlsProps) {
  const locked = disabled || busy
  return <section aria-label="쿠팡 등록" className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs font-medium">
        등록 방식
        <select aria-label="쿠팡 등록 방식" className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-40" value={mode} disabled={locked} onChange={event => {
          const value = event.target.value
          if (value === 'excel' || value === 'individual') onModeChange(value)
        }}>
          <option value="excel">엑셀 대량등록</option>
          <option value="individual">개별등록</option>
        </select>
      </label>
      <span aria-label="등록 대상 상품 수" className="text-xs tabular-nums text-muted-foreground">선택 {selectedCount}개</span>
      <button type="button" className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={locked || selectedCount < 1} onClick={onStart}>
        {busy ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : mode === 'excel' ? <FileSpreadsheet aria-hidden="true" className="size-3.5" /> : <Upload aria-hidden="true" className="size-3.5" />}
        {busy ? '진행 중' : mode === 'excel' ? '엑셀 대량등록' : '개별등록 준비'}
      </button>
    </div>
    {items.length > 0 && <ul aria-label="쿠팡 등록 진행" aria-live="polite" aria-relevant="text additions" className="max-h-64 divide-y overflow-y-auto rounded-md border bg-background">
      {items.map(item => <li key={item.id} aria-label={`${item.name} 등록 진행`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <div className="min-w-0 flex-1 basis-52">
          <p className="break-words text-xs font-medium">{item.name}</p>
          {item.message && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.message}</p>}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${statusColors[item.status]}`}>
          {item.status === 'running' && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
          {statusText(item.status, mode)}
        </span>
        {(item.canOpen && onOpen || item.canStop && onStop || item.canCheck && onCheck) && <div className="flex flex-wrap items-center gap-1.5">
          {item.canOpen && onOpen && <button type="button" className={buttonClass} aria-label={`${item.name} 쿠팡 화면 열기`} onClick={() => onOpen(item.id)}><ExternalLink aria-hidden="true" className="size-3.5" />쿠팡 화면 열기</button>}
          {item.canStop && onStop && <button type="button" className={buttonClass} aria-label={`${item.name} 포함 작업 전체 중지`} onClick={() => onStop(item.id)}><Square aria-hidden="true" className="size-3" />작업 전체 중지</button>}
          {item.canCheck && onCheck && <button type="button" className={buttonClass} aria-label={`${item.name} 다시 확인`} onClick={() => onCheck(item.id)}><RefreshCw aria-hidden="true" className="size-3.5" />다시 확인</button>}
        </div>}
      </li>)}
    </ul>}
  </section>
}

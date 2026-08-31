'use client'

import { useMemo, useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Eye, EyeOff, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  readAiAccountLoginInfoAction,
  updateAiAccountAvailabilityAction,
  updateAiAccountLimitsAction,
  updateAiAccountLoginInfoAction,
  updateAiAccountOperationalStateAction,
} from './actions'

type AiAccountRow = {
  id: string
  name: string
  email: string | null
  loginMethod: string | null
  loginId: string | null
  status: string
  currentUserName: string | null
  dailyLimit: string | null
  dailyResetTime: string | null
  weeklyLimit: string | null
  weeklyResetAt: string | null
  resetAvailableCount: number
  sharedUse: boolean
}

type Props = {
  accounts: AiAccountRow[]
  userCandidates: { id: string; name: string }[]
  statusLabels: Record<string, string>
}

type LoginInfo = {
  loginMethod: string
  loginId: string
  loginPassword: string
  gptId: string
  gptPassword: string
}

function statusClassName(status: string) {
  if (status === 'daily_limit_reached') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'weekly_limit_reached') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'in_use') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function normalizeStatus(status: string) {
  if (status === 'daily_limit_reached' || status === 'weekly_limit_reached' || status === 'in_use' || status === 'unselected') return status
  return 'unselected'
}

function weeklyResetDay(value: string | null) {
  if (!value) return ''
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date(value))
  return String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday))
}

function currentWeeklyResetDay() {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date())
  return String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday))
}

function weeklyResetTime(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))
}

function nextWeeklyResetAt(day: string, time: string) {
  if (!/^\d$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const current = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(current)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value)
  const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(current))
  const [hours, minutes] = time.split(':').map(Number)
  const offsetDays = (Number(day) - currentDay + 7) % 7
  const next = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offsetDays, hours - 9, minutes))
  if (offsetDays === 0 && next <= current) next.setUTCDate(next.getUTCDate() + 7)
  return next.toISOString()
}

export function AiAccountBoard({ accounts, userCandidates, statusLabels }: Props) {
  const [, startTransition] = useTransition()
  const [inlineLimits, setInlineLimits] = useState<Record<string, { dailyLimit: string | null; dailyResetTime: string | null; weeklyLimit: string | null; weeklyResetAt: string | null }>>({})
  const [savingLimitIds, setSavingLimitIds] = useState<string[]>([])
  const [limitErrors, setLimitErrors] = useState<Record<string, string>>({})
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null)
  const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null)
  const [loginInfoCache, setLoginInfoCache] = useState<Record<string, LoginInfo>>({})
  const [loginLoading, setLoginLoading] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [loginError, setLoginError] = useState('')

  const sortedAccounts = useMemo(() => accounts.map((account, index) => ({ account, index }))
    .sort((left, right) => Number(right.account.sharedUse) - Number(left.account.sharedUse) || right.account.resetAvailableCount - left.account.resetAvailableCount || left.index - right.index)
    .map(({ account }) => account), [accounts])
  const sharedAccountCount = accounts.filter((account) => account.sharedUse).length
  const resetAvailableTotal = accounts.reduce((total, account) => total + account.resetAvailableCount, 0)
  const loginAccount = accounts.find((account) => account.id === loginAccountId) || null

  function saveInlineLimits(account: AiAccountRow, formData: FormData) {
    const dailyResetTime = String(formData.get('dailyResetTime') || '').trim()
    const weeklyResetAt = nextWeeklyResetAt(String(formData.get('weeklyResetDay') || ''), String(formData.get('weeklyResetTime') || ''))
    setInlineLimits((current) => ({ ...current, [account.id]: {
      dailyLimit: null,
      dailyResetTime: dailyResetTime || null,
      weeklyLimit: null,
      weeklyResetAt,
    } }))
    setLimitErrors((current) => ({ ...current, [account.id]: '' }))
    setSavingLimitIds((current) => [...current, account.id])
    startTransition(async () => {
      const result = await updateAiAccountLimitsAction(formData)
      setSavingLimitIds((current) => current.filter((id) => id !== account.id))
      if ('error' in result) setLimitErrors((current) => ({ ...current, [account.id]: result.error || '한도를 저장하지 못했습니다.' }))
    })
  }

  async function openLoginInfo(accountId: string) {
    const account = accounts.find((candidate) => candidate.id === accountId)
    if (!account) return
    const cachedInfo = loginInfoCache[accountId]
    setLoginAccountId(accountId)
    setLoginInfo(cachedInfo || {
      loginMethod: account.loginMethod || '',
      loginId: account.loginId || '',
      loginPassword: '',
      gptId: account.email || '',
      gptPassword: '',
    })
    setLoginError('')
    setShowPasswords(false)
    if (cachedInfo) {
      setLoginLoading(false)
      return
    }
    setLoginLoading(true)
    const result = await readAiAccountLoginInfoAction(accountId)
    setLoginLoading(false)
    if ('error' in result) return setLoginError(result.error || '로그인 정보를 불러오지 못했습니다.')
    setLoginInfoCache((current) => ({ ...current, [accountId]: result }))
    setLoginInfo(result)
  }

  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">계정 목록</h2>
          <p className="text-xs text-muted-foreground">총 {accounts.length}개 · 공유 사용 {sharedAccountCount}개 · 초기화 가능 {resetAvailableTotal}개</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">
          <div className="hidden border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_minmax(420px,3.2fr)_minmax(80px,0.7fr)_minmax(100px,0.8fr)] md:items-center md:gap-2">
            <div>계정명</div><div>상태</div><div>사용자</div><div>일/주 초기화 시각</div><div>초기화</div><div>공유 사용</div>
          </div>
          <div className="divide-y">
            {sortedAccounts.map((account) => {
              const displayStatus = normalizeStatus(account.status)
              const candidateNames = userCandidates.map((candidate) => candidate.name)
              const inline = inlineLimits[account.id]
              return (
                <div key={account.id} className={cn('grid w-full gap-3 px-3 py-3 md:grid-cols-[minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_minmax(420px,3.2fr)_minmax(80px,0.7fr)_minmax(100px,0.8fr)] md:items-center md:gap-2', account.sharedUse && 'bg-emerald-50/50')}>
                  <button type="button" onClick={() => openLoginInfo(account.id)} className="truncate whitespace-nowrap text-left text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={`${account.name} 로그인 정보 열기`}>{account.name}</button>
                  <form action={updateAiAccountOperationalStateAction} className="contents">
                    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="changedField" value="" />
                    <select name="status" defaultValue={displayStatus} onChange={(event) => { const form = event.currentTarget.form; const field = form?.elements.namedItem('changedField'); if (field instanceof HTMLInputElement) field.value = 'status'; form?.requestSubmit() }} aria-label={`${account.name} 상태`} className={cn('h-9 w-full rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', statusClassName(displayStatus))}>
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select name="currentUserName" defaultValue={account.currentUserName || ''} onChange={(event) => { const form = event.currentTarget.form; const field = form?.elements.namedItem('changedField'); if (field instanceof HTMLInputElement) field.value = 'currentUserName'; form?.requestSubmit() }} aria-label={`${account.name} 사용자`} className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">사용자 없음</option>
                      {account.currentUserName && !candidateNames.includes(account.currentUserName) ? <option value={account.currentUserName}>{account.currentUserName}</option> : null}
                      {userCandidates.map((candidate) => <option key={candidate.id} value={candidate.name}>{candidate.name}</option>)}
                    </select>
                  </form>
                  <form key={`${account.id}-${inline?.dailyLimit || ''}-${inline?.dailyResetTime || ''}-${inline?.weeklyLimit || ''}-${inline?.weeklyResetAt || ''}`} className="space-y-1.5" onSubmit={(event) => { event.preventDefault(); saveInlineLimits(account, new FormData(event.currentTarget)) }}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <div className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-1.5"><span className="text-xs font-medium text-muted-foreground">일</span><Input name="dailyResetTime" type="time" defaultValue={inline?.dailyResetTime ?? account.dailyResetTime ?? ''} aria-label={`${account.name} 일 초기화 시각`} className="h-8 min-w-0 px-1.5 text-xs" /></div>
                    <div className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-1.5"><span className="text-xs font-medium text-muted-foreground">주</span><div className="flex min-w-0 items-center gap-1.5"><input type="hidden" name="weeklyResetDay" value={weeklyResetDay(inline?.weeklyResetAt ?? account.weeklyResetAt) || currentWeeklyResetDay()} /><Input name="weeklyResetTime" type="time" defaultValue={weeklyResetTime(inline?.weeklyResetAt ?? account.weeklyResetAt)} aria-label={`${account.name} 주간 초기화 시각`} className="h-8 min-w-0 flex-1 px-1.5 text-xs" /><Button type="submit" variant="outline" size="icon" className="h-8 w-8 shrink-0" title={`${account.name} 초기화 시각 저장`} disabled={savingLimitIds.includes(account.id)}><Save className="h-3.5 w-3.5" /></Button></div></div>
                    {limitErrors[account.id] ? <p className="text-xs text-destructive">{limitErrors[account.id]}</p> : null}
                  </form>
                  <form action={updateAiAccountAvailabilityAction} className="contents">
                    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="changedField" value="" />
                    <select name="resetAvailableCount" defaultValue={String(account.resetAvailableCount)} onChange={(event) => { const form = event.currentTarget.form; const field = form?.elements.namedItem('changedField'); if (field instanceof HTMLInputElement) field.value = 'resetAvailableCount'; form?.requestSubmit() }} aria-label={`${account.name} 초기화 가능 수`} className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">{[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}개</option>)}</select>
                    <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 text-xs font-medium"><input type="checkbox" name="sharedUse" value="true" defaultChecked={account.sharedUse} disabled={account.sharedUse} onChange={(event) => { const form = event.currentTarget.form; const field = form?.elements.namedItem('changedField'); if (field instanceof HTMLInputElement) field.value = 'sharedUse'; form?.requestSubmit() }} className="h-4 w-4" />{account.sharedUse ? '고정됨' : '사용 중'}</label>
                  </form>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <Dialog.Root open={Boolean(loginAccount)} onOpenChange={(open) => { if (!open) setLoginAccountId(null) }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">{loginAccount?.name || '계정'} 로그인 정보</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">간편 로그인과 GPT 계정 정보를 분리해 관리합니다.</Dialog.Description>
            {loginLoading ? <p className="mt-2 text-xs text-muted-foreground">저장된 비밀번호를 불러오는 중입니다.</p> : null}
            {loginError ? <p className="mt-4 text-sm text-destructive">{loginError}</p> : null}
            {loginAccount && loginInfo ? <form key={`${loginAccount.id}-${loginInfo.loginPassword}-${loginInfo.gptPassword}`} action={updateAiAccountLoginInfoAction} className="mt-5 space-y-4">
              <input type="hidden" name="accountId" value={loginAccount.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">로그인 방식</span><select name="loginMethod" defaultValue={loginInfo.loginMethod} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">선택 안 함</option><option value="피클">피클</option><option value="지메일">지메일</option><option value="네이버">네이버</option><option value="카카오">카카오</option><option value="기타">기타</option></select></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">로그인 아이디</span><Input name="loginId" defaultValue={loginInfo.loginId} autoComplete="username" className="h-9" /></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">로그인 비밀번호</span><Input name="loginPassword" type={showPasswords ? 'text' : 'password'} defaultValue={loginInfo.loginPassword} autoComplete="new-password" className="h-9" /></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">GPT 아이디</span><Input name="gptId" defaultValue={loginInfo.gptId} autoComplete="username" className="h-9" /></label>
                <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">GPT 비밀번호</span><Input name="gptPassword" type={showPasswords ? 'text' : 'password'} defaultValue={loginInfo.gptPassword} autoComplete="new-password" className="h-9" /></label>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" className="h-9" onClick={() => setShowPasswords((current) => !current)}>{showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showPasswords ? '비밀번호 숨기기' : '비밀번호 보기'}</Button>
                <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline" className="h-9">닫기</Button>} />
                <Button type="submit" className="h-9"><Save className="h-4 w-4" />저장</Button>
              </div>
            </form> : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

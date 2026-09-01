'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Eye, EyeOff, KeyRound, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  normalizeWeeklyResetCodeInput,
  parseWeeklyResetCode,
  weeklyResetCodeValue,
} from '@/lib/operations/ai-account-reset-code'
import {
  bulkResetAiAccountRuntimeStateAction,
  readAiAccountLoginInfoAction,
  resetAiAccountRuntimeStateAction,
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

function normalizeTimeInput(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 3) return `0${digits.slice(0, 1)}:${digits.slice(1)}`
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`
  return value
}

export function AiAccountBoard({ accounts, userCandidates, statusLabels }: Props) {
  const [, startTransition] = useTransition()
  const [inlineLimits, setInlineLimits] = useState<Record<string, { dailyLimit: string | null; dailyResetTime: string | null; weeklyLimit: string | null; weeklyResetAt: string | null }>>({})
  const [savingLimitIds, setSavingLimitIds] = useState<string[]>([])
  const [limitErrors, setLimitErrors] = useState<Record<string, string>>({})
  const [operationalOverrides, setOperationalOverrides] = useState<Record<string, { status: string; currentUserName: string | null }>>({})
  const [operationalErrors, setOperationalErrors] = useState<Record<string, string>>({})
  const operationalRevisions = useRef<Record<string, number>>({})
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null)
  const [loginInfo, setLoginInfo] = useState<LoginInfo | null>(null)
  const [loginInfoCache, setLoginInfoCache] = useState<Record<string, LoginInfo>>({})
  const [loginLoading, setLoginLoading] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginNotice, setLoginNotice] = useState('')
  const [savingLogin, setSavingLogin] = useState(false)

  const sortedAccounts = useMemo(() => accounts.map((account, index) => ({ account, index }))
    .sort((left, right) => Number(right.account.sharedUse) - Number(left.account.sharedUse) || right.account.resetAvailableCount - left.account.resetAvailableCount || left.index - right.index)
    .map(({ account }) => account), [accounts])
  const sharedAccountCount = accounts.filter((account) => account.sharedUse).length
  const resetAvailableTotal = accounts.reduce((total, account) => total + account.resetAvailableCount, 0)
  const loginAccount = accounts.find((account) => account.id === loginAccountId) || null

  function saveInlineLimits(account: AiAccountRow, formData: FormData) {
    const dailyResetTime = normalizeTimeInput(String(formData.get('dailyResetTime') || '').trim())
    const weeklyResetCode = normalizeWeeklyResetCodeInput(String(formData.get('weeklyResetTime') || '').trim())
    const weeklyReset = parseWeeklyResetCode(weeklyResetCode)
    if (weeklyReset.error) {
      setLimitErrors((current) => ({ ...current, [account.id]: weeklyReset.error || '주간 초기화 시각을 확인해주세요.' }))
      return
    }
    formData.set('dailyResetTime', dailyResetTime)
    formData.set('weeklyResetTime', weeklyResetCode)
    setInlineLimits((current) => ({ ...current, [account.id]: {
      dailyLimit: null,
      dailyResetTime: dailyResetTime || null,
      weeklyLimit: weeklyReset.code,
      weeklyResetAt: weeklyReset.resetAt?.toISOString() || null,
    } }))
    setLimitErrors((current) => ({ ...current, [account.id]: '' }))
    setSavingLimitIds((current) => [...current, account.id])
    startTransition(async () => {
      const result = await updateAiAccountLimitsAction(formData)
      setSavingLimitIds((current) => current.filter((id) => id !== account.id))
      if ('error' in result) setLimitErrors((current) => ({ ...current, [account.id]: result.error || '한도를 저장하지 못했습니다.' }))
    })
  }

  function saveOperationalState(account: AiAccountRow, changedField: 'status' | 'currentUserName', value: string) {
    const previous = operationalOverrides[account.id] || {
      status: normalizeStatus(account.status),
      currentUserName: account.currentUserName,
    }
    const next = { ...previous }
    if (changedField === 'status') {
      next.status = normalizeStatus(value)
      if (next.status === 'unselected') next.currentUserName = null
    } else {
      next.currentUserName = value || null
      if (next.status !== 'daily_limit_reached' && next.status !== 'weekly_limit_reached') {
        next.status = next.currentUserName ? 'in_use' : 'unselected'
      }
    }

    const revision = (operationalRevisions.current[account.id] || 0) + 1
    operationalRevisions.current[account.id] = revision
    setOperationalOverrides((current) => ({ ...current, [account.id]: next }))
    setOperationalErrors((current) => ({ ...current, [account.id]: '' }))

    const formData = new FormData()
    formData.set('accountId', account.id)
    formData.set('changedField', changedField)
    formData.set('status', next.status)
    formData.set('currentUserName', next.currentUserName || '')
    startTransition(async () => {
      const result = await updateAiAccountOperationalStateAction(formData)
      if (operationalRevisions.current[account.id] !== revision || !('error' in result)) return
      setOperationalOverrides((current) => ({ ...current, [account.id]: previous }))
      setOperationalErrors((current) => ({ ...current, [account.id]: result.error || '상태를 저장하지 못했습니다.' }))
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
    setLoginNotice('')
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

  function saveLoginInfo(formData: FormData) {
    setLoginError('')
    setLoginNotice('')
    setSavingLogin(true)
    startTransition(async () => {
      const result = await updateAiAccountLoginInfoAction(formData)
      setSavingLogin(false)
      if ('error' in result) return setLoginError(result.error || '로그인 정보를 저장하지 못했습니다.')
      setLoginInfoCache((current) => ({
        ...current,
        [String(formData.get('accountId'))]: {
          loginMethod: String(formData.get('loginMethod') || ''),
          loginId: String(formData.get('loginId') || ''),
          loginPassword: String(formData.get('loginPassword') || ''),
          gptId: String(formData.get('gptId') || ''),
          gptPassword: String(formData.get('gptPassword') || ''),
        },
      }))
      setLoginNotice('저장했습니다.')
    })
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
          <div className="hidden border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_minmax(420px,3.2fr)_minmax(80px,0.7fr)_minmax(100px,0.8fr)_42px] md:items-center md:gap-2">
            <div>계정명</div><div>상태</div><div>사용자</div><div>일간/주간 초기화 시각</div><div className="flex items-center gap-2">초기화<form action={bulkResetAiAccountRuntimeStateAction}><Button type="submit" variant="outline" className="h-7 px-2 text-[11px]"><RotateCcw className="h-3 w-3" />일괄</Button></form></div><div>공유 사용</div><div className="sr-only">로그인 정보</div>
          </div>
          <div className="divide-y">
            {sortedAccounts.map((account) => {
              const operational = operationalOverrides[account.id]
              const displayStatus = normalizeStatus(operational?.status || account.status)
              const displayCurrentUserName = operational ? operational.currentUserName : account.currentUserName
              const candidateNames = userCandidates.map((candidate) => candidate.name)
              const inline = inlineLimits[account.id]
              return (
                <div key={account.id} className={cn('grid w-full gap-3 px-3 py-3 md:grid-cols-[minmax(130px,1.1fr)_minmax(110px,0.9fr)_minmax(120px,1fr)_minmax(420px,3.2fr)_minmax(80px,0.7fr)_minmax(100px,0.8fr)_42px] md:items-center md:gap-2', account.sharedUse && 'bg-emerald-50/50')}>
                  <button type="button" onClick={() => openLoginInfo(account.id)} className="truncate whitespace-nowrap text-left text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={`${account.name} 로그인 정보 열기`}>{account.name}</button>
                  <div className="contents">
                    <select value={displayStatus} onChange={(event) => saveOperationalState(account, 'status', event.currentTarget.value)} aria-label={`${account.name} 상태`} aria-invalid={Boolean(operationalErrors[account.id])} title={operationalErrors[account.id] || undefined} className={cn('h-9 w-full rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', statusClassName(displayStatus))}>
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select value={displayCurrentUserName || ''} onChange={(event) => saveOperationalState(account, 'currentUserName', event.currentTarget.value)} aria-label={`${account.name} 사용자`} aria-invalid={Boolean(operationalErrors[account.id])} title={operationalErrors[account.id] || undefined} className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">사용자 없음</option>
                      {displayCurrentUserName && !candidateNames.includes(displayCurrentUserName) ? <option value={displayCurrentUserName}>{displayCurrentUserName}</option> : null}
                      {userCandidates.map((candidate) => <option key={candidate.id} value={candidate.name}>{candidate.name}</option>)}
                    </select>
                  </div>
                  <form key={`${account.id}-${inline?.dailyLimit || ''}-${inline?.dailyResetTime || ''}-${inline?.weeklyLimit || ''}-${inline?.weeklyResetAt || ''}`} className="grid grid-cols-[34px_minmax(0,1fr)_34px_minmax(0,1fr)_32px] items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); saveInlineLimits(account, new FormData(event.currentTarget)) }}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <span className="text-xs font-medium text-muted-foreground">일간</span><Input name="dailyResetTime" type="text" inputMode="numeric" placeholder="00:00" defaultValue={inline?.dailyResetTime ?? account.dailyResetTime ?? ''} onBlur={(event) => { event.currentTarget.value = normalizeTimeInput(event.currentTarget.value) }} aria-label={`${account.name} 일간 초기화 시각`} className="h-8 min-w-0 px-2 text-xs" />
                    <span className="text-xs font-medium text-muted-foreground">주간</span><Input name="weeklyResetTime" type="text" inputMode="numeric" placeholder="HHMMMMDD" defaultValue={weeklyResetCodeValue(inline?.weeklyLimit ?? account.weeklyLimit, inline?.weeklyResetAt ?? account.weeklyResetAt)} onBlur={(event) => { event.currentTarget.value = normalizeWeeklyResetCodeInput(event.currentTarget.value) }} aria-label={`${account.name} 주간 초기화 일시`} title="시간 4자리만 입력하면 날짜는 0000으로 저장됩니다." className="h-8 min-w-0 px-2 text-xs" /><Button type="submit" variant="outline" size="icon" className="h-8 w-8 shrink-0" title={`${account.name} 초기화 시각 저장`} disabled={savingLimitIds.includes(account.id)}><Save className="h-3.5 w-3.5" /></Button>
                    {limitErrors[account.id] ? <p className="col-span-5 text-xs text-destructive">{limitErrors[account.id]}</p> : null}
                  </form>
                  <form action={async (formData) => { await resetAiAccountRuntimeStateAction(formData) }}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <Button type="submit" variant="outline" className="h-9 w-full text-xs" title={`${account.name} 상태와 초기화 시각 초기화`}><RotateCcw className="h-3.5 w-3.5" />초기화</Button>
                  </form>
                  <form action={updateAiAccountAvailabilityAction} className="contents">
                    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="changedField" value="" />
                    <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 text-xs font-medium"><input type="checkbox" name="sharedUse" value="true" defaultChecked={account.sharedUse} disabled={account.sharedUse} onChange={(event) => { const form = event.currentTarget.form; const field = form?.elements.namedItem('changedField'); if (field instanceof HTMLInputElement) field.value = 'sharedUse'; form?.requestSubmit() }} className="h-4 w-4" />{account.sharedUse ? '고정됨' : '사용 중'}</label>
                  </form>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" title={`${account.name} 로그인 정보`} onClick={() => openLoginInfo(account.id)}><KeyRound className="h-4 w-4" /></Button>
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
            {loginNotice ? <p className="mt-4 text-sm text-emerald-700">{loginNotice}</p> : null}
            {loginAccount && loginInfo ? <form key={`${loginAccount.id}-${loginInfo.loginPassword}-${loginInfo.gptPassword}`} onSubmit={(event) => { event.preventDefault(); saveLoginInfo(new FormData(event.currentTarget)) }} className="mt-5 space-y-4">
              <input type="hidden" name="accountId" value={loginAccount.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">로그인 방식</span><select name="loginMethod" defaultValue={loginInfo.loginMethod} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">선택 안 함</option><option value="피클">피클</option><option value="지메일">지메일</option><option value="네이버">네이버</option><option value="카카오">카카오</option><option value="기타">기타</option></select></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">로그인 아이디</span><Input name="loginId" defaultValue={loginInfo.loginId} autoComplete="username" className="h-9" /></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">로그인 비밀번호</span><Input name="loginPassword" type={showPasswords ? 'text' : 'password'} defaultValue={loginInfo.loginPassword} autoComplete="new-password" className="h-9" /></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">GPT 아이디</span><Input name="gptId" defaultValue={loginInfo.gptId} autoComplete="username" className="h-9" /></label>
                <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">GPT 비밀번호</span><Input name="gptPassword" type={showPasswords ? 'text' : 'password'} defaultValue={loginInfo.gptPassword} autoComplete="new-password" className="h-9" /></label>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" className="h-9" onClick={() => setShowPasswords((current) => !current)}>{showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showPasswords ? '비밀번호 숨기기' : '비밀번호 보기'}</Button>
                <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline" className="h-9">닫기</Button>} />
                <Button type="submit" className="h-9" disabled={savingLogin}>{savingLogin ? '저장 중' : '저장'}</Button>
              </div>
            </form> : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

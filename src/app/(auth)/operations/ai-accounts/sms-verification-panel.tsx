'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import {
  Copy,
  Download,
  Link2,
  Loader2,
  MessageSquareText,
  QrCode,
  Radio,
  ShieldCheck,
  Smartphone,
  Unplug,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Account = { id: string; name: string; email: string | null }
type Device = {
  id: string
  accountId: string | null
  accountName: string | null
  name: string
  phoneLabel: string | null
  appVersion: string | null
  lastSeenAt: string | Date | null
  revokedAt: string | Date | null
  createdAt: string | Date
}
type SmsMessage = {
  id: string
  accountId: string | null
  accountName: string | null
  deviceId: string
  deviceName: string
  sender: string | null
  body: string
  verificationCode: string | null
  receivedAt: string | Date
  expiresAt: string | Date
}

type Props = {
  accounts: Account[]
  initialDevices: Device[]
  initialMessages: SmsMessage[]
}

function asTimestamp(value: string | Date | null) {
  return value ? new Date(value).getTime() : 0
}

function formatDateTime(value: string | Date | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-md border bg-background shadow-xl" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function SmsVerificationPanel({ accounts, initialDevices, initialMessages }: Props) {
  const [devices, setDevices] = useState(initialDevices)
  const [messages, setMessages] = useState(initialMessages)
  const [serverNow, setServerNow] = useState(Date.now())
  const [pairingOpen, setPairingOpen] = useState(false)
  const [pairingAccountId, setPairingAccountId] = useState(accounts[0]?.id || '')
  const [deviceLabel, setDeviceLabel] = useState('')
  const [pairing, setPairing] = useState<{ qrDataUrl: string; expiresAt: string } | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [authAccountId, setAuthAccountId] = useState<string | null>(null)

  async function refresh() {
    const response = await fetch('/api/sms-bridge/messages', { cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json()
    setDevices(data.devices || [])
    setMessages(data.messages || [])
    setServerNow(new Date(data.serverNow).getTime())
  }

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), 4_000)
    return () => window.clearInterval(interval)
  }, [])

  const activeDevices = useMemo(() => devices.filter((device) => !device.revokedAt), [devices])
  const latestByAccount = useMemo(() => {
    const result = new Map<string, SmsMessage>()
    for (const message of messages) {
      if (message.accountId && !result.has(message.accountId)) result.set(message.accountId, message)
    }
    return result
  }, [messages])

  async function createPairing() {
    if (!pairingAccountId) return
    setPairingBusy(true)
    try {
      const response = await fetch('/api/sms-bridge/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: pairingAccountId, deviceLabel }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '연결 QR을 만들지 못했습니다.')
      setPairing({ qrDataUrl: data.qrDataUrl, expiresAt: data.expiresAt })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '연결 QR을 만들지 못했습니다.')
    } finally {
      setPairingBusy(false)
    }
  }

  async function revokeDevice(deviceId: string) {
    if (!window.confirm('이 휴대폰의 문자 연동을 해제할까요?')) return
    const response = await fetch(`/api/sms-bridge/devices/${deviceId}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return toast.error(data.error || '기기 연결을 해제하지 못했습니다.')
    toast.success('기기 연결을 해제했습니다.')
    await refresh()
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code)
    toast.success('인증번호를 복사했습니다.')
  }

  const authAccount = accounts.find((account) => account.id === authAccountId) || null
  const authMessage = authAccount ? latestByAccount.get(authAccount.id) || null : null
  const authMessageValid = authMessage ? asTimestamp(authMessage.expiresAt) > serverNow : false

  return (
    <section className="rounded-md border bg-background">
      <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4" />
            <h2 className="text-base font-semibold">피클플러스 인증문자</h2>
            <Badge variant="outline" className="rounded-full">Android</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">연결된 휴대폰에서 피클플러스 인증문자만 받아옵니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/downloads/funtastic-sms-bridge.apk" download className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Download className="h-4 w-4" />
            Android APK
          </a>
          <Button size="sm" onClick={() => { setPairing(null); setPairingOpen(true) }} disabled={!accounts.length}>
            <QrCode className="h-4 w-4" />
            휴대폰 연결
          </Button>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(560px,1fr)_420px]">
        <div className="min-w-0 border-b xl:border-b-0 xl:border-r">
          <div className="grid grid-cols-[110px_minmax(150px,1fr)_120px_100px] gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
            <span>계정</span><span>연결 휴대폰</span><span>최근 인증번호</span><span>액션</span>
          </div>
          <div className="divide-y">
            {accounts.map((account) => {
              const accountDevices = activeDevices.filter((device) => device.accountId === account.id)
              const latest = latestByAccount.get(account.id)
              const valid = latest ? asTimestamp(latest.expiresAt) > serverNow : false
              return (
                <div key={account.id} className="grid min-h-14 grid-cols-[110px_minmax(150px,1fr)_120px_100px] items-center gap-2 px-4 py-2 text-sm">
                  <span className="truncate font-medium">{account.name}</span>
                  <span className="truncate text-muted-foreground">
                    {accountDevices.length ? accountDevices.map((device) => device.phoneLabel || device.name).join(', ') : '미연결'}
                  </span>
                  <span className={cn('font-mono font-semibold', valid ? 'text-emerald-700' : 'text-muted-foreground')}>
                    {valid ? latest?.verificationCode || '코드 확인' : '대기 중'}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setAuthAccountId(account.id)}>
                    <ShieldCheck className="h-4 w-4" />
                    인증하기
                  </Button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">연결된 휴대폰</h3>
            <span className="text-xs text-muted-foreground">{activeDevices.length}대</span>
          </div>
          <div className="space-y-2">
            {activeDevices.length ? activeDevices.map((device) => {
              const online = asTimestamp(device.lastSeenAt) > serverNow - 10 * 60_000
              return (
                <div key={device.id} className="flex items-center gap-3 rounded-md border p-3">
                  <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{device.phoneLabel || device.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{device.accountName || '계정 미지정'} · 마지막 연결 {formatDateTime(device.lastSeenAt)}</p>
                  </div>
                  <Badge variant="outline" className={cn('rounded-full', online ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : '')}>
                    <Radio className="h-3 w-3" /> {online ? '연결됨' : '오프라인'}
                  </Badge>
                  <Button size="icon-sm" variant="ghost" title="연결 해제" onClick={() => void revokeDevice(device.id)}>
                    <Unplug className="h-4 w-4" />
                  </Button>
                </div>
              )
            }) : (
              <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">연결된 휴대폰이 없습니다.</div>
            )}
          </div>
        </div>
      </div>

      {pairingOpen ? (
        <Modal onClose={() => setPairingOpen(false)}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div><h3 className="font-semibold">휴대폰 연결</h3><p className="text-xs text-muted-foreground">APK에서 QR 연결을 눌러 스캔하세요.</p></div>
            <Button size="icon-sm" variant="ghost" onClick={() => setPairingOpen(false)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-3 p-4">
            {!pairing ? (
              <>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">연결할 AI 계정</span>
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={pairingAccountId} onChange={(event) => setPairingAccountId(event.target.value)}>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email || '-'}</option>)}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">휴대폰 메모</span>
                  <Input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="예: 김기환 업무폰" maxLength={100} />
                </label>
                <Button className="w-full" onClick={() => void createPairing()} disabled={pairingBusy}>
                  {pairingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  연결 QR 만들기
                </Button>
              </>
            ) : (
              <div className="text-center">
                {/* QR contains only a one-time, ten-minute pairing token. */}
                <Image src={pairing.qrDataUrl} alt="휴대폰 연결 QR" width={256} height={256} unoptimized className="mx-auto aspect-square w-64 border" />
                <p className="mt-3 text-sm font-medium">10분 안에 스캔해주세요.</p>
                <p className="text-xs text-muted-foreground">연결되면 이 창을 닫아도 됩니다.</p>
              </div>
            )}
          </div>
        </Modal>
      ) : null}

      {authAccount ? (
        <Modal onClose={() => setAuthAccountId(null)}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div><h3 className="font-semibold">{authAccount.name} 인증하기</h3><p className="text-xs text-muted-foreground">새 인증문자를 기다리는 동안 자동 갱신됩니다.</p></div>
            <Button size="icon-sm" variant="ghost" onClick={() => setAuthAccountId(null)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="p-5 text-center">
            {authMessageValid ? (
              <>
                <p className="text-xs text-muted-foreground">피클플러스 인증번호</p>
                <p className="my-3 font-mono text-4xl font-semibold tracking-normal">{authMessage?.verificationCode || '본문 확인'}</p>
                {authMessage?.verificationCode ? (
                  <Button onClick={() => void copyCode(authMessage.verificationCode!)}><Copy className="h-4 w-4" />인증번호 복사</Button>
                ) : null}
                <p className="mt-4 break-words rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">{authMessage?.body}</p>
              </>
            ) : (
              <div className="py-8">
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
                <p className="mt-3 font-medium">인증문자 대기 중</p>
                <p className="mt-1 text-xs text-muted-foreground">연결된 휴대폰에 문자가 도착하면 바로 표시됩니다.</p>
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </section>
  )
}

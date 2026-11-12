'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'

type UploadResult = {
  success: boolean
  error?: string
  code?: string
  fileName?: string
  meetingDate?: string
  rowCount?: number
  productCount?: number
  totalQuantity?: number
  warnings?: string[]
  preview?: Array<{ sku: string; productName: string; optionName: string; quantity: number }>
}

export function ShortMeetingUpload({ defaultDate }: { defaultDate: string }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [filePassword, setFilePassword] = useState('')
  const [meetingDate, setMeetingDate] = useState(defaultDate)
  const [preview, setPreview] = useState<UploadResult | null>(null)
  const [pending, setPending] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(action: 'preview' | 'apply') {
    if (!file || !meetingDate || pending) return
    setPending(action)
    setError(null)
    setPasswordError(false)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('meetingDate', meetingDate)
      formData.append('action', action)
      if (filePassword) formData.append('filePassword', filePassword)
      const response = await fetch('/api/analytics/short-meeting/upload', { method: 'POST', body: formData })
      const result = await response.json() as UploadResult
      if (!response.ok || !result.success) {
        if (result.code === 'excel_password_required' || result.code === 'excel_password_invalid') {
          setPreview(null)
          setPasswordError(true)
          throw new Error(result.error || (result.code === 'excel_password_required' ? '엑셀 파일 암호를 입력해 주세요.' : '엑셀 파일 암호가 올바르지 않습니다.'))
        }
        throw new Error(result.error || '파일을 처리하지 못했습니다.')
      }
      if (action === 'preview') {
        setPreview(result)
      } else {
        setMessage(`${meetingDate} 주문서를 숏미팅에 반영했습니다.`)
        setPreview(null)
        setFile(null)
        setFilePassword('')
        if (input.current) input.current.value = ''
        router.push(`/analytics/short-meeting?date=${meetingDate}`)
        router.refresh()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '파일을 처리하지 못했습니다.')
    } finally {
      setPending(null)
    }
  }

  return (
    <section aria-labelledby="short-meeting-upload-title" className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 id="short-meeting-upload-title" className="flex items-center gap-2 text-base font-semibold"><FileSpreadsheet className="size-4" />숏미팅 주문서 업로드</h2>
        <p className="mt-1 text-sm text-muted-foreground">주문서의 전체 행을 기준일의 숏미팅 대상으로 사용합니다. 미리보기에서 확인 후 반영해 주세요.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">기준일<input type="date" value={meetingDate} disabled={Boolean(pending)} onChange={(event) => { setMeetingDate(event.target.value); setPreview(null); setError(null); setPasswordError(false); setMessage(null) }} className="h-9 rounded-md border bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">주문서 엑셀<input ref={input} type="file" accept=".xlsx" disabled={Boolean(pending)} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFilePassword(''); setPreview(null); setError(null); setPasswordError(false); setMessage(null) }} className="max-w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2 file:text-sm" /></label>
        <label className="grid gap-1 text-sm">엑셀 암호 (설정된 경우)<input type="password" autoComplete="off" value={filePassword} disabled={Boolean(pending)} aria-invalid={passwordError || undefined} aria-describedby={passwordError ? 'short-meeting-upload-error' : undefined} onChange={(event) => { setFilePassword(event.target.value); setPreview(null); setError(null); setPasswordError(false); setMessage(null) }} className="h-9 rounded-md border bg-background px-3" /></label>
        <Button type="button" variant="outline" disabled={!file || !meetingDate || Boolean(pending)} onClick={() => void submit('preview')}>{pending === 'preview' ? '확인 중...' : '미리보기'}</Button>
      </div>
      {error && <p id="short-meeting-upload-error" role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {preview && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <p className="text-sm font-medium">{preview.fileName || file?.name} · {preview.meetingDate || meetingDate} · {preview.rowCount?.toLocaleString('ko-KR') ?? '-'}건 · {preview.productCount?.toLocaleString('ko-KR') ?? '-'}개 품목 · 출고수량 {preview.totalQuantity?.toLocaleString('ko-KR') ?? '-'}개</p>
          <p className="text-xs text-muted-foreground">같은 기준일에 다시 반영하면 기존 숏미팅 주문서가 새 파일로 바뀝니다.</p>
          {Boolean(preview.warnings?.length) && <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700">{preview.warnings?.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
          {Boolean(preview.preview?.length) && <div className="max-h-48 overflow-auto rounded-md border bg-background"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="px-3 py-2 font-medium">품목코드</th><th className="px-3 py-2 font-medium">상품명 / 옵션</th><th className="px-3 py-2 text-right font-medium">출고수량</th></tr></thead><tbody>{preview.preview?.map((item) => <tr className="border-t" key={item.sku}><td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{item.sku}</td><td className="px-3 py-2">{item.productName} / {item.optionName}</td><td className="px-3 py-2 text-right tabular-nums">{item.quantity.toLocaleString('ko-KR')}</td></tr>)}</tbody></table></div>}
          <Button type="button" disabled={Boolean(pending)} onClick={() => void submit('apply')}>{pending === 'apply' ? '반영 중...' : '숏미팅에 반영'}</Button>
        </div>
      )}
    </section>
  )
}

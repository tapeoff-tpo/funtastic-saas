'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { FileText, Printer, Upload } from 'lucide-react'
import {
  INSPECTION_LABEL_FILE_LIMIT, INSPECTION_LABEL_FILE_TYPES, INSPECTION_LABEL_KINDS,
  type InspectionLabelFile, type InspectionLabelKind,
} from '@/lib/purchasing/purchase-inspection-label-types'

const titles = { quality: '품질표시사항', barcode: '바코드 스티커' } as const
const linkStyle = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted'

export function PurchaseInspectionLabelPanel({ id, canUpload }: { id: string; canUpload: boolean }) {
  const endpoint = `/api/purchasing/purchase-requests/${id}/inspection/labels`
  const [files, setFiles] = useState<InspectionLabelFile[] | null>(null)
  const [uploading, setUploading] = useState<InspectionLabelKind | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok || !Array.isArray(body.files)) throw new Error(body.error ?? '스티커 자료를 불러오지 못했습니다.')
        if (!controller.signal.aborted) setFiles(body.files)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : '스티커 자료를 불러오지 못했습니다.')
          setFiles([])
        }
      })
    return () => controller.abort()
  }, [endpoint, attempt])

  async function upload(event: ChangeEvent<HTMLInputElement>, kind: InspectionLabelKind) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || uploading) return
    if (file.size > INSPECTION_LABEL_FILE_LIMIT) {
      setError('PDF 또는 이미지 파일은 4MB 이하로 선택해주세요.')
      return
    }
    setError('')
    setUploading(kind)
    try {
      const body = new FormData()
      body.set('kind', kind)
      body.set('file', file)
      const response = await fetch(endpoint, { method: 'POST', body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? '스티커 자료를 저장하지 못했습니다.')
      setFiles((current) => [result.file as InspectionLabelFile, ...(current ?? []).filter((entry) => entry.kind !== kind || entry.source !== 'upload')])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '스티커 자료를 저장하지 못했습니다.')
    } finally {
      setUploading(null)
    }
  }

  return <section className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">
      {INSPECTION_LABEL_KINDS.map((kind) => {
        const entries = files?.filter((file) => file.kind === kind) ?? []
        return <div key={kind} className="min-w-0 space-y-2 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{titles[kind]}</h3>
            {canUpload && <label className={`${linkStyle} relative ${files === null || uploading ? 'opacity-50' : 'cursor-pointer'}`}>
              <Upload className="size-3.5" />{uploading === kind ? '저장 중…' : '파일 등록'}
              <input type="file" aria-label={`${titles[kind]} 파일 등록`} accept={INSPECTION_LABEL_FILE_TYPES.join(',')}
                className="absolute inset-0 size-full cursor-inherit opacity-0" disabled={files === null || uploading !== null}
                onChange={(event) => void upload(event, kind)} />
            </label>}
          </div>
          {!entries.length && <p className="text-xs text-muted-foreground">{files === null ? '불러오는 중…' : '등록된 파일 없음'}</p>}
          {entries.map((file) => {
            const href = `${endpoint}?file=${encodeURIComponent(file.id)}&source=${encodeURIComponent(file.source)}`
            return <div key={`${file.source}:${file.id}`} className="flex items-center gap-2">
              <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-2 text-xs hover:underline">
                {file.contentType.startsWith('image/') ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- protected, same-origin sticker thumbnail */
                  <img src={href} alt={titles[kind]} loading="lazy" className="size-10 shrink-0 rounded border bg-white object-contain" />
                ) : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                <span title={file.fileName} data-no-translate className="truncate">{file.fileName}</span>
              </a>
              <a href={`${href}&print=1`} target="_blank" rel="noopener noreferrer" className={linkStyle} aria-label={`${titles[kind]} 인쇄`}>
                <Printer className="size-3.5" />인쇄
              </a>
            </div>
          })}
        </div>
      })}
    </div>
    {error && <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-700">
      {error}
      <button type="button" className="underline" onClick={() => { setError(''); setFiles(null); setAttempt((value) => value + 1) }}>다시 불러오기</button>
    </p>}
  </section>
}

'use client'

import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEFAULT_IMAGE_URL = 'https://funtastic-saas-vercel.vercel.app/detail-page-assets/delto-kennel-cp3-dog-paws-v2.png'

export default function FigmaImageReplacementPage() {
  const [frameName, setFrameName] = useState('델토 더블도어 켄넬')
  const [layerName, setLayerName] = useState('top open door proof / pet peeking through open lid')
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGE_URL)
  const [result, setResult] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    setResult('')
    try {
      const response = await fetch('/api/operations/detail-pages/image-replacements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figmaFileKey: 'X8yYgVtrAFKycEA0yy0kWI',
          targetFrameName: frameName,
          targetNodeName: layerName,
          imageUrl,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || '교체 요청을 저장하지 못했습니다.')
      setResult('교체 요청을 전달했습니다. 연결된 Figma 플러그인이 다음 동기화 때 적용합니다.')
    } catch (error) {
      setResult(error instanceof Error ? error.message : '교체 요청을 저장하지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 py-8">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold"><ImagePlus className="size-5" /> Figma 이미지 교체</h1>
        <p className="mt-1 text-sm text-muted-foreground">연결된 Figma 플러그인이 지정 레이어의 이미지만 교체합니다.</p>
      </header>
      <div className="grid gap-5 rounded-lg border bg-card p-6">
        <div className="grid gap-2">
          <Label htmlFor="frame-name">프레임 이름</Label>
          <Input id="frame-name" value={frameName} onChange={(event) => setFrameName(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="layer-name">이미지 레이어 이름</Label>
          <Input id="layer-name" value={layerName} onChange={(event) => setLayerName(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="image-url">새 이미지 URL</Label>
          <Input id="image-url" type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
        </div>
        <Button type="button" onClick={submit} disabled={submitting || !frameName || !layerName || !imageUrl}>
          <ImagePlus />{submitting ? '요청 중' : '이미지 교체 요청'}
        </Button>
        {result ? <p className="text-sm text-muted-foreground" role="status">{result}</p> : null}
      </div>
    </main>
  )
}

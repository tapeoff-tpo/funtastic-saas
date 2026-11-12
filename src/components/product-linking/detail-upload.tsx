'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { uploadWorkflowDetailPageAction } from './actions'

export function DetailUpload({ itemId }: { itemId: string }) {
  const [url, setUrl] = useState('')
  const [pending, startTransition] = useTransition()
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        startTransition(async () => {
          const result = await uploadWorkflowDetailPageAction(itemId, form)
          if (!result.success) {
            toast.error(result.error)
            return
          }
          setUrl(result.url)
          toast.success(
            'Cloudflare에 등록하고 상품에 상세페이지 주소를 저장했습니다.',
          )
        })
      }}
    >
      <label className="text-xs">
        완성 상세페이지 이미지
        <input
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="ml-2 text-xs"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border px-2 py-1 text-xs"
      >
        Cloudflare에 등록
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          등록한 상세페이지 열기
        </a>
      )}
    </form>
  )
}

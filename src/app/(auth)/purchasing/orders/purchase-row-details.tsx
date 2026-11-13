'use client'

import type { ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PurchaseRowDetails({ children, productName, sku, attention = false }: {
  children: ReactNode
  productName: string
  sku: string
  attention?: boolean
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={
        <Button type="button" variant="outline" size="sm" className={`h-7 px-2 text-xs ${attention ? 'border-red-300 bg-red-50 text-red-800' : ''}`} aria-label="발주 상세 보기" title="추가 정보 보기" />
      }>
        상세
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(800px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-background shadow-xl">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">발주 상세</Dialog.Title>
              <Dialog.Description data-no-translate className="mt-1 break-words text-sm text-muted-foreground">
                {sku} · {productName}
              </Dialog.Description>
            </div>
            <Dialog.Close render={<Button type="button" variant="ghost" size="icon-sm" aria-label="닫기" />}>
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 [&>*]:min-w-0">
            {children}
          </div>
          <div className="flex shrink-0 justify-end border-t px-4 py-3">
            <Dialog.Close render={<Button type="button" variant="outline" size="sm" />}>닫기</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

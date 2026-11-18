'use client'
import { useRouter, useSearchParams } from 'next/navigation'

export function RegistrationOptionSelector({ selected, options }: {
  selected: string
  options: Array<{ id: string; sku: string; label: string }>
}) {
  const router = useRouter()
  const search = useSearchParams()
  return <label className="grid gap-1 text-xs text-muted-foreground">확인할 옵션
    <select value={selected} aria-label="확인할 옵션" onChange={(event) => {
      const params = new URLSearchParams(search.toString())
      params.set('row', event.target.value)
      router.replace(`/operations/marketplace-registration?${params}`, { scroll: false })
    }} className="min-w-0 rounded-md border bg-background px-2 py-2 text-sm text-foreground">
      {options.map((option) => <option key={option.id} value={option.id}>{option.label || '기본 옵션'} · {option.sku}</option>)}
    </select>
  </label>
}

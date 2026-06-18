'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveSalesExportSettings } from '../marketplaces/actions'
import { createCustomMarketplace } from './actions'

export interface MarketSettingsItem {
  id: string
  marketplaceId: string
  marketplaceName: string
  storeAlias: string
  displayName: string
  systemMarketplaceName: string
  salesExportMarketplaceId: string
  salesFeePercent: string
  linkedMarketplaces: string[]
  isCommon: boolean
  isCustom?: boolean
}

export function MarketSettingsList({ connections }: { connections: MarketSettingsItem[] }) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return connections
    return connections.filter((connection) => [
      connection.marketplaceId,
      connection.marketplaceName,
      connection.storeAlias,
      connection.displayName,
      connection.systemMarketplaceName,
      connection.salesExportMarketplaceId,
      ...connection.linkedMarketplaces,
    ].some((value) => value.toLowerCase().includes(query)))
  }, [connections, search])

  return (
    <div className="space-y-3">
      <AddMarketplaceForm />
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="마켓명, 계정명, 표시용 마켓명 검색"
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {filtered.length.toLocaleString('ko-KR')}개 마켓
        </span>
      </div>

      <div className="divide-y rounded-md border bg-white">
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">조건에 맞는 마켓 계정이 없습니다.</div>
        ) : filtered.map((connection) => (
          <MarketSettingsRow key={connection.id} connection={connection} />
        ))}
      </div>
    </div>
  )
}

function AddMarketplaceForm() {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(createCustomMarketplace, null)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message ?? '마켓을 추가했습니다.')
      router.refresh()
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [router, state])

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border bg-white p-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor="custom-marketplace-name">마켓 추가</Label>
        <Input
          id="custom-marketplace-name"
          name="marketplace_name"
          placeholder="추가할 마켓명"
          maxLength={100}
          required
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={isPending}>
        <Plus className="h-4 w-4" />
        {isPending ? '추가 중...' : '추가'}
      </Button>
    </form>
  )
}

function MarketSettingsRow({ connection }: { connection: MarketSettingsItem }) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(saveSalesExportSettings, null)

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message ?? '마켓 설정을 저장했습니다.')
      router.refresh()
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [router, state])

  return (
    <form action={formAction} className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_minmax(180px,1fr)_140px_auto] xl:items-end">
      <input type="hidden" name="connection_id" value={connection.isCommon ? '' : connection.id} />
      <input type="hidden" name="marketplace_id" value={connection.marketplaceId} />
      <div className="min-w-0 self-center">
        <div className="font-medium">{connection.marketplaceName}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {connection.isCustom ? '직접 추가한 마켓' : connection.isCommon ? '연결 전 공통 설정' : `연결 계정명: ${connection.storeAlias}`}
          {connection.linkedMarketplaces.length > 0 ? ` · 연동몰: ${connection.linkedMarketplaces.join(', ')}` : ''}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${connection.id}-system-name`}>표시용 마켓명</Label>
        <Input
          id={`${connection.id}-system-name`}
          name="system_marketplace_name"
          defaultValue={connection.systemMarketplaceName}
          placeholder={connection.marketplaceName}
          maxLength={100}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${connection.id}-sales-id`}>매출확인용 아이디</Label>
        <Input
          id={`${connection.id}-sales-id`}
          name="sales_export_marketplace_id"
          defaultValue={connection.salesExportMarketplaceId}
          maxLength={100}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${connection.id}-fee`}>수수료율(%)</Label>
        <Input
          id={`${connection.id}-fee`}
          name="sales_fee_percent"
          type="number"
          defaultValue={connection.salesFeePercent}
          min="0"
          max="100"
          step="0.01"
          inputMode="decimal"
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={isPending} className="xl:mb-0">
        {isPending ? '저장 중...' : '저장'}
      </Button>
    </form>
  )
}

'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  registerExcelMarketplaceConnection,
  registerRpaMarketplaceConnection,
} from '@/app/(auth)/settings/marketplaces/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface IntegrationOption {
  id: string
  name: string
  isConnected: boolean
}

interface IntegrationFormsProps {
  rpaMarketplaces: IntegrationOption[]
  excelMarketplaces: IntegrationOption[]
}

export function IntegrationForms({
  rpaMarketplaces,
  excelMarketplaces,
}: IntegrationFormsProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RpaConnectionForm marketplaces={rpaMarketplaces} />
      <ExcelConnectionForm marketplaces={excelMarketplaces} />
    </div>
  )
}

function RpaConnectionForm({ marketplaces }: { marketplaces: IntegrationOption[] }) {
  const [selectedId, setSelectedId] = useState('')
  const [state, formAction, isPending] = useActionState(registerRpaMarketplaceConnection, null)
  const selectedMarketplace = marketplaces.find((marketplace) => marketplace.id === selectedId)

  useEffect(() => {
    if (state?.success && state.message) {
      toast.success(state.message)
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>RPA 로그인 등록</CardTitle>
        <CardDescription>
          API가 막힌 채널은 판매자센터 로그인 기반 자동 다운로드로 관리합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="marketplace_id" value={selectedId} />

          <div className="space-y-2">
            <Label htmlFor="rpa-marketplace-select">RPA 대상</Label>
            <select
              id="rpa-marketplace-select"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">선택하세요</option>
              {marketplaces.map((marketplace) => (
                <option key={marketplace.id} value={marketplace.id}>
                  {marketplace.name}
                  {marketplace.isConnected ? ' (연결됨)' : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedMarketplace && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="rpa-store-alias">스토어 별칭</Label>
                <Input
                  id="rpa-store-alias"
                  name="store_alias"
                  placeholder="예: 본계정, 서브계정"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rpa-email">로그인 ID</Label>
                <Input id="rpa-email" name="email" required autoComplete="username" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rpa-password">비밀번호</Label>
                <Input
                  id="rpa-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? '저장 중...' : 'RPA 연결 저장'}
              </Button>
            </div>
          )}

          {state?.error && !isPending && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function ExcelConnectionForm({ marketplaces }: { marketplaces: IntegrationOption[] }) {
  const [selectedId, setSelectedId] = useState('')
  const [state, formAction, isPending] = useActionState(registerExcelMarketplaceConnection, null)

  useEffect(() => {
    if (state?.success && state.message) {
      toast.success(state.message)
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>엑셀 업로드몰 등록</CardTitle>
        <CardDescription>
          자동 연동 전이라도 몰을 등록해두면 주문수집 화면에서 업로드 상태를 함께 볼 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="marketplace_id" value={selectedId} />

          <div className="space-y-2">
            <Label htmlFor="excel-marketplace-select">기본 몰</Label>
            <select
              id="excel-marketplace-select"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">직접 입력</option>
              {marketplaces.map((marketplace) => (
                <option key={marketplace.id} value={marketplace.id}>
                  {marketplace.name}
                  {marketplace.isConnected ? ' (등록됨)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="excel-display-name">표시 이름</Label>
            <Input
              id="excel-display-name"
              name="display_name"
              placeholder={selectedId ? '비워두면 기본 몰 이름 사용' : '예: 온채널, 올웨이즈'}
              required={!selectedId}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="excel-store-alias">스토어 별칭</Label>
            <Input
              id="excel-store-alias"
              name="store_alias"
              placeholder="기본값: excel"
            />
          </div>

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? '등록 중...' : '엑셀 업로드몰 등록'}
          </Button>

          {state?.error && !isPending && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

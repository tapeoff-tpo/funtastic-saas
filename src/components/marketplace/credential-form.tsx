'use client'

import { useActionState, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { registerMarketplaceCredentials } from '@/app/(auth)/settings/marketplaces/actions'
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

interface MarketplaceOption {
  id: string
  name: string
  requiredCredentials: string[]
  isConnected: boolean
}

interface CredentialFormProps {
  marketplaces: MarketplaceOption[]
}

const credentialLabels: Record<string, string> = {
  access_key: '액세스 키',
  secret_key: '시크릿 키',
  vendor_id: '벤더 ID',
  client_id: '클라이언트 ID',
  client_secret: '클라이언트 시크릿',
  api_key: 'API 키',
}

export function CredentialForm({ marketplaces }: CredentialFormProps) {
  const [selectedId, setSelectedId] = useState('')
  const [state, formAction, isPending] = useActionState(
    registerMarketplaceCredentials,
    null
  )

  const selectedMarketplace = marketplaces.find((m) => m.id === selectedId)

  useEffect(() => {
    if (state?.success && state.message) {
      toast.success(state.message)
      setSelectedId('')
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>인증정보 등록</CardTitle>
        <CardDescription>
          마켓플레이스를 선택하고 API 인증정보를 입력하세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="marketplace_id" value={selectedId} />

          <div className="space-y-2">
            <Label htmlFor="marketplace-select">마켓플레이스</Label>
            <select
              id="marketplace-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">선택하세요</option>
              {marketplaces.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.isConnected ? ' (연결됨)' : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedMarketplace && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="store_alias">스토어 별칭</Label>
                <Input
                  id="store_alias"
                  name="store_alias"
                  placeholder="예: 일오삼공 1of30 (같은 몰에 여러 스토어 등록 시 구분용)"
                />
                <p className="text-xs text-muted-foreground">
                  같은 마켓플레이스에 여러 스토어를 등록할 때 구분용으로 입력하세요. 비워두면 기본값으로 등록됩니다.
                </p>
              </div>

              {selectedMarketplace.requiredCredentials.map((credKey) => (
                <div key={credKey} className="space-y-1">
                  <Label htmlFor={credKey}>
                    {credentialLabels[credKey] ?? credKey}
                  </Label>
                  <Input
                    id={credKey}
                    name={credKey}
                    type="password"
                    required
                    placeholder={`${credentialLabels[credKey] ?? credKey}을(를) 입력하세요`}
                  />
                </div>
              ))}

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? '저장 중...' : '인증정보 저장'}
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

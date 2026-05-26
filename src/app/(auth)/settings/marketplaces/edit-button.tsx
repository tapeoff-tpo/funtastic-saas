'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  getMarketplaceCredentials,
  registerMarketplaceCredentials,
  testMarketplaceCredentials,
} from './actions'
import { DeleteConnectionButton } from './delete-button'
import { StatusBadge } from '@/components/marketplace/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import type { IntegrationMethod } from '@/lib/marketplace/integration-methods'

const credentialLabels: Record<string, string> = {
  access_key: '액세스 키',
  secret_key: '시크릿 키',
  vendor_id: '업체/판매자 ID',
  client_id: '클라이언트 ID',
  client_secret: '클라이언트 시크릿',
  master_id: 'ESM+ 마스터 ID',
  api_key: 'API 키',
  shop_id: '브랜드 ID (brandId)',
  mall_id: '몰 ID',
  access_token: '액세스 토큰',
  store_id: '스토어 ID',
  seller_id: '셀러 ID',
  username: '오너클랜 판매회원 ID',
  password: '오너클랜 판매회원 PW',
  admin_app_key: '연동대행사 Admin 키',
  seller_app_key: '판매자 API 인증키',
  vendor_password: '오너클랜 공급사 PW',
  base_url: 'API Base URL',
  oauser_id: 'oauserId',
  oause_key: 'oauseKey',
  ven_cd: '협력사코드',
  ven2_cd: '2차협력사코드',
  mda_gb: '매체구분',
  dlv_form_gbcd: '배송형태구분코드',
  rgst_ip: '등록 IP',
}

interface ConnectionRowProps {
  connectionId: string
  marketplaceName: string
  storeAlias: string
  displayName: string
  status: ConnectionStatus
  integrationMethod: IntegrationMethod
  linkedMarketplaces?: string[]
}

interface LoadedData {
  marketplaceId: string
  storeAlias: string
  requiredCredentials: string[]
  optionalCredentials?: string[]
  values: Record<string, string>
}

export function ConnectionRow({
  connectionId,
  marketplaceName,
  storeAlias,
  displayName,
  status,
  integrationMethod,
  linkedMarketplaces = [],
}: ConnectionRowProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<LoadedData | null>(null)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const [state, formAction, isPending] = useActionState(
    registerMarketplaceCredentials,
    null,
  )

  async function handleToggle() {
    if (open) {
      setOpen(false)
      return
    }
    setLoading(true)
    const res = await getMarketplaceCredentials(connectionId)
    setLoading(false)
    if (res.error || !res.data) {
      toast.error(res.error ?? '불러오기 실패')
      return
    }
    setData(res.data)
    setOpen(true)
  }

  useEffect(() => {
    if (state?.success && state.message) {
      toast.success(state.message)
      router.refresh()
      setTimeout(() => {
        setOpen(false)
        setReveal({})
      }, 0)
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [router, state])

  async function handleTest(form: HTMLFormElement) {
    if (!data) return
    setTesting(true)
    const fd = new FormData(form)
    const credentials: Record<string, string> = {}
    for (const credKey of [...data.requiredCredentials, ...(data.optionalCredentials ?? [])]) {
      credentials[credKey] = (fd.get(credKey) as string) ?? ''
    }
    const result = await testMarketplaceCredentials(data.marketplaceId, credentials)
    setTesting(false)
    if (result.success) {
      toast.success('연결 성공')
    } else {
      toast.error(result.error ?? '연결 실패')
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{marketplaceName}</span>
            <StatusBadge status={status} />
            {integrationMethod === 'hub' && (
              <span
                className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700"
                title={linkedMarketplaces.length > 0 ? linkedMarketplaces.join(', ') : 'EMP 설정 전체'}
              >
                {linkedMarketplaces.length > 0
                  ? `연동몰 ${linkedMarketplaces.length}개`
                  : 'EMP 전체'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            연결 계정명: <span className="font-medium text-foreground">{storeAlias}</span>
            {displayName !== marketplaceName ? ` · 표시 이름: ${displayName}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {(integrationMethod === 'api' || integrationMethod === 'hub') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleToggle}
              disabled={loading}
            >
              {loading ? '불러오는 중...' : open ? '닫기' : '수정'}
            </Button>
          )}
          <DeleteConnectionButton connectionId={connectionId} />
        </div>
      </div>
      {integrationMethod === 'hub' && (
        <p className="mt-2 text-xs text-muted-foreground">
          연동몰: {linkedMarketplaces.length > 0 ? linkedMarketplaces.join(', ') : 'EMP 설정 전체'}
        </p>
      )}

      {open && data && (integrationMethod === 'api' || integrationMethod === 'hub') && (
        <form
          action={formAction}
          className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3"
        >
          <input type="hidden" name="marketplace_id" value={data.marketplaceId} />
          <input type="hidden" name="store_alias_required" value="true" />
          <input type="hidden" name="connection_id" value={connectionId} />

          <div className="space-y-1">
            <Label htmlFor={`edit-${connectionId}-store-alias`}>연결 계정명</Label>
            <Input
              id={`edit-${connectionId}-store-alias`}
              name="store_alias"
              type="text"
              defaultValue={data.storeAlias}
              maxLength={100}
              required
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              계정명을 변경하면 저장된 인증정보도 새 이름으로 함께 이전됩니다.
            </p>
          </div>

          {data.requiredCredentials.map((credKey) => {
            const isRevealed = reveal[credKey] ?? false
            return (
              <div key={credKey} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`edit-${connectionId}-${credKey}`}>
                    {credentialLabels[credKey] ?? credKey}
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setReveal((r) => ({ ...r, [credKey]: !r[credKey] }))
                    }
                  >
                    {isRevealed ? '숨기기' : '보기'}
                  </button>
                </div>
                <Input
                  id={`edit-${connectionId}-${credKey}`}
                  name={credKey}
                  type={isRevealed ? 'text' : 'password'}
                  defaultValue={data.values[credKey] ?? ''}
                  required
                  autoComplete="off"
                />
              </div>
            )
          })}

          {(data.optionalCredentials ?? []).map((credKey) => (
            <div key={credKey} className="space-y-1">
              <Label htmlFor={`edit-${connectionId}-${credKey}`}>
                {credentialLabels[credKey] ?? credKey}
              </Label>
              <Input
                id={`edit-${connectionId}-${credKey}`}
                name={credKey}
                type="text"
                defaultValue={data.values[credKey] ?? ''}
                placeholder={
                  data.marketplaceId === 'hyundai-hmall' && credKey === 'ven2_cd'
                      ? '예: 000000'
                    : data.marketplaceId === 'hyundai-hmall' && credKey === 'mda_gb'
                      ? '예: 20'
                    : data.marketplaceId === 'hyundai-hmall' && credKey === 'dlv_form_gbcd'
                      ? '예: 40'
                      : `${credentialLabels[credKey] ?? credKey} 입력`
                }
                autoComplete="off"
              />
            </div>
          ))}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending || testing}>
              {isPending ? '저장 중...' : '저장'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={testing || isPending}
              onClick={(e) => {
                const form = e.currentTarget.closest('form') as HTMLFormElement | null
                if (form) handleTest(form)
              }}
            >
              {testing ? '테스트 중...' : '테스트 연결'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setReveal({})
              }}
            >
              취소
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  registerExcelMarketplaceConnection,
  registerMarketplaceCredentials,
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
import { getIntegrationInfo, type IntegrationMethod } from '@/lib/marketplace/integration-methods'

interface MarketplaceOption {
  id: string
  name: string
  requiredCredentials: string[]
  supportedMethods: IntegrationMethod[]
  connectedMethodCounts: Partial<Record<IntegrationMethod, number>>
}

interface IntegrationFormsProps {
  marketplaces: MarketplaceOption[]
}

const credentialLabels: Record<string, string> = {
  access_key: '액세스 키',
  secret_key: '시크릿 키',
  vendor_id: '오너클랜 공급사 ID',
  client_id: '클라이언트 ID',
  client_secret: '클라이언트 시크릿',
  master_id: 'ESM+ 마스터 ID',
  api_key: 'API 키',
  secure_key: 'SECURE 키',
  client_server_ip: 'API 서버 IP',
  shop_id: '브랜드 ID (brandId)',
  mall_id: '몰 ID (예: mymall)',
  access_token: '액세스 토큰',
  seller_id: '판매자 ID',
  admin_app_key: '연동대행사 Admin 키',
  seller_app_key: '판매자 API 인증키',
  username: '오너클랜 판매회원 ID',
  password: '비밀번호',
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

const optionalCredentialFields: Record<string, string[]> = {
  'hyundai-hmall': ['ven2_cd', 'dlv_form_gbcd', 'base_url', 'rgst_ip'],
}

const METHOD_HELP: Record<IntegrationMethod, string> = {
  api: '공식 API 키를 저장해 주문수집, 주문확인, 송장전송을 처리합니다.',
  hub: '플레이오토 EMP처럼 여러 쇼핑몰을 한 번에 모아주는 연동몰을 연결합니다.',
  rpa: '판매자센터 로그인 정보를 저장하고 화면 자동화로 주문 엑셀을 수집합니다.',
  excel: 'API 없이 주문 엑셀을 업로드할 수 있는 몰로 등록합니다.',
}

const ALL_METHODS: IntegrationMethod[] = ['api', 'hub', 'rpa', 'excel']

function methodLabel(method: IntegrationMethod): string {
  return getIntegrationInfo(method).label
}

function optionalPlaceholder(marketplaceId: string, credKey: string): string {
  if (marketplaceId === 'hyundai-hmall' && credKey === 'ven2_cd') return '예: 000000'
  if (marketplaceId === 'hyundai-hmall' && credKey === 'dlv_form_gbcd') return '예: 40'
  if (marketplaceId === 'hyundai-hmall' && credKey === 'base_url') return '기본: https://openapi.hmall.com/front'
  return `${credentialLabels[credKey] ?? credKey} 입력`
}

function connectionCountLabel(count: number | undefined): string {
  if (!count) return '계정 추가'
  return `연결 ${count}개`
}

export function IntegrationForms({ marketplaces }: IntegrationFormsProps) {
  const sortedMarketplaces = useMemo(
    () => [...marketplaces].sort((a, b) => a.name.localeCompare(b.name, 'ko-KR')),
    [marketplaces],
  )
  const [selectedId, setSelectedId] = useState('')
  const selectedMarketplace = sortedMarketplaces.find((marketplace) => marketplace.id === selectedId)
  const [selectedMethod, setSelectedMethod] = useState<IntegrationMethod>('api')
  const selectedMethodSupported = selectedMarketplace?.supportedMethods.includes(selectedMethod) ?? true

  return (
    <Card>
      <CardHeader>
        <CardTitle>마켓 연동 등록</CardTitle>
        <CardDescription>
          몰을 먼저 선택한 뒤 API, 연동몰, RPA, 엑셀 중 사용할 연동방식을 고르세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-2">
            <Label htmlFor="unified-marketplace-select">마켓</Label>
            <select
              id="unified-marketplace-select"
              value={selectedId}
              onChange={(event) => {
                const nextId = event.target.value
                const nextMarketplace = sortedMarketplaces.find((marketplace) => marketplace.id === nextId)
                setSelectedId(nextId)
                setSelectedMethod(nextMarketplace?.supportedMethods[0] ?? 'api')
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">선택하세요</option>
              {sortedMarketplaces.map((marketplace) => (
                <option key={marketplace.id} value={marketplace.id}>
                  {marketplace.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>연동방식</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_METHODS.map((method) => {
                const supported = selectedMarketplace?.supportedMethods.includes(method) ?? (method === 'api' || method === 'excel')
                const count = selectedMarketplace?.connectedMethodCounts[method]

                return (
                  <button
                    key={method}
                    type="button"
                    disabled={!supported}
                    onClick={() => setSelectedMethod(method)}
                    className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      selectedMethod === method
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span className="block">{methodLabel(method)}</span>
                    <span className="block text-[11px] font-normal">
                      {supported ? connectionCountLabel(count) : '지원 안함'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {selectedMarketplace && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {selectedMethodSupported
              ? METHOD_HELP[selectedMethod]
              : `${selectedMarketplace.name}은(는) 현재 ${methodLabel(selectedMethod)} 연동을 지원하지 않습니다.`}
          </p>
        )}

        {!selectedMarketplace ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            등록할 마켓을 선택하면 가능한 연동방식과 입력 항목이 표시됩니다.
          </div>
        ) : !selectedMethodSupported ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            다른 연동방식을 선택하거나, 이 마켓의 지원 방식 설정을 먼저 추가해야 합니다.
          </div>
        ) : selectedMethod === 'excel' ? (
          <ExcelConnectionForm marketplace={selectedMarketplace} />
        ) : selectedMethod === 'rpa' ? (
          <RpaConnectionForm marketplace={selectedMarketplace} />
        ) : (
          <ApiConnectionForm marketplace={selectedMarketplace} method={selectedMethod} />
        )}
      </CardContent>
    </Card>
  )
}

function StoreAliasInput({ id, placeholder = '기본값: default' }: { id: string; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>연결 계정명</Label>
      <Input
        id={id}
        name="store_alias"
        placeholder={placeholder}
      />
      <p className="text-xs text-muted-foreground">
        같은 마켓에 판매자 계정이 여러 개면 서로 다른 이름으로 추가하세요.
      </p>
    </div>
  )
}

function ApiConnectionForm({
  marketplace,
  method,
}: {
  marketplace: MarketplaceOption
  method: IntegrationMethod
}) {
  const [state, formAction, isPending] = useActionState(registerMarketplaceCredentials, null)
  const optionalFields = optionalCredentialFields[marketplace.id] ?? []

  useEffect(() => {
    if (state?.success && state.message) toast.success(state.message)
    if (state?.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="marketplace_id" value={marketplace.id} />

      <StoreAliasInput
        id={`${marketplace.id}-${method}-store-alias`}
        placeholder={method === 'hub' ? '예: tapeoff EMP' : '예: 일오삼공'}
      />

      {marketplace.requiredCredentials.map((credKey) => (
        <div key={credKey} className="space-y-1">
          <Label htmlFor={`${marketplace.id}-${method}-${credKey}`}>
            {credentialLabels[credKey] ?? credKey}
          </Label>
          <Input
            id={`${marketplace.id}-${method}-${credKey}`}
            name={credKey}
            type="password"
            required
            placeholder={`${credentialLabels[credKey] ?? credKey}을(를) 입력하세요`}
            autoComplete="off"
          />
        </div>
      ))}

      {optionalFields.map((credKey) => (
        <div key={credKey} className="space-y-1">
          <Label htmlFor={`${marketplace.id}-${method}-${credKey}`}>
            {credentialLabels[credKey] ?? credKey}
          </Label>
          <Input
            id={`${marketplace.id}-${method}-${credKey}`}
            name={credKey}
            type="text"
            placeholder={optionalPlaceholder(marketplace.id, credKey)}
            autoComplete="off"
          />
        </div>
      ))}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? '저장 중...' : `${methodLabel(method)} 연동 저장`}
      </Button>

      {state?.error && !isPending && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  )
}

function RpaConnectionForm({ marketplace }: { marketplace: MarketplaceOption }) {
  const [state, formAction, isPending] = useActionState(registerRpaMarketplaceConnection, null)

  useEffect(() => {
    if (state?.success && state.message) toast.success(state.message)
    if (state?.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="marketplace_id" value={marketplace.id} />

      <StoreAliasInput id={`${marketplace.id}-rpa-store-alias`} placeholder="예: 기본계정" />

      <div className="space-y-1">
        <Label htmlFor={`${marketplace.id}-rpa-email`}>로그인 ID</Label>
        <Input
          id={`${marketplace.id}-rpa-email`}
          name="email"
          required
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${marketplace.id}-rpa-password`}>비밀번호</Label>
        <Input
          id={`${marketplace.id}-rpa-password`}
          name="password"
          type="password"
          required
          autoComplete="off"
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? '등록 중...' : 'RPA 연동 저장'}
      </Button>

      {state?.error && !isPending && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  )
}

function ExcelConnectionForm({ marketplace }: { marketplace: MarketplaceOption }) {
  const [state, formAction, isPending] = useActionState(registerExcelMarketplaceConnection, null)

  useEffect(() => {
    if (state?.success && state.message) toast.success(state.message)
    if (state?.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="marketplace_id" value={marketplace.id} />

      <div className="space-y-1">
        <Label htmlFor={`${marketplace.id}-excel-display-name`}>표시 이름</Label>
        <Input
          id={`${marketplace.id}-excel-display-name`}
          name="display_name"
          placeholder={`비워두면 ${marketplace.name} 사용`}
        />
      </div>

      <StoreAliasInput id={`${marketplace.id}-excel-store-alias`} placeholder="기본값: excel" />

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? '등록 중...' : '엑셀 업로드몰 등록'}
      </Button>

      {state?.error && !isPending && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  )
}

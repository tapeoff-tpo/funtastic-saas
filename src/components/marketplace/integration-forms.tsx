'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  registerExcelMarketplaceConnection,
  registerMarketplaceCredentials,
  registerRpaMarketplaceConnection,
  saveCommonAuthProfile,
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
  connectedAliases: string[]
}

interface IntegrationFormsProps {
  marketplaces: MarketplaceOption[]
  authProfiles: CommonAuthProfileOption[]
}

interface CommonAuthProfileOption {
  id: string
  name: string
  provider: string
  accountEmail: string
  isDefault: boolean
}

const credentialLabels: Record<string, string> = {
  access_key: '액세스 키',
  secret_key: '시크릿 키',
  vendor_id: '업체/판매자 ID',
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

export function IntegrationForms({ marketplaces, authProfiles }: IntegrationFormsProps) {
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

        <SecondFactorProfilesPanel authProfiles={authProfiles} />

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
          <RpaConnectionForm marketplace={selectedMarketplace} authProfiles={authProfiles} />
        ) : (
          <ApiConnectionForm marketplace={selectedMarketplace} method={selectedMethod} />
        )}
      </CardContent>
    </Card>
  )
}

function SecondFactorProfilesPanel({ authProfiles }: { authProfiles: CommonAuthProfileOption[] }) {
  const [state, formAction, isPending] = useActionState(saveCommonAuthProfile, null)

  useEffect(() => {
    if (state?.success && state.message) toast.success(state.message)
    if (state?.error) toast.error(state.error)
  }, [state])

  const naverProfiles = authProfiles.filter((profile) => profile.provider === 'naver_email')

  return (
    <section className="rounded-lg border bg-muted/20 p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">2차 인증수단</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            네이버 메일 인증번호를 읽어야 하는 RPA 몰에서 함께 사용합니다.
          </p>
          <div className="mt-3 space-y-2">
            {naverProfiles.length === 0 ? (
              <p className="rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
                저장된 네이버 메일 인증수단이 없습니다.
              </p>
            ) : naverProfiles.map((profile) => (
              <div key={profile.id} className="rounded-md border bg-background px-3 py-2 text-sm">
                <div className="font-medium">{profile.name}</div>
                <div className="text-xs text-muted-foreground">{profile.accountEmail}</div>
              </div>
            ))}
          </div>
        </div>

        <form action={formAction} className="space-y-2 rounded-md border bg-background p-3">
          <input type="hidden" name="provider" value="naver_email" />
          <div className="space-y-1">
            <Label htmlFor="common-auth-name">인증수단 이름</Label>
            <Input
              id="common-auth-name"
              name="name"
              defaultValue="기본 네이버 메일"
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="common-auth-email">네이버 메일 주소</Label>
            <Input
              id="common-auth-email"
              name="account_email"
              type="email"
              placeholder="tapeoff@naver.com"
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="common-auth-password">네이버 앱 비밀번호</Label>
            <Input
              id="common-auth-password"
              name="app_password"
              type="password"
              required
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? '저장 중...' : '2차 인증수단 저장'}
          </Button>
          {state?.error && !isPending && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}
        </form>
      </div>
    </section>
  )
}

function StoreAliasInput({
  id,
  placeholder = '예: 쿠팡-본계정',
}: {
  id: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>연결 계정명</Label>
      <Input
        id={id}
        name="store_alias"
        placeholder={placeholder}
        required
      />
      <p className="text-xs text-muted-foreground">
        같은 마켓에 판매자 계정이 여러 개면 서로 다른 이름으로 추가하세요. 이미 있는 이름은 수정 화면에서만 변경됩니다.
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
      <input type="hidden" name="store_alias_required" value="true" />

      <StoreAliasInput
        id={`${marketplace.id}-${method}-store-alias`}
        placeholder={method === 'hub' ? '예: tapeoff EMP' : `예: ${marketplace.name}-본계정`}
      />

      {marketplace.connectedAliases.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          이미 등록된 계정명: {marketplace.connectedAliases.join(', ')}. 새 계정을 추가하려면 다른 계정명을 입력하세요.
        </p>
      )}

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

function RpaConnectionForm({
  marketplace,
  authProfiles,
}: {
  marketplace: MarketplaceOption
  authProfiles: CommonAuthProfileOption[]
}) {
  const [state, formAction, isPending] = useActionState(registerRpaMarketplaceConnection, null)

  useEffect(() => {
    if (state?.success && state.message) toast.success(state.message)
    if (state?.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="marketplace_id" value={marketplace.id} />
      <input type="hidden" name="store_alias_required" value="true" />

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

      {marketplace.id === 'ohouse' && (
        <OhouseSecondFactorFields marketplaceId={marketplace.id} authProfiles={authProfiles} />
      )}
      {marketplace.id === 'gs-shop' && <GsShopSecondFactorFields marketplaceId={marketplace.id} />}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? '등록 중...' : 'RPA 연동 저장'}
      </Button>

      {state?.error && !isPending && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  )
}

function OhouseSecondFactorFields({
  marketplaceId,
  authProfiles,
}: {
  marketplaceId: string
  authProfiles: CommonAuthProfileOption[]
}) {
  const naverProfiles = authProfiles.filter((profile) => profile.provider === 'naver_email')
  const defaultProfileId = naverProfiles.find((profile) => profile.isDefault)?.id ?? naverProfiles[0]?.id ?? ''

  return (
    <div className="space-y-4 border-t pt-4">
      <input type="hidden" name="two_factor_method" value="naver_email" />

      <div className="space-y-1">
        <Label htmlFor={`${marketplaceId}-rpa-two-factor-profile`}>2차 인증 네이버 메일</Label>
        <select
          id={`${marketplaceId}-rpa-two-factor-profile`}
          name="two_factor_profile_id"
          defaultValue={defaultProfileId}
          required
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">2차 인증수단을 선택하세요</option>
          {naverProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.accountEmail})
            </option>
          ))}
        </select>
        {naverProfiles.length === 0 && (
          <p className="text-xs text-red-600">
            먼저 위의 2차 인증수단에 네이버 메일 앱 비밀번호를 저장해주세요.
          </p>
        )}
      </div>
    </div>
  )
}

function GsShopSecondFactorFields({ marketplaceId }: { marketplaceId: string }) {
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="space-y-1">
        <Label htmlFor={`${marketplaceId}-rpa-gs-second-factor-method`}>GS샵 2차 인증수단</Label>
        <select
          id={`${marketplaceId}-rpa-gs-second-factor-method`}
          name="gs_second_factor_method"
          defaultValue="manual"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="manual">수동 확인</option>
          <option value="sms">문자/SMS</option>
          <option value="email">이메일</option>
          <option value="app">인증 앱</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${marketplaceId}-rpa-gs-second-factor-target`}>인증 수신 정보</Label>
        <Input
          id={`${marketplaceId}-rpa-gs-second-factor-target`}
          name="gs_second_factor_target"
          placeholder="예: 010-0000-0000 또는 account@example.com"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          실제 인증번호는 저장하지 않습니다. RPA가 어떤 수단으로 인증을 기다릴지 판단하는 용도입니다.
        </p>
      </div>
    </div>
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
      <input type="hidden" name="store_alias_required" value="true" />

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

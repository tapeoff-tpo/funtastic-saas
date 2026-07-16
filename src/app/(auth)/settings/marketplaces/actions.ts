'use server'

import { createClient } from '@/lib/supabase/server'
import { storeCredential, deleteCredential, deleteCredentialByName, readCredential } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { commonAuthProfiles, marketplaceConnections } from '@/lib/db/schema'
import { ensureCommonAuthProfilesTable, storeCommonAuthProfileCredentials } from '@/lib/common-auth-profiles'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import '@/lib/marketplace/adapters/configs'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'
import { TossShoppingAdapter } from '@/lib/marketplace/adapters/toss-shopping/adapter'
import { OwnerclanAdapter } from '@/lib/marketplace/adapters/ownerclan/adapter'
import { KakaoGiftAdapter } from '@/lib/marketplace/adapters/kakao-gift/adapter'
import { KakaoStoreAdapter } from '@/lib/marketplace/adapters/kakao-store/adapter'
import { DomeggookAdapter } from '@/lib/marketplace/adapters/domeggook/adapter'
import { DomesinAdapter } from '@/lib/marketplace/adapters/domesin/adapter'
import { SpecialofferAdapter } from '@/lib/marketplace/adapters/specialoffer/adapter'
import { DomechangoAdapter } from '@/lib/marketplace/adapters/domechango/adapter'
import { TobizonAdapter } from '@/lib/marketplace/adapters/tobizon/adapter'
import { SsgmallAdapter } from '@/lib/marketplace/adapters/ssgmall/adapter'
import { PlayautoEmpAdapter } from '@/lib/marketplace/adapters/playauto-emp/adapter'
import { HyundaiHmallAdapter } from '@/lib/marketplace/adapters/hyundai-hmall/adapter'
import { eq, and } from 'drizzle-orm'
import { revalidatePath, updateTag } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getIntegrationMethod, getSupportedIntegrationMethods } from '@/lib/marketplace/integration-methods'
import { saveMarketplaceBusinessSetting } from '@/lib/marketplace/business-settings'
import { nanoid } from 'nanoid'
import { readScrapeCredentials, storeScrapeCredentials } from '@/scrapers/credentials'

interface ActionResult {
  success?: boolean
  error?: string
  message?: string
}

const OPTIONAL_CREDENTIALS: Record<string, string[]> = {
  'hyundai-hmall': ['ven2_cd', 'dlv_form_gbcd', 'base_url', 'rgst_ip'],
}

export async function saveCommonAuthProfile(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const provider = String(formData.get('provider') ?? 'naver_email').trim()
  const name = String(formData.get('name') ?? '').trim() || '기본 네이버 메일'
  const accountEmail = String(formData.get('account_email') ?? '').trim()
  const appPassword = String(formData.get('app_password') ?? '').replace(/\s+/g, '')

  if (provider !== 'naver_email') {
    return { error: '현재는 네이버 메일 인증수단만 지원합니다.' }
  }
  if (!accountEmail || !appPassword) {
    return { error: '네이버 메일 주소와 애플리케이션 비밀번호를 입력해주세요.' }
  }

  try {
    await ensureCommonAuthProfilesTable()
    const existing = await db
      .select({ id: commonAuthProfiles.id })
      .from(commonAuthProfiles)
      .where(
        and(
          eq(commonAuthProfiles.userId, workspaceUserId),
          eq(commonAuthProfiles.provider, provider),
          eq(commonAuthProfiles.name, name),
        ),
      )
      .limit(1)

    let profileId = existing[0]?.id
    if (profileId) {
      await db
        .update(commonAuthProfiles)
        .set({
          accountEmail,
          updatedAt: new Date(),
        })
        .where(eq(commonAuthProfiles.id, profileId))
    } else {
      const [created] = await db
        .insert(commonAuthProfiles)
        .values({
          userId: workspaceUserId,
          provider,
          name,
          accountEmail,
          isDefault: true,
          vaultSecretNames: [],
        })
        .returning({ id: commonAuthProfiles.id })
      profileId = created.id
    }
    if (!profileId) {
      return { error: '공통 인증수단 ID를 생성하지 못했습니다.' }
    }

    const vaultSecretNames = await storeCommonAuthProfileCredentials({
      userId: workspaceUserId,
      profileId,
      email: accountEmail,
      password: appPassword,
    })

    await db
      .update(commonAuthProfiles)
      .set({
        vaultSecretNames,
        updatedAt: new Date(),
      })
      .where(eq(commonAuthProfiles.id, profileId))
  } catch (err) {
    return {
      error: `공통 인증수단 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${name} 인증수단이 저장되었습니다.` }
}

/**
 * 저장된 마켓플레이스 인증정보를 Vault에서 읽어 복호화된 값으로 반환.
 * 수정 화면 pre-fill 용도. 브라우저에 평문으로 노출되므로,
 * 반드시 인증된 소유자 요청만 통과시킨다.
 */
export async function getMarketplaceCredentials(
  connectionId: string,
): Promise<{
  success?: boolean
  error?: string
  data?: {
    marketplaceId: string
    storeAlias: string
    requiredCredentials: string[]
    optionalCredentials?: string[]
    values: Record<string, string>
  }
}> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { error: '인증이 필요합니다.' }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  if (!connectionId) return { error: '연결 ID가 필요합니다.' }

  const rows = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, workspaceUserId),
        eq(marketplaceConnections.id, connectionId),
      ),
    )
    .limit(1)

  if (rows.length === 0) return { error: '연결 정보를 찾을 수 없습니다.' }

  const connection = rows[0]
  if (!marketplaceRegistry.has(connection.marketplaceId)) {
    return { error: '유효하지 않은 마켓플레이스입니다.' }
  }

  const config = marketplaceRegistry.get(connection.marketplaceId).config
  const aliasTag = connection.storeAlias === 'default' ? '' : `_${connection.storeAlias}`
  const optionalCredentials = OPTIONAL_CREDENTIALS[connection.marketplaceId] ?? []

  const values: Record<string, string> = {}
  try {
    for (const credKey of [...config.requiredCredentials, ...optionalCredentials]) {
      const vaultKey = `${credKey}${aliasTag}`
      const secret = await readCredential(connection.marketplaceId, workspaceUserId, vaultKey)
      values[credKey] = secret ?? ''
    }
  } catch (err) {
    return {
      error: `인증정보 조회 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  return {
    success: true,
    data: {
      marketplaceId: connection.marketplaceId,
      storeAlias: connection.storeAlias,
      requiredCredentials: [...config.requiredCredentials],
      optionalCredentials,
      values,
    },
  }
}

/**
 * 폼에 입력된 자격증명으로 실제 마켓플레이스 API 호출 시도.
 * 저장 전에 값이 유효한지 검증할 때 사용. Vault에 저장하지 않고 메모리에서만 사용.
 */
export async function testMarketplaceCredentials(
  marketplaceId: string,
  credentials: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { success: false, error: '인증이 필요합니다.' }

  try {
    let result: { success: boolean; error?: string }
    switch (marketplaceId) {
      case 'naver':
        result = await new NaverAdapter({
          client_id: credentials.client_id?.trim() ?? '',
          client_secret: credentials.client_secret?.trim() ?? '',
        }).testConnection()
        break
      case 'coupang':
        result = await new CoupangAdapter({
          access_key: credentials.access_key?.trim() ?? '',
          secret_key: credentials.secret_key?.trim() ?? '',
          vendor_id: credentials.vendor_id?.trim() ?? '',
        }).testConnection()
        break
      case 'toss-shopping':
        result = await new TossShoppingAdapter({
          access_key: credentials.access_key?.trim() ?? '',
          secret_key: credentials.secret_key?.trim() ?? '',
        }).testConnection()
        break
      case 'ownerclan':
        result = await new OwnerclanAdapter({
          username: credentials.username?.trim() ?? credentials.vendor_id?.trim() ?? credentials.seller_id?.trim() ?? '',
          password: credentials.password?.trim() ?? credentials.vendor_password?.trim() ?? credentials.api_key?.trim() ?? '',
          vendor_id: credentials.vendor_id?.trim() ?? '',
          vendor_password: credentials.vendor_password?.trim() ?? '',
        }).testConnection()
        break
      case 'kakao-gift':
        result = await new KakaoGiftAdapter({
          api_key: credentials.api_key?.trim() ?? '',
          store_id: credentials.store_id?.trim() ?? '',
        }).testConnection()
        break
      case 'kakao-store':
        result = await new KakaoStoreAdapter({
          admin_app_key: credentials.admin_app_key?.trim() ?? '',
          seller_app_key: credentials.seller_app_key?.trim() ?? '',
          channel_ids: credentials.channel_ids?.trim() || '101',
        }).testConnection()
        break
      case 'funtastic-b2b':
        result = {
          success: Boolean(credentials.api_key?.trim() && credentials.base_url?.trim()),
          error: credentials.api_key?.trim() && credentials.base_url?.trim()
            ? undefined
            : 'api_key와 base_url을 입력해주세요.',
        }
        break
      case 'domeggook':
        result = await new DomeggookAdapter({
          api_key: credentials.api_key?.trim() ?? '',
          seller_id: credentials.seller_id?.trim() ?? '',
          session_id: credentials.session_id?.trim() ?? '',
        }).testConnection()
        break
      case 'domesin':
        result = await new DomesinAdapter({
          api_key: credentials.api_key?.trim() ?? '',
          seller_id: credentials.seller_id?.trim() ?? credentials.m_id?.trim() ?? '',
        }).testConnection()
        break
      case 'specialoffer':
        result = await new SpecialofferAdapter({
          api_key: credentials.api_key?.trim() ?? '',
        }).testConnection()
        break
      case 'domechango':
        result = await new DomechangoAdapter({
          api_key: credentials.api_key?.trim() ?? '',
          secure_key: credentials.secure_key?.trim() ?? '',
        }).testConnection()
        break
      case 'tobizon':
        result = await new TobizonAdapter({
          api_key: credentials.api_key?.trim() ?? '',
          secure_key: credentials.secure_key?.trim() ?? '',
          client_server_ip: credentials.client_server_ip?.trim() ?? '',
        }).testConnection()
        break
      case 'ssgmall':
        result = await new SsgmallAdapter({
          api_key: credentials.api_key?.trim() ?? '',
        }).testConnection()
        break
      case 'hyundai-hmall':
        result = await new HyundaiHmallAdapter({
          oauser_id: credentials.oauser_id?.trim() ?? '',
          oause_key: credentials.oause_key?.trim() ?? '',
          ven_cd: credentials.ven_cd?.trim() ?? '',
          ven2_cd: credentials.ven2_cd?.trim() ?? '',
          mda_gb: credentials.mda_gb?.trim() ?? '',
          dlv_form_gbcd: credentials.dlv_form_gbcd?.trim() ?? '',
          base_url: credentials.base_url?.trim() ?? '',
          rgst_ip: credentials.rgst_ip?.trim() ?? '',
        }).testConnection()
        break
      case 'playauto-emp':
        result = await new PlayautoEmpAdapter({
          api_key: credentials.api_key?.trim() ?? '',
        }).testConnection()
        break
      default:
        return {
          success: false,
          error: `${marketplaceId}는 테스트 연결이 아직 지원되지 않습니다. 저장 후 실제 수집으로 검증하세요.`,
        }
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    }
  }
}

export async function saveSalesExportSettings(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const rawConnectionId = String(formData.get('connection_id') ?? '').trim()
  const connectionId = rawConnectionId.startsWith('common:') ? '' : rawConnectionId
  const marketplaceId = String(formData.get('marketplace_id') ?? '').trim()
    || (rawConnectionId.startsWith('common:') ? rawConnectionId.slice('common:'.length) : '')
  const systemMarketplaceName = String(formData.get('system_marketplace_name') ?? '').trim()
  const salesExportMarketplaceId = String(formData.get('sales_export_marketplace_id') ?? '').trim()
  const rawSalesFeePercent = String(formData.get('sales_fee_percent') ?? '').trim()
  const salesFeePercent = rawSalesFeePercent === '' ? null : Number(rawSalesFeePercent)

  if (!connectionId && !marketplaceId) return { error: '마켓 또는 연결 ID가 필요합니다.' }
  if (systemMarketplaceName.length > 100) {
    return { error: '표시용 마켓명은 100자 이내로 입력해주세요.' }
  }
  if (salesExportMarketplaceId.length > 100) {
    return { error: '매출확인용 마켓 ID는 100자 이내로 입력해주세요.' }
  }
  if (salesFeePercent !== null && (!Number.isFinite(salesFeePercent) || salesFeePercent < 0 || salesFeePercent > 100)) {
    return { error: '수수료율은 0부터 100 사이 숫자로 입력해주세요.' }
  }

  try {
    if (!connectionId) {
      await saveMarketplaceBusinessSetting({
        userId: workspaceUserId,
        marketplaceId,
        systemMarketplaceName,
        salesExportMarketplaceId,
        salesFeePercent,
      })
      revalidatePath('/settings/market-settings')
      revalidatePath('/analytics')
      updateTag('analytics')
      return { success: true, message: '마켓 공통 설정이 저장되었습니다.' }
    }

    const [connection] = await db
      .select({
        id: marketplaceConnections.id,
        metadata: marketplaceConnections.metadata,
      })
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.userId, workspaceUserId),
          eq(marketplaceConnections.id, connectionId),
        ),
      )
      .limit(1)

    if (!connection) {
      return { error: '연결 정보를 찾을 수 없습니다.' }
    }

    const metadata: Record<string, unknown> = {
      ...(connection.metadata ?? {}),
      salesExportMarketplaceId,
    }
    if (systemMarketplaceName) {
      metadata.systemMarketplaceName = systemMarketplaceName
    } else {
      delete metadata.systemMarketplaceName
    }
    if (salesFeePercent === null) {
      delete metadata.salesFeePercent
    } else {
      metadata.salesFeePercent = salesFeePercent
    }

    await db
      .update(marketplaceConnections)
      .set({
        metadata,
      })
      .where(
        and(
          eq(marketplaceConnections.userId, workspaceUserId),
          eq(marketplaceConnections.id, connectionId),
        ),
      )
  } catch (err) {
    return {
      error: `매출확인용 설정 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/settings/marketplaces')
  revalidatePath('/settings/market-settings')
  revalidatePath('/analytics')
  updateTag('analytics')
  return { success: true, message: '마켓 설정이 저장되었습니다.' }
}

export async function registerMarketplaceCredentials(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const marketplaceId = formData.get('marketplace_id') as string
  if (!marketplaceId || !marketplaceRegistry.has(marketplaceId)) {
    return { error: '유효하지 않은 마켓플레이스입니다.' }
  }

  const connectionId = String(formData.get('connection_id') ?? '').trim()
  const rawStoreAlias = String(formData.get('store_alias') ?? '').trim()
  if (formData.get('store_alias_required') === 'true' && !rawStoreAlias) {
    return { error: '연결 계정명을 입력해주세요. 예: 쿠팡-본계정, 쿠팡-서브계정' }
  }
  const storeAlias = rawStoreAlias || 'default'
  const config = marketplaceRegistry.get(marketplaceId).config
  const vaultNames: string[] = []
  const optionalCredentialKeys = OPTIONAL_CREDENTIALS[marketplaceId] ?? []
  const hiddenCredentialKeys = marketplaceId === 'cafe24' ? ['refresh_token'] : []
  let previousStoreAlias: string | null = null
  let previousMetadata: Record<string, unknown> | null = null

  // Validate all required credentials are provided
  for (const credKey of config.requiredCredentials) {
    const value = formData.get(credKey) as string
    if (!value || value.trim() === '') {
      return { error: `${credKey}을(를) 입력해주세요.` }
    }
  }

  // Store each credential in Vault (include alias in key to avoid collisions)
  const aliasTag = storeAlias === 'default' ? '' : `_${storeAlias}`

  if (marketplaceId === 'kakao-store') {
    const result = await new KakaoStoreAdapter({
      admin_app_key: ((formData.get('admin_app_key') as string) ?? '').trim(),
      seller_app_key: ((formData.get('seller_app_key') as string) ?? '').trim(),
      channel_ids: ((formData.get('channel_ids') as string) ?? '').trim() || '101',
    }).testConnection()
    if (!result.success) {
      return {
        error: `카카오쇼핑하기 연동 확인 실패: ${result.error ?? '알 수 없는 오류'}`,
      }
    }
  }

  try {
    if (connectionId) {
      const target = await db
        .select()
        .from(marketplaceConnections)
        .where(
          and(
            eq(marketplaceConnections.userId, workspaceUserId),
            eq(marketplaceConnections.id, connectionId),
            eq(marketplaceConnections.marketplaceId, marketplaceId),
          )
        )
        .limit(1)

      if (target.length === 0) {
        return { error: '수정할 연결 정보를 찾을 수 없습니다.' }
      }
      previousStoreAlias = target[0].storeAlias
      previousMetadata = target[0].metadata ?? null
      if (previousStoreAlias !== storeAlias) {
        const conflicts = await db
          .select()
          .from(marketplaceConnections)
          .where(
            and(
              eq(marketplaceConnections.userId, workspaceUserId),
              eq(marketplaceConnections.marketplaceId, marketplaceId),
              eq(marketplaceConnections.storeAlias, storeAlias),
            ),
          )
          .limit(1)
        if (conflicts.length > 0 && conflicts[0].id !== connectionId) {
          return { error: `${config.name}에 '${storeAlias}' 계정명이 이미 등록되어 있습니다. 다른 이름을 입력해주세요.` }
        }
      }
    } else {
      const existing = await db
        .select()
        .from(marketplaceConnections)
        .where(
          and(
            eq(marketplaceConnections.userId, workspaceUserId),
            eq(marketplaceConnections.marketplaceId, marketplaceId),
            eq(marketplaceConnections.storeAlias, storeAlias)
          )
        )
        .limit(1)

      if (existing.length > 0) {
        return {
          error: `${config.name}에 '${storeAlias}' 계정명이 이미 등록되어 있습니다. 기존 계정은 수정 버튼으로 변경하고, 새 계정은 다른 계정명을 입력해주세요.`,
        }
      }
    }
  } catch (err) {
    return {
      error: `연결 정보 확인 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  try {
    for (const credKey of [...config.requiredCredentials, ...optionalCredentialKeys]) {
      const value = formData.get(credKey) as string
      if (!value || value.trim() === '') continue
      const vaultKey = `${credKey}${aliasTag}`
      const name = `mkt_${workspaceUserId}_${marketplaceId}_${vaultKey}`
      await storeCredential(marketplaceId, workspaceUserId, vaultKey, value.trim())
      vaultNames.push(name)
    }
    if (connectionId && previousStoreAlias && previousStoreAlias !== storeAlias) {
      const previousAliasTag = previousStoreAlias === 'default' ? '' : `_${previousStoreAlias}`
      for (const credKey of hiddenCredentialKeys) {
        const previousValue = await readCredential(marketplaceId, workspaceUserId, `${credKey}${previousAliasTag}`)
        if (!previousValue) continue
        await storeCredential(marketplaceId, workspaceUserId, `${credKey}${aliasTag}`, previousValue)
        vaultNames.push(`mkt_${workspaceUserId}_${marketplaceId}_${credKey}${aliasTag}`)
      }
    }
  } catch (err) {
    return {
      error: `인증정보 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  // Create new connections by alias, or update one explicit existing connection.
  const displayName = storeAlias === 'default'
    ? config.name
    : `${config.name} (${storeAlias})`
  const metadata = {
    ...(previousMetadata ?? {}),
    ...(marketplaceId === 'playauto-emp'
      ? {
          integrationMethod: 'hub',
          linkedMarketplaces: Array.isArray(previousMetadata?.linkedMarketplaces)
            ? previousMetadata.linkedMarketplaces
            : [],
        }
      : {}),
  }

  try {
    const existing = await db
      .select()
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.userId, workspaceUserId),
          eq(marketplaceConnections.marketplaceId, marketplaceId),
          eq(marketplaceConnections.storeAlias, storeAlias)
        )
      )
      .limit(1)

    if (connectionId) {
      const target = await db
        .select()
        .from(marketplaceConnections)
        .where(
          and(
            eq(marketplaceConnections.userId, workspaceUserId),
            eq(marketplaceConnections.id, connectionId),
            eq(marketplaceConnections.marketplaceId, marketplaceId),
          )
        )
        .limit(1)

      if (target.length === 0) {
        return { error: '수정할 연결 정보를 찾을 수 없습니다.' }
      }

      await db
        .update(marketplaceConnections)
        .set({
          storeAlias,
          displayName,
          vaultSecretNames: vaultNames,
          metadata,
          status: 'connected',
          updatedAt: new Date(),
        })
        .where(eq(marketplaceConnections.id, connectionId))
      if (previousStoreAlias && previousStoreAlias !== storeAlias) {
        const previousAliasTag = previousStoreAlias === 'default' ? '' : `_${previousStoreAlias}`
        await Promise.all(
          [...config.requiredCredentials, ...optionalCredentialKeys, ...hiddenCredentialKeys]
            .map((credKey) => deleteCredential(marketplaceId, workspaceUserId, `${credKey}${previousAliasTag}`).catch(() => undefined)),
        )
      }
    } else {
      if (existing.length > 0) {
        return {
          error: `${config.name}에 '${storeAlias}' 계정명이 이미 등록되어 있습니다. 기존 계정은 수정 버튼으로 변경하고, 새 계정은 다른 계정명을 입력해주세요.`,
        }
      }

      await db.insert(marketplaceConnections).values({
        userId: workspaceUserId,
        marketplaceId,
        storeAlias,
        displayName,
        authType: config.authType,
        status: 'connected',
        vaultSecretNames: vaultNames,
        metadata,
      })
    }
  } catch (err) {
    return {
      error: `연결 정보 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${displayName} 인증정보가 저장되었습니다.` }
}

export async function registerRpaMarketplaceConnection(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const marketplaceId = String(formData.get('marketplace_id') ?? '').trim()
  if (!marketplaceId || !marketplaceRegistry.has(marketplaceId)) {
    return { error: '유효하지 않은 RPA 대상입니다.' }
  }

  const config = marketplaceRegistry.get(marketplaceId).config
  if (!getSupportedIntegrationMethods(marketplaceId, { authType: config.authType }).includes('rpa')) {
    return { error: `${config.name}은(는) RPA 연동 대상이 아닙니다.` }
  }

  const storeAlias = String(formData.get('store_alias') ?? '').trim() || 'default'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '').trim()
  if (!email || !password) {
    return { error: '로그인 ID와 비밀번호를 입력해주세요.' }
  }
  const twoFactorMethod = String(formData.get('two_factor_method') ?? '').trim()
  const twoFactorProfileId = String(formData.get('two_factor_profile_id') ?? '').trim()
  const extras: Record<string, string> = {}
  const requiresNaverEmailSecondFactor = marketplaceId === 'ohouse' || marketplaceId === 'gs-shop'
  if (requiresNaverEmailSecondFactor) {
    if (twoFactorMethod !== 'naver_email' || !twoFactorProfileId) {
      return { error: `${config.name} RPA는 공통 네이버 메일 인증수단 선택이 필요합니다.` }
    }
    await ensureCommonAuthProfilesTable()
    const [profile] = await db
      .select({ id: commonAuthProfiles.id })
      .from(commonAuthProfiles)
      .where(
        and(
          eq(commonAuthProfiles.id, twoFactorProfileId),
          eq(commonAuthProfiles.userId, workspaceUserId),
          eq(commonAuthProfiles.provider, 'naver_email'),
        ),
      )
      .limit(1)
    if (!profile) {
      return { error: '선택한 네이버 메일 인증수단을 찾을 수 없습니다.' }
    }
    extras.twoFactorMethod = 'naver_email'
    extras.twoFactorProfileId = twoFactorProfileId
    extras.accountKey = storeAlias
  }

  const displayName = storeAlias === 'default' ? config.name : `${config.name} (${storeAlias})`
  let connectionId: string

  try {
    const existing = await db
      .select()
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.userId, workspaceUserId),
          eq(marketplaceConnections.marketplaceId, marketplaceId),
          eq(marketplaceConnections.storeAlias, storeAlias),
        ),
      )
      .limit(1)

    const values = {
      displayName,
      authType: 'session' as const,
      status: 'connected' as const,
      vaultSecretNames: [] as string[],
      isManual: false,
      metadata: { integrationMethod: 'rpa' },
      updatedAt: new Date(),
    }

    if (existing.length > 0) {
      await db
        .update(marketplaceConnections)
        .set(values)
        .where(eq(marketplaceConnections.id, existing[0].id))
      connectionId = existing[0].id
    } else {
      const [created] = await db
        .insert(marketplaceConnections)
        .values({
          userId: workspaceUserId,
          marketplaceId,
          storeAlias,
          ...values,
        })
        .returning({ id: marketplaceConnections.id })
      connectionId = created.id
    }
  } catch (err) {
    return {
      error: `RPA 연결 정보 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  try {
    await storeScrapeCredentials(workspaceUserId, marketplaceId, connectionId, {
      email,
      password,
      extras: Object.keys(extras).length > 0 ? extras : undefined,
    })
    await db
      .update(marketplaceConnections)
      .set({
        vaultSecretNames: [
          `scrape_${workspaceUserId}_${marketplaceId}_${connectionId}_email`,
          `scrape_${workspaceUserId}_${marketplaceId}_${connectionId}_password`,
          ...(Object.keys(extras).length > 0
            ? [`scrape_${workspaceUserId}_${marketplaceId}_${connectionId}_extras`]
            : []),
        ],
        updatedAt: new Date(),
      })
      .where(eq(marketplaceConnections.id, connectionId))
  } catch (err) {
    return {
      error: `RPA 로그인 정보 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/orders/collect')
  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${displayName} RPA 연결이 등록되었습니다.` }
}

export async function renameRpaMarketplaceConnection(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { error: '인증이 필요합니다.' }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const connectionId = String(formData.get('connection_id') ?? '').trim()
  const storeAlias = String(formData.get('store_alias') ?? '').trim()
  if (!connectionId) return { error: '연결 ID가 필요합니다.' }
  if (!storeAlias) return { error: '연결 계정명을 입력해주세요.' }
  if (storeAlias.length > 100) return { error: '연결 계정명은 100자 이내로 입력해주세요.' }

  try {
    const [connection] = await db
      .select()
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.id, connectionId),
          eq(marketplaceConnections.userId, workspaceUserId),
        ),
      )
      .limit(1)
    if (!connection) return { error: '수정할 연결 정보를 찾을 수 없습니다.' }
    if (getIntegrationMethod(connection.marketplaceId, {
      authType: connection.authType,
      isManual: connection.isManual,
    }) !== 'rpa') {
      return { error: 'RPA 연결만 이 화면에서 수정할 수 있습니다.' }
    }
    if (!marketplaceRegistry.has(connection.marketplaceId)) {
      return { error: '유효하지 않은 마켓플레이스입니다.' }
    }

    const duplicate = await db
      .select({ id: marketplaceConnections.id })
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.userId, workspaceUserId),
          eq(marketplaceConnections.marketplaceId, connection.marketplaceId),
          eq(marketplaceConnections.storeAlias, storeAlias),
        ),
      )
      .limit(1)
    if (duplicate.length > 0 && duplicate[0].id !== connectionId) {
      return { error: `'${storeAlias}' 계정명이 이미 등록되어 있습니다. 다른 이름을 입력해주세요.` }
    }

    const config = marketplaceRegistry.get(connection.marketplaceId).config
    const displayName = storeAlias === 'default' ? config.name : `${config.name} (${storeAlias})`
    const credentials = await readScrapeCredentials(connection.marketplaceId, workspaceUserId, connectionId)
    if (!credentials) {
      return { error: '기존 RPA 로그인 정보를 찾을 수 없어 계정명을 변경하지 않았습니다.' }
    }
    const preservedExtras = credentials.extras
      ? Object.fromEntries(
          Object.entries(credentials.extras).filter(([key]) => key !== 'naverEmail' && key !== 'naverPassword'),
        )
      : undefined

    // Preserve extras.accountKey: Ohouse uses it to keep collected order identities stable.
    await storeScrapeCredentials(workspaceUserId, connection.marketplaceId, connectionId, {
      email: credentials.email,
      password: credentials.password,
      extras: preservedExtras && Object.keys(preservedExtras).length > 0 ? preservedExtras : undefined,
    })
    await db
      .update(marketplaceConnections)
      .set({
        storeAlias,
        displayName,
        vaultSecretNames: [
          `scrape_${workspaceUserId}_${connection.marketplaceId}_${connectionId}_email`,
          `scrape_${workspaceUserId}_${connection.marketplaceId}_${connectionId}_password`,
          ...(preservedExtras && Object.keys(preservedExtras).length > 0
            ? [`scrape_${workspaceUserId}_${connection.marketplaceId}_${connectionId}_extras`]
            : []),
        ],
        updatedAt: new Date(),
      })
      .where(eq(marketplaceConnections.id, connectionId))

    revalidatePath('/dashboard')
    revalidatePath('/orders/collect')
    revalidatePath('/settings/marketplaces')
    return { success: true, message: `${displayName} 연결 계정명이 변경되었습니다.` }
  } catch (err) {
    return { error: `RPA 연결 계정명 변경 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}` }
  }
}

export async function registerExcelMarketplaceConnection(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const rawMarketplaceId = String(formData.get('marketplace_id') ?? '').trim()
  const customName = String(formData.get('display_name') ?? '').trim()
  const storeAlias = String(formData.get('store_alias') ?? '').trim() || 'excel'

  if (rawMarketplaceId === 'domechango' || customName.replace(/\s+/g, '').includes('도매창고')) {
    return { error: '도매창고는 엑셀 수동이 아니라 RPA 자동화로 등록해주세요.' }
  }

  let marketplaceId = rawMarketplaceId
  let displayName = customName
  if (marketplaceId && marketplaceRegistry.has(marketplaceId)) {
    const config = marketplaceRegistry.get(marketplaceId).config
    displayName = customName || config.name
  } else {
    marketplaceId = `manual-${nanoid(6)}`
  }

  if (!displayName) {
    return { error: '엑셀 업로드몰 이름을 입력해주세요.' }
  }

  try {
    const existing = await db
      .select()
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.userId, workspaceUserId),
          eq(marketplaceConnections.marketplaceId, marketplaceId),
          eq(marketplaceConnections.storeAlias, storeAlias),
        ),
      )
      .limit(1)

    const values = {
      displayName,
      authType: 'api_key' as const,
      status: 'connected' as const,
      vaultSecretNames: [] as string[],
      isManual: true,
      metadata: { integrationMethod: 'excel' },
      updatedAt: new Date(),
    }

    if (existing.length > 0) {
      await db
        .update(marketplaceConnections)
        .set(values)
        .where(eq(marketplaceConnections.id, existing[0].id))
    } else {
      await db.insert(marketplaceConnections).values({
        userId: workspaceUserId,
        marketplaceId,
        storeAlias,
        ...values,
      })
    }
  } catch (err) {
    return {
      error: `엑셀 업로드몰 등록 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  revalidatePath('/orders/collect')
  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${displayName} 엑셀 업로드몰이 등록되었습니다.` }
}

export async function deleteMarketplaceConnection(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: '인증이 필요합니다.' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const connectionId = formData.get('connection_id') as string
  if (!connectionId) {
    return { error: '연결 ID가 필요합니다.' }
  }

  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, workspaceUserId),
        eq(marketplaceConnections.id, connectionId)
      )
    )
    .limit(1)

  if (connections.length === 0) {
    return { error: '연결 정보를 찾을 수 없습니다.' }
  }

  const connection = connections[0]

  // Delete vault secrets using stored names
  try {
    for (const secretName of connection.vaultSecretNames) {
      if (secretName.startsWith('scrape_')) {
        await deleteCredentialByName(secretName)
      } else {
        const parts = secretName.split('_')
        const credKey = parts.slice(3).join('_')
        await deleteCredential(connection.marketplaceId, workspaceUserId, credKey)
      }
    }
  } catch (err) {
    return {
      error: `인증정보 삭제 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  // Delete connection record
  await db
    .delete(marketplaceConnections)
    .where(eq(marketplaceConnections.id, connection.id))

  revalidatePath('/dashboard')
  revalidatePath('/settings/marketplaces')
  return { success: true }
}

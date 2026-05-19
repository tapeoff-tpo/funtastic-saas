'use server'

import { createClient } from '@/lib/supabase/server'
import { storeCredential, deleteCredential, deleteCredentialByName, readCredential } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import '@/lib/marketplace/adapters/configs'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'
import { TossShoppingAdapter } from '@/lib/marketplace/adapters/toss-shopping/adapter'
import { OwnerclanAdapter } from '@/lib/marketplace/adapters/ownerclan/adapter'
import { KakaoStoreAdapter } from '@/lib/marketplace/adapters/kakao-store/adapter'
import { DomesinAdapter } from '@/lib/marketplace/adapters/domesin/adapter'
import { SpecialofferAdapter } from '@/lib/marketplace/adapters/specialoffer/adapter'
import { DomechangoAdapter } from '@/lib/marketplace/adapters/domechango/adapter'
import { TobizonAdapter } from '@/lib/marketplace/adapters/tobizon/adapter'
import { SsgmallAdapter } from '@/lib/marketplace/adapters/ssgmall/adapter'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { nanoid } from 'nanoid'
import { storeScrapeCredentials } from '@/scrapers/credentials'

interface ActionResult {
  success?: boolean
  error?: string
  message?: string
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

  const values: Record<string, string> = {}
  try {
    for (const credKey of config.requiredCredentials) {
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

  const storeAlias = (formData.get('store_alias') as string)?.trim() || 'default'
  const config = marketplaceRegistry.get(marketplaceId).config
  const vaultNames: string[] = []

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
        error: `카카오톡스토어 연동 확인 실패: ${result.error ?? '알 수 없는 오류'}`,
      }
    }
  }

  try {
    for (const credKey of config.requiredCredentials) {
      const value = formData.get(credKey) as string
      const vaultKey = `${credKey}${aliasTag}`
      const name = `mkt_${workspaceUserId}_${marketplaceId}_${vaultKey}`
      await storeCredential(marketplaceId, workspaceUserId, vaultKey, value.trim())
      vaultNames.push(name)
    }
  } catch (err) {
    return {
      error: `인증정보 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    }
  }

  // Upsert connection (unique on userId + marketplaceId + storeAlias)
  const displayName = storeAlias === 'default'
    ? config.name
    : `${config.name} (${storeAlias})`

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

    if (existing.length > 0) {
      await db
        .update(marketplaceConnections)
        .set({
          displayName,
          vaultSecretNames: vaultNames,
          status: 'connected',
          updatedAt: new Date(),
        })
        .where(eq(marketplaceConnections.id, existing[0].id))
    } else {
      await db.insert(marketplaceConnections).values({
        userId: workspaceUserId,
        marketplaceId,
        storeAlias,
        displayName,
        authType: config.authType,
        status: 'connected',
        vaultSecretNames: vaultNames,
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
  if (getIntegrationMethod(marketplaceId, { authType: config.authType }) !== 'rpa') {
    return { error: `${config.name}은(는) RPA 연동 대상이 아닙니다.` }
  }

  const storeAlias = String(formData.get('store_alias') ?? '').trim() || 'default'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '').trim()
  if (!email || !password) {
    return { error: '로그인 ID와 비밀번호를 입력해주세요.' }
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
    await storeScrapeCredentials(workspaceUserId, marketplaceId, connectionId, { email, password })
    await db
      .update(marketplaceConnections)
      .set({
        vaultSecretNames: [
          `scrape_${workspaceUserId}_${marketplaceId}_${connectionId}_email`,
          `scrape_${workspaceUserId}_${marketplaceId}_${connectionId}_password`,
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

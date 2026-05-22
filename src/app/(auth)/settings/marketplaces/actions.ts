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
import { KakaoStoreAdapter } from '@/lib/marketplace/adapters/kakao-store/adapter'
import { DomesinAdapter } from '@/lib/marketplace/adapters/domesin/adapter'
import { SpecialofferAdapter } from '@/lib/marketplace/adapters/specialoffer/adapter'
import { DomechangoAdapter } from '@/lib/marketplace/adapters/domechango/adapter'
import { TobizonAdapter } from '@/lib/marketplace/adapters/tobizon/adapter'
import { SsgmallAdapter } from '@/lib/marketplace/adapters/ssgmall/adapter'
import { PlayautoEmpAdapter } from '@/lib/marketplace/adapters/playauto-emp/adapter'
import { HyundaiHmallAdapter } from '@/lib/marketplace/adapters/hyundai-hmall/adapter'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getIntegrationMethod, getSupportedIntegrationMethods } from '@/lib/marketplace/integration-methods'
import { nanoid } from 'nanoid'
import { storeScrapeCredentials } from '@/scrapers/credentials'

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
    return { error: '?¸ì¦???„ìš”?©ë‹ˆ??' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const provider = String(formData.get('provider') ?? 'naver_email').trim()
  const name = String(formData.get('name') ?? '').trim() || 'ê¸°ë³¸ ?¤ì´ë²?ë©”ì¼'
  const accountEmail = String(formData.get('account_email') ?? '').trim()
  const appPassword = String(formData.get('app_password') ?? '').replace(/\s+/g, '')

  if (provider !== 'naver_email') {
    return { error: '?„ì¬???¤ì´ë²?ë©”ì¼ ?¸ì¦?˜ë‹¨ë§?ì§€?í•©?ˆë‹¤.' }
  }
  if (!accountEmail || !appPassword) {
    return { error: '?¤ì´ë²?ë©”ì¼ ì£¼ì†Œ?€ ? í”Œë¦¬ì??´ì…˜ ë¹„ë?ë²ˆí˜¸ë¥??…ë ¥?´ì£¼?¸ìš”.' }
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
      return { error: 'ê³µí†µ ?¸ì¦?˜ë‹¨ IDë¥??ì„±?˜ì? ëª»í–ˆ?µë‹ˆ??' }
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
      error: `ê³µí†µ ?¸ì¦?˜ë‹¨ ?€???¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
    }
  }

  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${name} ?¸ì¦?˜ë‹¨???€?¥ë˜?ˆìŠµ?ˆë‹¤.` }
}

/**
 * ?€?¥ëœ ë§ˆì¼“?Œë ˆ?´ìŠ¤ ?¸ì¦?•ë³´ë¥?Vault?ì„œ ?½ì–´ ë³µí˜¸?”ëœ ê°’ìœ¼ë¡?ë°˜í™˜.
 * ?˜ì • ?”ë©´ pre-fill ?©ë„. ë¸Œë¼?°ì????‰ë¬¸?¼ë¡œ ?¸ì¶œ?˜ë?ë¡?
 * ë°˜ë“œ???¸ì¦???Œìœ ???”ì²­ë§??µê³¼?œí‚¨??
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
  if (authError || !user) return { error: '?¸ì¦???„ìš”?©ë‹ˆ??' }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  if (!connectionId) return { error: '?°ê²° IDê°€ ?„ìš”?©ë‹ˆ??' }

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

  if (rows.length === 0) return { error: '?°ê²° ?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' }

  const connection = rows[0]
  if (!marketplaceRegistry.has(connection.marketplaceId)) {
    return { error: '? íš¨?˜ì? ?Šì? ë§ˆì¼“?Œë ˆ?´ìŠ¤?…ë‹ˆ??' }
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
      error: `?¸ì¦?•ë³´ ì¡°íšŒ ?¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
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
 * ?¼ì— ?…ë ¥???ê²©ì¦ëª…?¼ë¡œ ?¤ì œ ë§ˆì¼“?Œë ˆ?´ìŠ¤ API ?¸ì¶œ ?œë„.
 * ?€???„ì— ê°’ì´ ? íš¨?œì? ê²€ì¦í•  ???¬ìš©. Vault???€?¥í•˜ì§€ ?Šê³  ë©”ëª¨ë¦¬ì—?œë§Œ ?¬ìš©.
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
  if (authError || !user) return { success: false, error: '?¸ì¦???„ìš”?©ë‹ˆ??' }

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
            : 'api_key?€ base_url???…ë ¥?´ì£¼?¸ìš”.',
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
          error: `${marketplaceId}???ŒìŠ¤???°ê²°???„ì§ ì§€?ë˜ì§€ ?ŠìŠµ?ˆë‹¤. ?€?????¤ì œ ?˜ì§‘?¼ë¡œ ê²€ì¦í•˜?¸ìš”.`,
        }
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜',
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
    return { error: '?¸ì¦???„ìš”?©ë‹ˆ??' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const marketplaceId = formData.get('marketplace_id') as string
  if (!marketplaceId || !marketplaceRegistry.has(marketplaceId)) {
    return { error: '? íš¨?˜ì? ?Šì? ë§ˆì¼“?Œë ˆ?´ìŠ¤?…ë‹ˆ??' }
  }

  const connectionId = String(formData.get('connection_id') ?? '').trim()
  const rawStoreAlias = String(formData.get('store_alias') ?? '').trim()
  if (formData.get('store_alias_required') === 'true' && !rawStoreAlias) {
    return { error: '?°ê²° ê³„ì •ëª…ì„ ?…ë ¥?´ì£¼?¸ìš”. ?? ì¿ íŒ¡-ë³¸ê³„?? ì¿ íŒ¡-?œë¸Œê³„ì •' }
  }
  const storeAlias = rawStoreAlias || 'default'
  const config = marketplaceRegistry.get(marketplaceId).config
  const vaultNames: string[] = []
  const optionalCredentialKeys = OPTIONAL_CREDENTIALS[marketplaceId] ?? []

  // Validate all required credentials are provided
  for (const credKey of config.requiredCredentials) {
    const value = formData.get(credKey) as string
    if (!value || value.trim() === '') {
      return { error: `${credKey}??ë¥? ?…ë ¥?´ì£¼?¸ìš”.` }
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
        error: `ì¹´ì¹´?¤í†¡?¤í† ???°ë™ ?•ì¸ ?¤íŒ¨: ${result.error ?? '?????†ëŠ” ?¤ë¥˜'}`,
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
        return { error: '?˜ì •???°ê²° ?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' }
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
          error: `${config.name}??'${storeAlias}' ê³„ì •ëª…ì´ ?´ë? ?±ë¡?˜ì–´ ?ˆìŠµ?ˆë‹¤. ê¸°ì¡´ ê³„ì •?€ ?˜ì • ë²„íŠ¼?¼ë¡œ ë³€ê²½í•˜ê³? ??ê³„ì •?€ ?¤ë¥¸ ê³„ì •ëª…ì„ ?…ë ¥?´ì£¼?¸ìš”.`,
        }
      }
    }
  } catch (err) {
    return {
      error: `?°ê²° ?•ë³´ ?•ì¸ ?¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
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
  } catch (err) {
    return {
      error: `?¸ì¦?•ë³´ ?€???¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
    }
  }

  // Create new connections by alias, or update one explicit existing connection.
  const displayName = storeAlias === 'default'
    ? config.name
    : `${config.name} (${storeAlias})`
  const metadata = marketplaceId === 'playauto-emp'
    ? {
        integrationMethod: 'hub',
        linkedMarketplaces: [],
      }
    : undefined

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
        return { error: '?˜ì •???°ê²° ?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' }
      }

      await db
        .update(marketplaceConnections)
        .set({
          displayName,
          vaultSecretNames: vaultNames,
          ...(metadata ? { metadata } : {}),
          status: 'connected',
          updatedAt: new Date(),
        })
        .where(eq(marketplaceConnections.id, connectionId))
    } else {
      if (existing.length > 0) {
        return {
          error: `${config.name}??'${storeAlias}' ê³„ì •ëª…ì´ ?´ë? ?±ë¡?˜ì–´ ?ˆìŠµ?ˆë‹¤. ê¸°ì¡´ ê³„ì •?€ ?˜ì • ë²„íŠ¼?¼ë¡œ ë³€ê²½í•˜ê³? ??ê³„ì •?€ ?¤ë¥¸ ê³„ì •ëª…ì„ ?…ë ¥?´ì£¼?¸ìš”.`,
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
        ...(metadata ? { metadata } : {}),
      })
    }
  } catch (err) {
    return {
      error: `?°ê²° ?•ë³´ ?€???¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${displayName} ?¸ì¦?•ë³´ê°€ ?€?¥ë˜?ˆìŠµ?ˆë‹¤.` }
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
    return { error: '?¸ì¦???„ìš”?©ë‹ˆ??' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const marketplaceId = String(formData.get('marketplace_id') ?? '').trim()
  if (!marketplaceId || !marketplaceRegistry.has(marketplaceId)) {
    return { error: '? íš¨?˜ì? ?Šì? RPA ?€?ì…?ˆë‹¤.' }
  }

  const config = marketplaceRegistry.get(marketplaceId).config
  if (!getSupportedIntegrationMethods(marketplaceId, { authType: config.authType }).includes('rpa')) {
    return { error: `${config.name}?€(?? RPA ?°ë™ ?€?ì´ ?„ë‹™?ˆë‹¤.` }
  }

  const storeAlias = String(formData.get('store_alias') ?? '').trim() || 'default'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '').trim()
  if (!email || !password) {
    return { error: 'ë¡œê·¸??ID?€ ë¹„ë?ë²ˆí˜¸ë¥??…ë ¥?´ì£¼?¸ìš”.' }
  }
  const twoFactorMethod = String(formData.get('two_factor_method') ?? '').trim()
  const twoFactorProfileId = String(formData.get('two_factor_profile_id') ?? '').trim()
  const gsSecondFactorMethod = String(formData.get('gs_second_factor_method') ?? '').trim()
  const gsSecondFactorTarget = String(formData.get('gs_second_factor_target') ?? '').trim()
  const extras: Record<string, string> = {}
  if (marketplaceId === 'ohouse') {
    if (twoFactorMethod !== 'naver_email' || !twoFactorProfileId) {
      return { error: '?¤ëŠ˜?˜ì§‘ RPA??ê³µí†µ ?¤ì´ë²?ë©”ì¼ ?¸ì¦?˜ë‹¨ ? íƒ???„ìš”?©ë‹ˆ??' }
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
      return { error: '? íƒ???¤ì´ë²?ë©”ì¼ ?¸ì¦?˜ë‹¨??ì°¾ì„ ???†ìŠµ?ˆë‹¤.' }
    }
    extras.twoFactorMethod = 'naver_email'
    extras.twoFactorProfileId = twoFactorProfileId
    extras.accountKey = storeAlias
  }
  if (marketplaceId === 'gs-shop') {
    extras.twoFactorMethod = gsSecondFactorMethod || 'manual'
    if (gsSecondFactorTarget) extras.twoFactorTarget = gsSecondFactorTarget
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
      error: `RPA ?°ê²° ?•ë³´ ?€???¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
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
      error: `RPA ë¡œê·¸???•ë³´ ?€???¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/orders/collect')
  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${displayName} RPA ?°ê²°???±ë¡?˜ì—ˆ?µë‹ˆ??` }
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
    return { error: '?¸ì¦???„ìš”?©ë‹ˆ??' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const rawMarketplaceId = String(formData.get('marketplace_id') ?? '').trim()
  const customName = String(formData.get('display_name') ?? '').trim()
  const storeAlias = String(formData.get('store_alias') ?? '').trim() || 'excel'

  if (rawMarketplaceId === 'domechango' || customName.replace(/\s+/g, '').includes('?„ë§¤ì°½ê³ ')) {
    return { error: '?„ë§¤ì°½ê³ ???‘ì? ?˜ë™???„ë‹ˆ??RPA ?ë™?”ë¡œ ?±ë¡?´ì£¼?¸ìš”.' }
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
    return { error: '?‘ì? ?…ë¡œ?œëª° ?´ë¦„???…ë ¥?´ì£¼?¸ìš”.' }
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
      error: `?‘ì? ?…ë¡œ?œëª° ?±ë¡ ?¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
    }
  }

  revalidatePath('/orders/collect')
  revalidatePath('/settings/marketplaces')
  return { success: true, message: `${displayName} ?‘ì? ?…ë¡œ?œëª°???±ë¡?˜ì—ˆ?µë‹ˆ??` }
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
    return { error: '?¸ì¦???„ìš”?©ë‹ˆ??' }
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const connectionId = formData.get('connection_id') as string
  if (!connectionId) {
    return { error: '?°ê²° IDê°€ ?„ìš”?©ë‹ˆ??' }
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
    return { error: '?°ê²° ?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' }
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
      error: `?¸ì¦?•ë³´ ?? œ ?¤íŒ¨: ${err instanceof Error ? err.message : '?????†ëŠ” ?¤ë¥˜'}`,
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

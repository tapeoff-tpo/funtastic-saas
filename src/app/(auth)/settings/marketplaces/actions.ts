'use server'

import { createClient } from '@/lib/supabase/server'
import { storeCredential, deleteCredential } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import '@/lib/marketplace/adapters/configs'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success?: boolean
  error?: string
  message?: string
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
  try {
    for (const credKey of config.requiredCredentials) {
      const value = formData.get(credKey) as string
      const vaultKey = `${credKey}${aliasTag}`
      const name = `mkt_${user.id}_${marketplaceId}_${vaultKey}`
      await storeCredential(marketplaceId, user.id, vaultKey, value.trim())
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
          eq(marketplaceConnections.userId, user.id),
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
        userId: user.id,
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

  const connectionId = formData.get('connection_id') as string
  if (!connectionId) {
    return { error: '연결 ID가 필요합니다.' }
  }

  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, user.id),
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
      const parts = secretName.split('_')
      const credKey = parts.slice(3).join('_')
      await deleteCredential(connection.marketplaceId, user.id, credKey)
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

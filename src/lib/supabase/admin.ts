import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client -- NEVER expose to browser.
 *
 * This file must ONLY be imported in server-side code:
 * - API routes (src/app/api/*)
 * - Server Actions
 * - Background workers
 *
 * The service_role key bypasses Row Level Security and has full DB access.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
    )
  }

  return createClient(url, key)
}

/**
 * Store an encrypted credential in Supabase Vault.
 *
 * @param marketplaceId - The marketplace this credential belongs to
 * @param userId - The user who owns this credential
 * @param credentialKey - The credential field name (e.g., 'api_key', 'secret_key')
 * @param secret - The secret value to encrypt and store
 * @returns The Vault secret UUID
 */
export async function storeCredential(
  marketplaceId: string,
  userId: string,
  credentialKey: string,
  secret: string
): Promise<string> {
  const admin = createAdminClient()
  const name = `mkt_${userId}_${marketplaceId}_${credentialKey}`
  const { data, error } = await admin.rpc('store_marketplace_credential', {
    p_name: name,
    p_secret: secret,
    p_description: `${marketplaceId} ${credentialKey} for user ${userId}`,
  })
  if (error) throw new Error(`Vault store failed: ${error.message}`)
  return data as string
}

/**
 * Read a decrypted credential from Supabase Vault.
 *
 * @returns The decrypted secret value, or null if not found
 */
export async function readCredential(
  marketplaceId: string,
  userId: string,
  credentialKey: string
): Promise<string | null> {
  const admin = createAdminClient()
  const name = `mkt_${userId}_${marketplaceId}_${credentialKey}`
  const { data, error } = await admin.rpc('read_marketplace_credential', {
    p_name: name,
  })
  if (error) throw new Error(`Vault read failed: ${error.message}`)
  return data as string | null
}

/**
 * 사용자 ID 로 표시 이름을 조회 — 매핑자/스캔자 표시용.
 * 우선순위: user_metadata.full_name → user_metadata.name → email 의 @ 앞 → user_id 앞 8자리.
 * 알 수 없으면 null 반환.
 */
export async function getUserDisplayName(userId: string): Promise<string | null> {
  if (!userId) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return userId.slice(0, 8)
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
    const fullName = typeof meta.full_name === 'string' ? meta.full_name : undefined
    const name = typeof meta.name === 'string' ? meta.name : undefined
    const emailLocal = data.user.email?.split('@')[0]
    return fullName || name || emailLocal || userId.slice(0, 8)
  } catch {
    return userId.slice(0, 8)
  }
}

/**
 * 여러 사용자 ID 의 표시 이름을 한 번에 조회.
 */
export async function getUserDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  const result = new Map<string, string>()
  await Promise.all(
    unique.map(async (id) => {
      const name = await getUserDisplayName(id)
      if (name) result.set(id, name)
    }),
  )
  return result
}

/**
 * Delete a credential from Supabase Vault.
 */
export async function deleteCredential(
  marketplaceId: string,
  userId: string,
  credentialKey: string
): Promise<void> {
  const admin = createAdminClient()
  const name = `mkt_${userId}_${marketplaceId}_${credentialKey}`
  const { error } = await admin.rpc('delete_marketplace_credential', {
    p_name: name,
  })
  if (error) throw new Error(`Vault delete failed: ${error.message}`)
}

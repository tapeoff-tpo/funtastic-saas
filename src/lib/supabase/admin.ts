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

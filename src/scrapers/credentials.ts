/**
 * Credential storage for scrapers.
 *
 * Reuses the existing Supabase Vault pattern from API credentials, but with
 * a different naming prefix to keep them separate.
 *
 * Naming: `scrape_{userId}_{marketplaceId}_{connectionId}_{field}`
 *   field ∈ { email | password | extras }
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import type { ScraperCredentials } from './types'

function key(userId: string, marketplaceId: string, connectionId: string, field: string): string {
  return `scrape_${userId}_${marketplaceId}_${connectionId}_${field}`
}

export async function storeScrapeCredentials(
  userId: string,
  marketplaceId: string,
  connectionId: string,
  creds: { email: string; password: string; extras?: Record<string, string> },
): Promise<void> {
  const admin = createAdminClient()
  // Reuse the same store_marketplace_credential RPC (it's a generic vault writer)
  const writes = [
    {
      name: key(userId, marketplaceId, connectionId, 'email'),
      secret: creds.email,
    },
    {
      name: key(userId, marketplaceId, connectionId, 'password'),
      secret: creds.password,
    },
  ]
  if (creds.extras) {
    writes.push({
      name: key(userId, marketplaceId, connectionId, 'extras'),
      secret: JSON.stringify(creds.extras),
    })
  }
  for (const w of writes) {
    const { error } = await admin.rpc('store_marketplace_credential', {
      p_name: w.name,
      p_secret: w.secret,
      p_description: `scraper cred for ${marketplaceId}`,
    })
    if (error) throw new Error(`Vault store failed (${w.name}): ${error.message}`)
  }
}

export async function readScrapeCredentials(
  marketplaceId: string,
  userId: string,
  connectionId: string,
): Promise<ScraperCredentials | null> {
  const admin = createAdminClient()
  const readVaultName = async (name: string): Promise<string | null> => {
    const { data, error } = await admin.rpc('read_marketplace_credential', {
      p_name: name,
    })
    if (error) return null
    return (data as string | null) ?? null
  }
  const readField = (field: string): Promise<string | null> =>
    readVaultName(key(userId, marketplaceId, connectionId, field))

  let email = await readField('email')
  let password = await readField('password')

  // RPA connections created from the settings page are stored with the same
  // marketplace credential key pattern as API connections. Keep this fallback
  // until the UI can persist connection-id-scoped scraper credentials directly.
  if (!email || !password) {
    const [connection] = await db
      .select({ storeAlias: marketplaceConnections.storeAlias })
      .from(marketplaceConnections)
      .where(
        and(
          eq(marketplaceConnections.id, connectionId),
          eq(marketplaceConnections.userId, userId),
        ),
      )
      .limit(1)

    const aliasTag = !connection || connection.storeAlias === 'default'
      ? ''
      : `_${connection.storeAlias}`
    email = email ?? await readVaultName(`mkt_${userId}_${marketplaceId}_email${aliasTag}`)
    password = password ?? await readVaultName(`mkt_${userId}_${marketplaceId}_password${aliasTag}`)
  }
  if (!email || !password) return null

  const extrasRaw = await readField('extras')
  const storageState = await readField('storageState')

  return {
    email,
    password,
    extras: extrasRaw ? (JSON.parse(extrasRaw) as Record<string, string>) : undefined,
    storageState: storageState ?? undefined,
  }
}

/** Persist updated session state (cookies) after a successful login. */
export async function saveStorageState(
  userId: string,
  marketplaceId: string,
  connectionId: string,
  storageState: string,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.rpc('store_marketplace_credential', {
    p_name: key(userId, marketplaceId, connectionId, 'storageState'),
    p_secret: storageState,
    p_description: `scraper session state for ${marketplaceId}`,
  })
  if (error) throw new Error(`Vault store failed (storageState): ${error.message}`)
}

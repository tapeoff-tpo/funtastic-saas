import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { commonAuthProfiles } from '@/lib/db/schema'
import { createAdminClient, deleteCredentialByName } from '@/lib/supabase/admin'

export interface CommonAuthProfileCredentials {
  email: string
  password: string
}

function profileVaultKey(userId: string, profileId: string, field: 'email' | 'password'): string {
  return `auth_profile_${userId}_${profileId}_${field}`
}

export async function ensureCommonAuthProfilesTable(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS common_auth_profiles (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id uuid NOT NULL,
      name varchar(100) NOT NULL,
      provider varchar(50) NOT NULL DEFAULT 'naver_email',
      account_email varchar(255) NOT NULL,
      vault_secret_names jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS common_auth_profiles_user_provider_name
      ON common_auth_profiles (user_id, provider, name)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS common_auth_profiles_user_provider
      ON common_auth_profiles (user_id, provider)
  `)
}

async function storeVaultSecret(name: string, secret: string, description: string): Promise<void> {
  const admin = createAdminClient()
  await deleteCredentialByName(name).catch(() => undefined)
  const { error } = await admin.rpc('store_marketplace_credential', {
    p_name: name,
    p_secret: secret,
    p_description: description,
  })
  if (error) throw new Error(`Vault store failed (${name}): ${error.message}`)
}

async function readVaultSecret(name: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('read_marketplace_credential', {
    p_name: name,
  })
  if (error) return null
  return (data as string | null) ?? null
}

export async function storeCommonAuthProfileCredentials(params: {
  userId: string
  profileId: string
  email: string
  password: string
}): Promise<string[]> {
  const emailKey = profileVaultKey(params.userId, params.profileId, 'email')
  const passwordKey = profileVaultKey(params.userId, params.profileId, 'password')
  await storeVaultSecret(emailKey, params.email, `common auth email for ${params.profileId}`)
  await storeVaultSecret(passwordKey, params.password, `common auth password for ${params.profileId}`)
  return [emailKey, passwordKey]
}

export async function readCommonAuthProfileCredentials(params: {
  userId: string
  profileId: string
  provider?: string
}): Promise<CommonAuthProfileCredentials | null> {
  await ensureCommonAuthProfilesTable()
  const [profile] = await db
    .select()
    .from(commonAuthProfiles)
    .where(
      and(
        eq(commonAuthProfiles.id, params.profileId),
        eq(commonAuthProfiles.userId, params.userId),
        eq(commonAuthProfiles.provider, params.provider ?? 'naver_email'),
      ),
    )
    .limit(1)

  if (!profile) return null

  const email = await readVaultSecret(profileVaultKey(params.userId, params.profileId, 'email'))
  const password = await readVaultSecret(profileVaultKey(params.userId, params.profileId, 'password'))

  if (!email || !password) return null
  return { email, password }
}

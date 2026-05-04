import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { storeCredential, deleteCredential } from '@/lib/supabase/admin'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

/**
 * POST /api/marketplace/credentials
 *
 * Store marketplace credentials in Vault and create a marketplace_connections row.
 *
 * Body: { marketplaceId: string, credentials: Record<string, string> }
 */
export async function POST(request: NextRequest) {
  // Verify auth
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  // Parse and validate body
  let body: { marketplaceId: string; credentials: Record<string, string> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { marketplaceId, credentials } = body

  if (!marketplaceId || !credentials || typeof credentials !== 'object') {
    return NextResponse.json(
      { error: 'marketplaceId and credentials are required' },
      { status: 400 }
    )
  }

  // Validate marketplace is registered
  if (!marketplaceRegistry.has(marketplaceId)) {
    return NextResponse.json(
      { error: `Unknown marketplace: ${marketplaceId}` },
      { status: 400 }
    )
  }

  const config = marketplaceRegistry.get(marketplaceId).config

  // Verify all required credentials are provided
  const missing = config.requiredCredentials.filter(
    (key) => !credentials[key] || credentials[key].trim() === ''
  )
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required credentials: ${missing.join(', ')}` },
      { status: 400 }
    )
  }

  // Store each credential in Vault
  const vaultSecretNames: string[] = []
  try {
    for (const [key, secret] of Object.entries(credentials)) {
      if (config.requiredCredentials.includes(key)) {
        await storeCredential(marketplaceId, workspaceUserId, key, secret)
        vaultSecretNames.push(`mkt_${workspaceUserId}_${marketplaceId}_${key}`)
      }
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to store credentials: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }

  // Upsert marketplace_connections row
  try {
    const [connection] = await db
      .insert(marketplaceConnections)
      .values({
        userId: workspaceUserId,
        marketplaceId,
        displayName: config.name,
        authType: config.authType,
        status: 'connected',
        vaultSecretNames,
      })
      .onConflictDoUpdate({
        target: [marketplaceConnections.userId, marketplaceConnections.marketplaceId],
        set: {
          displayName: config.name,
          authType: config.authType,
          status: 'connected',
          vaultSecretNames,
          updatedAt: new Date(),
        },
      })
      .returning({ id: marketplaceConnections.id })

    return NextResponse.json(
      { connectionId: connection.id, marketplaceId },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to save connection: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/marketplace/credentials?marketplaceId=xxx
 *
 * Remove marketplace credentials from Vault and delete the connection row.
 */
export async function DELETE(request: NextRequest) {
  // Verify auth
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const marketplaceId = request.nextUrl.searchParams.get('marketplaceId')
  if (!marketplaceId) {
    return NextResponse.json(
      { error: 'marketplaceId query parameter is required' },
      { status: 400 }
    )
  }

  // Find the connection
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, workspaceUserId),
        eq(marketplaceConnections.marketplaceId, marketplaceId)
      )
    )

  if (connections.length === 0) {
    return NextResponse.json(
      { error: 'Connection not found' },
      { status: 404 }
    )
  }

  const connection = connections[0]

  // Delete all vault secrets
  try {
    for (const secretName of connection.vaultSecretNames) {
      // Extract credential key from name pattern: mkt_{userId}_{marketplaceId}_{key}
      const parts = secretName.split('_')
      const credentialKey = parts.slice(3).join('_')
      await deleteCredential(marketplaceId, workspaceUserId, credentialKey)
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to delete credentials: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }

  // Delete the connection row
  await db
    .delete(marketplaceConnections)
    .where(eq(marketplaceConnections.id, connection.id))

  return NextResponse.json({ success: true }, { status: 200 })
}

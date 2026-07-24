import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'

export async function getDetailPageWorkspaceUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { user, workspaceUserId: await getWorkspaceUserId(user.id) }
}

export function readBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  const [scheme, token] = authorization.split(' ', 2)
  return scheme.toLowerCase() === 'bearer' && token ? token.trim() : null
}

export function bridgeHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  }
}

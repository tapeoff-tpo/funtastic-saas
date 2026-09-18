import { createHmac } from 'node:crypto'

export const RESET_PASSWORD = '0000'

const TEMPORARY_RESET_PASSWORD_PREFIX = '0000-TempA1!'

/**
 * Derives an account-specific, policy-compliant password for Supabase. The
 * service-role secret stays server-side; staff only enter `0000` in the SaaS
 * login form while the forced-password-change flag is active.
 */
export function getTemporaryResetAuthPassword(
  userId: string,
  secret = process.env.SUPABASE_SERVICE_ROLE_KEY,
): string {
  if (!userId) throw new Error('Missing auth user ID for temporary password reset')
  if (!secret) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for temporary password reset')
  }

  const accountSuffix = createHmac('sha256', secret).update(userId).digest('base64url')
  return `${TEMPORARY_RESET_PASSWORD_PREFIX}${accountSuffix}`
}

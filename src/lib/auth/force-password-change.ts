const FORCE_PASSWORD_CHANGE_KEY = 'must_change_password'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the server-controlled flag stored in Supabase app metadata. */
export function isPasswordChangeRequired(appMetadata: unknown): boolean {
  return isRecord(appMetadata) && appMetadata[FORCE_PASSWORD_CHANGE_KEY] === true
}

/** Preserves existing app metadata while updating the password-change flag. */
export function withPasswordChangeRequired(
  appMetadata: unknown,
  required: boolean,
): Record<string, unknown> {
  return {
    ...(isRecord(appMetadata) ? appMetadata : {}),
    [FORCE_PASSWORD_CHANGE_KEY]: required,
  }
}

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { canonicalize1688OfferUrl } from './purchase-url-values'

export type PurchaseUrlVerificationStatus = 'open' | 'unavailable' | 'unknown'
export type PurchaseUrlVerificationHistory = {
  url: string
  status: PurchaseUrlVerificationStatus
  checkedAt: string
}

const READ_BATCH_SIZE = 500
let ensureHistoryPromise: Promise<void> | null = null

export function ensurePurchaseUrlVerificationHistory(): Promise<void> {
  ensureHistoryPromise ??= db.transaction(async tx => {
    // Serialize first deployment across serverless instances as well as local
    // requests. CREATE IF NOT EXISTS alone can still race on catalog objects.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('purchasing-url-verification-history-v1'))`)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS purchasing_url_verification_history (
        user_id uuid NOT NULL,
        url text NOT NULL,
        status text NOT NULL CHECK (status IN ('open', 'unavailable', 'unknown')),
        checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        reason text,
        PRIMARY KEY (user_id, url)
      )
    `)
    // This ledger is accessed through workspace-scoped server services only.
    // Do not expose it through anonymous/authenticated Data API policies.
    await tx.execute(sql`ALTER TABLE purchasing_url_verification_history ENABLE ROW LEVEL SECURITY`)
  }).catch(error => {
    ensureHistoryPromise = null
    throw error
  })
  return ensureHistoryPromise
}

export async function getPurchaseUrlVerificationHistory(userId: string, values: string[]): Promise<PurchaseUrlVerificationHistory[]> {
  const urls = [...new Set(values.flatMap(value => {
    const url = canonicalize1688OfferUrl(value)
    return url ? [url] : []
  }))].sort()
  if (!urls.length) return []
  await ensurePurchaseUrlVerificationHistory()

  const history: PurchaseUrlVerificationHistory[] = []
  for (let offset = 0; offset < urls.length; offset += READ_BATCH_SIZE) {
    const batch = urls.slice(offset, offset + READ_BATCH_SIZE)
    const rows = await db.execute<PurchaseUrlVerificationHistory>(sql`
      SELECT url, status, checked_at::text AS "checkedAt"
      FROM purchasing_url_verification_history
      WHERE user_id = ${userId}::uuid AND url IN (${sql.join(batch.map(url => sql`${url}`), sql`, `)})
      ORDER BY url
    `)
    for (const row of rows) history.push({ ...row, checkedAt: new Date(row.checkedAt).toISOString() })
  }
  return history
}

export async function savePurchaseUrlVerificationHistory(input: {
  userId: string
  url: string
  status: PurchaseUrlVerificationStatus
  reason?: string | null
}): Promise<void> {
  const url = canonicalize1688OfferUrl(input.url)
  if (!url) throw new Error('검증한 1688 상품 주소를 확인해주세요.')
  if (!['open', 'unavailable', 'unknown'].includes(input.status)) throw new Error('URL 검증 상태를 확인해주세요.')
  await ensurePurchaseUrlVerificationHistory()
  const reason = input.reason?.trim().slice(0, 1_000) || null

  // Each accepted result replaces the last server-observed result for this
  // workspace and URL. No browser timestamp can extend the freshness window.
  await db.execute(sql`
    INSERT INTO purchasing_url_verification_history (user_id, url, status, checked_at, reason)
    VALUES (${input.userId}::uuid, ${url}, ${input.status}, clock_timestamp(), ${reason})
    ON CONFLICT (user_id, url) DO UPDATE SET
      status = EXCLUDED.status,
      checked_at = clock_timestamp(),
      reason = EXCLUDED.reason
  `)
}

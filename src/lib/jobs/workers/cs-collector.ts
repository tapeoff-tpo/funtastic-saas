import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { jobLogs, marketplaceConnections } from '@/lib/db/schema'
import { readCredential } from '@/lib/supabase/admin'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { MarketplaceApiError } from '@/lib/marketplace/errors'
import { upsertInquiries } from '@/lib/orders/inquiry-queries'
import { createAdapter, upsertClaim } from './order-collector'

export async function collectCsForConnection(params: {
  marketplaceId: string
  connectionId: string
  userId: string
  jobLogId: string
  lookbackDays?: number
  scope?: 'all' | 'claims' | 'inquiries'
}): Promise<void> {
  const {
    marketplaceId,
    connectionId,
    userId,
    jobLogId,
    lookbackDays = 7,
    scope = 'all',
  } = params

  const setProgress = async (message: string) => {
    await db.update(jobLogs).set({ progressMessage: message }).where(eq(jobLogs.id, jobLogId)).catch(() => {})
  }

  await db
    .insert(jobLogs)
    .values({ id: jobLogId, jobType: 'cs-collection', marketplaceId, connectionId, status: 'running', startedAt: new Date() })
    .onConflictDoUpdate({
      target: [jobLogs.id],
      set: { status: 'running', startedAt: new Date() },
    })

  let claimsCollected = 0
  let inquiriesCollected = 0

  try {
    await setProgress('CS 인증 정보 확인 중...')
    const [connection] = await db
      .select({ storeAlias: marketplaceConnections.storeAlias })
      .from(marketplaceConnections)
      .where(eq(marketplaceConnections.id, connectionId))
      .limit(1)

    const storeAlias = connection?.storeAlias ?? 'default'
    const aliasTag = storeAlias === 'default' ? '' : `_${storeAlias}`
    const adapterConfig = marketplaceRegistry.get(marketplaceId)
    const requiredCreds = adapterConfig.config.requiredCredentials
    const credentials: Record<string, string> = {}

    for (const credKey of requiredCreds) {
      const value = await readCredential(marketplaceId, userId, `${credKey}${aliasTag}`)
      if (!value) {
        throw new Error(`Missing credential "${credKey}" for ${marketplaceId}`)
      }
      credentials[credKey] = value
    }

    if (marketplaceId === 'playauto-emp' || marketplaceId === 'hyundai-hmall') {
      const optionalKeys = marketplaceId === 'playauto-emp'
        ? []
        : ['ven2_cd', 'dlv_form_gbcd', 'base_url', 'rgst_ip']
      for (const credKey of optionalKeys) {
        const value = await readCredential(marketplaceId, userId, `${credKey}${aliasTag}`)
        if (value) credentials[credKey] = value
      }
    }

    const adapter = createAdapter(marketplaceId, credentials)
    const since = new Date(Date.now() - Math.min(Math.max(Math.floor(lookbackDays), 1), 14) * 24 * 60 * 60 * 1000)

    if (scope !== 'inquiries') {
      await setProgress('취소/반품/교환 조회 중...')
      try {
        const claims = await adapter.getClaimsOrders(since)
        for (const claim of claims) {
          if (await upsertClaim(claim, userId)) claimsCollected++
        }
      } catch (error) {
        if (!(error instanceof MarketplaceApiError && error.statusCode === 501)) throw error
      }
    }

    if (scope !== 'claims' && adapter.getInquiries) {
      await setProgress('미답변 문의 조회 중...')
      const inquiries = await adapter.getInquiries(since)
      const result = await upsertInquiries(userId, marketplaceId, inquiries)
      inquiriesCollected = result.inserted + result.updated
    }

    const totalCollected = claimsCollected + inquiriesCollected
    const summary = `${scope === 'inquiries' ? '문의' : 'CS'} ${totalCollected}건 수집/갱신`
    await db
      .update(jobLogs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        claimsCollected: totalCollected,
        progressMessage: summary,
      })
      .where(eq(jobLogs.id, jobLogId))
  } catch (error) {
    await db
      .update(jobLogs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'CS 수집 실패',
      })
      .where(eq(jobLogs.id, jobLogId))
  }
}

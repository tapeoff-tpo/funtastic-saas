import type { Metadata } from 'next'
import { Purchase1688TrackingProgressWindow } from '../purchase-request-actions'

export const metadata: Metadata = {
  title: '1688 송장 일괄조회',
}

export default async function Purchase1688TrackingRunPage({
  searchParams,
}: {
  searchParams: Promise<{ runId?: string | string[] }>
}) {
  const params = await searchParams
  const runId = typeof params.runId === 'string' ? params.runId : null

  return <Purchase1688TrackingProgressWindow runId={runId} />
}

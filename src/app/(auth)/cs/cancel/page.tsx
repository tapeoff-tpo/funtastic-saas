import type { Metadata } from 'next'
import { CsClaimPage } from '@/components/cs/cs-claim-page'

export const metadata: Metadata = {
  title: '취소 관리',
}

export default async function CsCancelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = params.page ? Number(params.page) : 1
  return <CsClaimPage claimType="cancel" page={page} />
}

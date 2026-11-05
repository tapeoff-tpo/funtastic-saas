import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgePercent } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getClearanceCandidates, getClearanceDecisions, getClearanceSettings } from '@/lib/analytics/clearance'
import { ClearanceWorkbench } from './clearance-workbench'

export const metadata: Metadata = { title: '재고정리 운영' }

export default async function ClearancePage() {
  const user = await getCurrentUser(); if (!user) return null
  const userId = await getWorkspaceUserId(user.id)
  const settings = await getClearanceSettings(userId)
  const [candidates, decisions] = await Promise.all([getClearanceCandidates(userId, settings), getClearanceDecisions(userId)])
  return <div className="space-y-5"><header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2"><BadgePercent className="size-5 text-primary" /><h1 className="text-2xl font-bold">재고정리 운영</h1></div><p className="mt-1 text-sm text-muted-foreground">입고 경과·판매 소진·재고·마진을 함께 보고, 특가 후보와 실행가를 사람이 확정합니다.</p></div><nav className="flex flex-wrap gap-2"><Nav href="/analytics/overview">대시보드</Nav><Nav href="/analytics/channels">채널별</Nav><Nav href="/analytics/products">상품별</Nav><Nav active href="/analytics/clearance">재고정리</Nav></nav></header><ClearanceWorkbench settings={settings} candidates={candidates} decisions={decisions} /></div>
}
function Nav({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) { return <Link href={href} className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{children}</Link> }

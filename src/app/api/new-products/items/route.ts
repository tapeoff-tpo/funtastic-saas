import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  listNewProductSummaries,
  NEW_PRODUCT_SUMMARY_SORTS,
  type NewProductSummarySort,
  type NewProductSummarySortDirection,
} from '@/lib/new-products/workflow'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const url = new URL(request.url)
  const stageIds = [...new Set(url.searchParams.getAll('stageId'))].slice(0, 40)
  if (stageIds.some((stageId) => !isUuid(stageId))) {
    return NextResponse.json({ error: '진행 단계를 확인해주세요.' }, { status: 400 })
  }
  const page = positiveInteger(url.searchParams.get('page'), 1, 10_000)
  const pageSize = pageSizeFrom(url.searchParams.get('pageSize'))
  const result = await listNewProductSummaries({
    userId: workspaceUserId,
    stageIds,
    query: url.searchParams.get('query'),
    page,
    limit: pageSize,
    sortBy: summarySortFrom(url.searchParams.get('sortBy')),
    sortDirection: summarySortDirectionFrom(url.searchParams.get('sortDirection')),
  })
  return NextResponse.json({ ...result, page, pageSize }, { headers: { 'Cache-Control': 'private, no-store' } })
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

function pageSizeFrom(value: string | null) {
  const pageSize = positiveInteger(value, 50, 200)
  return [25, 50, 100, 200].includes(pageSize) ? pageSize : 50
}

function summarySortFrom(value: string | null): NewProductSummarySort {
  return value && NEW_PRODUCT_SUMMARY_SORTS.includes(value as NewProductSummarySort)
    ? value as NewProductSummarySort
    : 'updatedAt'
}

function summarySortDirectionFrom(value: string | null): NewProductSummarySortDirection {
  return value === 'asc' ? 'asc' : 'desc'
}

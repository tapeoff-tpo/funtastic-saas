import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/auth/server'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getLatestShortMeetingUpload, isMeetingDate } from '@/lib/analytics/short-meeting-uploads'
import { queryShortMeetingRawData, RAW_PAGE_SIZE, RawPageTooLargeError, type RawDirection, type RawSort } from '@/lib/analytics/short-meeting-raw-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return response({ error: '로그인이 필요합니다.' }, 401)
  try { await assertMenuAccess('/analytics/short-meeting') } catch {
    return response({ error: '숏미팅 메뉴 접근 권한이 없습니다.' }, 403)
  }

  let body: unknown
  try { body = await request.json() } catch { return response({ error: '올바른 조회 요청이 아닙니다.' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response({ error: '올바른 조회 요청이 아닙니다.' }, 400)
  const params = body as Record<string, unknown>
  const date = typeof params.date === 'string' ? params.date : ''
  const page = params.page ?? 1
  const directionText = params.direction ?? 'ascending'
  const sortValue = params.sort ?? null
  const search = params.search ?? ''
  if (!isMeetingDate(date)) return response({ error: '올바른 기준일을 선택해 주세요.' }, 400)
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 999999) return response({ error: '올바른 페이지를 선택해 주세요.' }, 400)
  if (directionText !== 'ascending' && directionText !== 'descending') return response({ error: '올바른 정렬 방향을 선택해 주세요.' }, 400)
  if (typeof search !== 'string' || search.length > 200) return response({ error: '검색어는 200자 이하여야 합니다.' }, 400)
  if (sortValue !== null && sortValue !== 'row' && (typeof sortValue !== 'number' || !Number.isInteger(sortValue) || sortValue < 0 || sortValue > 9999)) return response({ error: '올바른 정렬 열을 선택해 주세요.' }, 400)
  const sort = sortValue as RawSort

  try {
    const userId = await getWorkspaceUserId(user.id)
    const upload = await getLatestShortMeetingUpload(userId, date, { includeRaw: true })
    if (!upload?.rawData) return response({ rawAvailable: false, headers: [], rows: [], totalRows: 0,
      filteredRows: 0, page: 1, pageSize: RAW_PAGE_SIZE, totalPages: 1, appliedAt: upload?.appliedAt ?? null })
    if (typeof sort === 'number' && sort >= upload.rawData.headers.length) return response({ error: '올바른 정렬 열을 선택해 주세요.' }, 400)
    const result = queryShortMeetingRawData(upload.rawData, { search, sort, direction: directionText as RawDirection, page })
    return response({ ...result, appliedAt: upload.appliedAt })
  } catch (caught) {
    if (caught instanceof RawPageTooLargeError) return response({ error: caught.message }, 413)
    // DB exceptions may contain raw order rows in their SQL parameters.
    console.error('short meeting original query error:', caught instanceof Error ? caught.name : 'unknown error')
    return response({ error: '주문서 원본을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { findCostCandidates, getCatalogProduct, matchCatalogProducts, searchCatalog } from '@/lib/coupang-registration/catalog'
import { money } from '@/lib/coupang-registration/model'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const query = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 200)
    if (request.nextUrl.searchParams.get('cost') === '1') {
      const rows = await findCostCandidates(workspace, query)
      return NextResponse.json({ costs: rows.map((row) => ({ ...row, costPrice: money(row.costPrice) })) })
    }
    const code = (request.nextUrl.searchParams.get('code') ?? '').trim().slice(0, 100)
    if (code) return NextResponse.json({ product: await getCatalogProduct(workspace, code) })
    return NextResponse.json({ products: await searchCatalog(workspace, query) })
  } catch (error) {
    console.error('Coupang catalogue lookup failed', error)
    return NextResponse.json({ error: '상품을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const parsed = z.object({ names: z.array(z.string().min(1).max(500)).max(100), codes: z.array(z.string().max(100)).max(100) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '상품명 목록을 확인해주세요.' }, { status: 400 })
  try {
    return NextResponse.json({ products: await matchCatalogProducts(workspace, parsed.data.names, parsed.data.codes) })
  } catch (error) {
    console.error('Coupang catalogue matching failed', error)
    return NextResponse.json({ error: 'B2B 상품 매칭에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502 })
  }
}

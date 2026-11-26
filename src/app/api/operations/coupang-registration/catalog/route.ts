import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { findCostCandidates, getCatalogProduct, matchCatalogProducts, searchCatalog } from '@/lib/coupang-registration/catalog'
import { money, resolveItemCost } from '@/lib/coupang-registration/model'
import { findRegistrationProductMasters } from '@/lib/coupang-registration/product-master'

const catalogRows = z.array(z.object({
  id: z.string().min(1).max(100),
  sourceCode: z.string().min(1).max(100),
  name: z.string().max(500),
  sourceName: z.string().max(500),
  optionName: z.string().max(300),
  internalSku: z.string().max(100),
})).min(1).max(100)

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
    if (code) return NextResponse.json({ product: await getCatalogProduct(workspace, code, { includeProductMasters: request.nextUrl.searchParams.get('phase') !== 'pricing' }) })
    return NextResponse.json({ products: await searchCatalog(workspace, query) })
  } catch (error) {
    console.error('Coupang catalogue lookup failed', error)
    return NextResponse.json({ error: '상품을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const parsed = z.object({ names: z.array(z.string().min(1).max(500)).max(100), codes: z.array(z.string().max(100)).max(100), phase: z.enum(['pricing', 'information']).optional(), rows: catalogRows.optional() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '상품명 목록을 확인해주세요.' }, { status: 400 })
  const requestedRows = parsed.data.rows
  if (requestedRows && (parsed.data.phase === 'pricing' || new Set(requestedRows.map(row => row.id)).size !== requestedRows.length || requestedRows.some(row => !parsed.data.codes.includes(row.sourceCode)))) {
    return NextResponse.json({ error: '상품등록정보의 상품 행과 코드를 확인해주세요.' }, { status: 400 })
  }
  try {
    const products = await matchCatalogProducts(workspace, parsed.data.names, parsed.data.codes, { includeProductMasters: !requestedRows && parsed.data.phase !== 'pricing' })
    if (!requestedRows) return NextResponse.json({ products })

    // Each selected option can identify a different Product Management record.
    // A parent product's combined SKU candidates must not make that row ambiguous.
    const byCode = new Map(products.map(product => [product.code, product]))
    const masterRequests = requestedRows.flatMap(row => {
      const product = byCode.get(row.sourceCode)
      if (!product) return []
      const sku = row.internalSku.trim() || resolveItemCost({ name: row.name, sourceName: product.name, optionName: row.optionName, internalSku: '' }, product.costCandidates)?.sku
      return [{ id: row.id, name: product.name, skus: sku ? [sku] : [] }]
    })
    const productMasters = masterRequests.length ? Object.fromEntries(await findRegistrationProductMasters(workspace, masterRequests)) : {}
    return NextResponse.json({ products, productMasters })
  } catch (error) {
    console.error('Coupang catalogue matching failed', error)
    return NextResponse.json({ error: 'B2B 상품 매칭에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502 })
  }
}

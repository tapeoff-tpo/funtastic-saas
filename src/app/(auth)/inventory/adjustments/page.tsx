import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsString,
} from 'nuqs/server'
import { desc, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { inventory, inventoryAdjustmentSlips } from '@/lib/db/schema'
import { InventoryAdjustmentsTable, type AdjustmentSlipRow } from './table'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '입출고관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(25),
  movement: parseAsString.withDefault('all'),
  status: parseAsString.withDefault('all'),
  dateField: parseAsString.withDefault('movement'),
  dateFrom: parseAsString,
  dateTo: parseAsString,
  search: parseAsString,
  warehouseZone: parseAsString,
})

function parseKstDate(value: string, boundary: 'start' | 'end'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value)
  return new Date(`${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}+09:00`)
}

export default async function InventoryAdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const params = await searchParamsCache.parse(searchParams)

  const where = [
    sql`${inventoryAdjustmentSlips.userId} = ${workspaceUserId}`,
  ]
  if (params.movement === 'incoming') where.push(sql`${inventoryAdjustmentSlips.delta} > 0`)
  if (params.movement === 'outgoing') where.push(sql`${inventoryAdjustmentSlips.delta} < 0`)
  if (params.status === 'pending') where.push(sql`${inventoryAdjustmentSlips.status} = 'pending'`)
  if (params.status === 'confirmed') where.push(sql`${inventoryAdjustmentSlips.status} = 'confirmed'`)
  if (params.warehouseZone) where.push(sql`${inventoryAdjustmentSlips.warehouseZone} = ${params.warehouseZone}`)
  if (params.search) {
    const pattern = `%${params.search.trim()}%`
    where.push(sql`(
      ${inventoryAdjustmentSlips.sku} ILIKE ${pattern}
      OR ${inventoryAdjustmentSlips.productName} ILIKE ${pattern}
      OR COALESCE(${inventoryAdjustmentSlips.optionName}, '') ILIKE ${pattern}
    )`)
  }

  const dateColumn = params.dateField === 'confirmed'
    ? inventoryAdjustmentSlips.confirmedAt
    : inventoryAdjustmentSlips.createdAt
  if (params.dateField === 'incoming') where.push(sql`${inventoryAdjustmentSlips.delta} > 0`)
  if (params.dateField === 'outgoing') where.push(sql`${inventoryAdjustmentSlips.delta} < 0`)
  if (params.dateFrom) where.push(sql`${dateColumn} >= ${parseKstDate(params.dateFrom, 'start')}`)
  if (params.dateTo) where.push(sql`${dateColumn} <= ${parseKstDate(params.dateTo, 'end')}`)

  const whereClause = where.length > 0 ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``
  const page = Math.max(1, params.page)
  const pageSize = Math.max(10, params.pageSize)
  const offset = (page - 1) * pageSize

  const [rows, countRows, warehouseZoneRows] = await Promise.all([
    db.execute(sql`
      SELECT
        id::text,
        sku,
        product_name AS "productName",
        option_name AS "optionName",
        warehouse_zone AS "warehouseZone",
        delta,
        status,
        created_at AS "createdAt",
        confirmed_at AS "confirmedAt",
        registered_by_name AS "registeredByName"
      FROM ${inventoryAdjustmentSlips}
      ${whereClause}
      ORDER BY ${inventoryAdjustmentSlips.createdAt} DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM ${inventoryAdjustmentSlips}
      ${whereClause}
    `),
    db
      .selectDistinct({ warehouseZone: inventory.warehouseZone })
      .from(inventory)
      .orderBy(desc(inventory.warehouseZone)),
  ])

  const data = rows as unknown as AdjustmentSlipRow[]
  const total = Number((countRows[0] as { count?: number } | undefined)?.count ?? 0)
  const warehouseZones = warehouseZoneRows
    .map((row) => row.warehouseZone)
    .filter((zone): zone is string => !!zone)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">입출고관리</h1>
        <span className="text-sm text-muted-foreground">
          {total.toLocaleString('ko-KR')}건
        </span>
      </div>
      <InventoryAdjustmentsTable
        data={data}
        total={total}
        page={page}
        pageSize={pageSize}
        warehouseZones={warehouseZones}
      />
    </div>
  )
}

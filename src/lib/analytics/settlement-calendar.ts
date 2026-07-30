import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type SettlementRow = {
  date: string
  marketplaceId: string
  marketplaceName: string
  orderCount: number
  grossSales: number
  commissionRate: number
  commissionAmount: number
  expectedAmount: number
  actualAmount: number | null
  memo: string | null
  payoutDelayDays: number
}

export async function ensureSettlementCalendarTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS marketplace_settlement_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      marketplace_id varchar(50) NOT NULL, payout_delay_days integer NOT NULL DEFAULT 14,
      commission_rate numeric(7,4), created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, marketplace_id)
    )
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS marketplace_settlement_confirmations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      marketplace_id varchar(50) NOT NULL, settlement_date date NOT NULL,
      actual_amount numeric(14,2) NOT NULL, memo text, confirmed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, marketplace_id, settlement_date)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS marketplace_settlement_confirmations_user_date_idx ON marketplace_settlement_confirmations(user_id, settlement_date)`)
}

function monthBounds(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('월 형식을 확인해주세요.')
  const [year, value] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, value - 1, 1))
  const end = new Date(Date.UTC(year, value, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export async function getSettlementCalendar(userId: string, month: string): Promise<SettlementRow[]> {
  await ensureSettlementCalendarTables()
  const { start, end } = monthBounds(month)
  const rows = await db.execute<SettlementRow>(sql`
    WITH connection_fees AS (
      SELECT user_id, marketplace_id,
        CASE WHEN COUNT(*) FILTER (WHERE NULLIF(metadata->>'salesFeePercent', '') IS NULL) = 0
          AND COUNT(DISTINCT NULLIF(metadata->>'salesFeePercent', '')::numeric) = 1
          THEN MAX(NULLIF(metadata->>'salesFeePercent', '')::numeric) END AS fee_rate,
        CASE WHEN COUNT(*) = 1 THEN MAX(display_name) END AS display_name
      FROM marketplace_connections WHERE user_id = ${userId} GROUP BY user_id, marketplace_id
    ), source AS (
      SELECT o.marketplace_id,
        (o.ordered_at::date + COALESCE(r.payout_delay_days, 14)) AS settlement_date,
        COUNT(*)::int AS order_count, COALESCE(SUM(o.total_amount::numeric), 0) AS gross_sales,
        COALESCE(r.commission_rate, cf.fee_rate, 0) AS commission_rate,
        COALESCE(NULLIF(MAX(mc.display_name), ''), cf.display_name, o.marketplace_id) AS marketplace_name,
        COALESCE(r.payout_delay_days, 14) AS payout_delay_days
      FROM orders o
      LEFT JOIN marketplace_settlement_rules r ON r.user_id = o.user_id AND r.marketplace_id = o.marketplace_id
      LEFT JOIN marketplace_connections mc ON mc.id = o.connection_id
      LEFT JOIN connection_fees cf ON cf.user_id = o.user_id AND cf.marketplace_id = o.marketplace_id
      WHERE o.user_id = ${userId} AND o.status::text IN ('shipped', 'delivering', 'delivered', 'ready')
      GROUP BY o.marketplace_id, (o.ordered_at::date + COALESCE(r.payout_delay_days, 14)), r.commission_rate, cf.fee_rate, cf.display_name, r.payout_delay_days
    )
    SELECT s.settlement_date::text AS date, s.marketplace_id AS "marketplaceId", s.marketplace_name AS "marketplaceName",
      s.order_count AS "orderCount", s.gross_sales::float8 AS "grossSales", s.commission_rate::float8 AS "commissionRate",
      ROUND(s.gross_sales * s.commission_rate / 100)::float8 AS "commissionAmount",
      (s.gross_sales - ROUND(s.gross_sales * s.commission_rate / 100))::float8 AS "expectedAmount",
      c.actual_amount::float8 AS "actualAmount", c.memo, s.payout_delay_days AS "payoutDelayDays"
    FROM source s LEFT JOIN marketplace_settlement_confirmations c
      ON c.user_id = ${userId} AND c.marketplace_id = s.marketplace_id AND c.settlement_date = s.settlement_date
    WHERE s.settlement_date >= ${start}::date AND s.settlement_date < ${end}::date
    ORDER BY s.settlement_date, s.marketplace_name
  `)
  return rows
}

export async function saveSettlementRule(userId: string, input: { marketplaceId: string; payoutDelayDays: number; commissionRate: number | null }) {
  await ensureSettlementCalendarTables()
  await db.execute(sql`
    INSERT INTO marketplace_settlement_rules (user_id, marketplace_id, payout_delay_days, commission_rate)
    VALUES (${userId}, ${input.marketplaceId}, ${input.payoutDelayDays}, ${input.commissionRate})
    ON CONFLICT (user_id, marketplace_id) DO UPDATE SET payout_delay_days = EXCLUDED.payout_delay_days,
      commission_rate = EXCLUDED.commission_rate, updated_at = now()
  `)
}

export async function saveSettlementConfirmation(userId: string, input: { marketplaceId: string; date: string; actualAmount: number; memo?: string | null }) {
  await ensureSettlementCalendarTables()
  await db.execute(sql`
    INSERT INTO marketplace_settlement_confirmations (user_id, marketplace_id, settlement_date, actual_amount, memo)
    VALUES (${userId}, ${input.marketplaceId}, ${input.date}::date, ${input.actualAmount}, ${input.memo ?? null})
    ON CONFLICT (user_id, marketplace_id, settlement_date) DO UPDATE SET actual_amount = EXCLUDED.actual_amount,
      memo = EXCLUDED.memo, confirmed_at = now(), updated_at = now()
  `)
}

import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { chinaPurchaseFundTransactions } from '@/lib/db/schema'

const OUTGOING_TYPES = new Set(['purchase_out', 'adjustment_out'])

export type ChinaPurchaseFundType = 'transfer_in' | 'purchase_out' | 'adjustment_in' | 'adjustment_out'

export async function getChinaPurchaseFundSummary(userId: string) {
  const [balance, transactions] = await Promise.all([
    db
      .select({
        balanceCny: sql<string>`COALESCE(SUM(CASE WHEN ${chinaPurchaseFundTransactions.type} IN ('purchase_out', 'adjustment_out') THEN -${chinaPurchaseFundTransactions.amountCny} ELSE ${chinaPurchaseFundTransactions.amountCny} END), 0)`,
      })
      .from(chinaPurchaseFundTransactions)
      .where(eq(chinaPurchaseFundTransactions.userId, userId)),
    db
      .select()
      .from(chinaPurchaseFundTransactions)
      .where(eq(chinaPurchaseFundTransactions.userId, userId))
      .orderBy(desc(chinaPurchaseFundTransactions.transactionDate), desc(chinaPurchaseFundTransactions.createdAt))
      .limit(8),
  ])

  return {
    balanceCny: Number(balance?.balanceCny ?? 0),
    transactions: transactions.map((item) => ({
      ...item,
      amountCny: Number(item.amountCny),
      amountKrw: item.amountKrw == null ? null : Number(item.amountKrw),
      exchangeRate: item.exchangeRate == null ? null : Number(item.exchangeRate),
    })),
  }
}

export async function addChinaPurchaseFundTransaction(input: {
  userId: string
  createdByUserId: string
  transactionDate: string
  type: ChinaPurchaseFundType
  amountCny: number
  amountKrw?: number | null
  memo?: string | null
}) {
  const amountCny = Math.round(input.amountCny * 100) / 100
  const amountKrw = input.amountKrw == null ? null : Math.round(input.amountKrw)
  const exchangeRate = amountKrw && amountCny > 0 ? amountKrw / amountCny : null
  const [transaction] = await db
    .insert(chinaPurchaseFundTransactions)
    .values({
      userId: input.userId,
      createdByUserId: input.createdByUserId,
      transactionDate: input.transactionDate,
      type: input.type,
      amountCny: String(amountCny),
      amountKrw: amountKrw == null ? null : String(amountKrw),
      exchangeRate: exchangeRate == null ? null : String(exchangeRate),
      memo: input.memo?.trim() || null,
    })
    .returning({ id: chinaPurchaseFundTransactions.id })
  return transaction
}

export function isChinaPurchaseFundOutgoing(type: ChinaPurchaseFundType) {
  return OUTGOING_TYPES.has(type)
}

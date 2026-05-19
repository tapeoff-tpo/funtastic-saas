import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orderChangeLogs } from '@/lib/db/schema'

export interface OrderChangeLogInput {
  orderId: string
  userId: string
  actorId?: string | null
  action: string
  title: string
  description?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

type LoggerDb = Pick<typeof db, 'insert'>

export async function logOrderChange(input: OrderChangeLogInput, tx: LoggerDb = db): Promise<void> {
  await tx.insert(orderChangeLogs).values({
    orderId: input.orderId,
    userId: input.userId,
    actorId: input.actorId ?? null,
    action: input.action,
    title: input.title,
    description: input.description ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? null,
  })
}

export async function logOrderChanges(inputs: OrderChangeLogInput[], tx: LoggerDb = db): Promise<void> {
  if (inputs.length === 0) return
  await tx.insert(orderChangeLogs).values(inputs.map((input) => ({
    orderId: input.orderId,
    userId: input.userId,
    actorId: input.actorId ?? null,
    action: input.action,
    title: input.title,
    description: input.description ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? null,
  })))
}

export async function getOrderChangeLogs(orderId: string) {
  return db
    .select()
    .from(orderChangeLogs)
    .where(eq(orderChangeLogs.orderId, orderId))
    .orderBy(desc(orderChangeLogs.createdAt))
}

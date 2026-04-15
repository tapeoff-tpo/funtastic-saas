import { db } from '@/lib/db'
import { productChangeLogs } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

interface ChangeLogEntry {
  productId: string
  userId: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
}

export async function logProductChanges(entries: ChangeLogEntry[]) {
  if (entries.length === 0) return
  await db.insert(productChangeLogs).values(entries)
}

export async function getProductChangeLogs(productId: string) {
  return db
    .select()
    .from(productChangeLogs)
    .where(eq(productChangeLogs.productId, productId))
    .orderBy(desc(productChangeLogs.createdAt))
    .limit(100)
}

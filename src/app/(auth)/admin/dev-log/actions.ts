'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { devLogEntries, DEV_LOG_AUTHORS, type DevLogAuthor } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'

export async function listDevLogEntries() {
  return db
    .select()
    .from(devLogEntries)
    .orderBy(desc(devLogEntries.logDate), desc(devLogEntries.createdAt))
}

export async function createDevLogEntry(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const author = String(formData.get('author') ?? '') as DevLogAuthor
  const logDate = String(formData.get('logDate') ?? '')
  const content = String(formData.get('content') ?? '').trim()

  if (!DEV_LOG_AUTHORS.includes(author)) {
    return { error: '작성자를 선택하세요.' }
  }
  if (!logDate || !/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    return { error: '날짜를 올바르게 입력하세요.' }
  }
  if (!content) {
    return { error: '내용을 입력하세요.' }
  }

  await db.insert(devLogEntries).values({ author, logDate, content })
  revalidatePath('/admin/dev-log')
  return { success: true }
}

export async function deleteDevLogEntry(id: string) {
  if (!id) return
  await db.delete(devLogEntries).where(eq(devLogEntries.id, id))
  revalidatePath('/admin/dev-log')
}

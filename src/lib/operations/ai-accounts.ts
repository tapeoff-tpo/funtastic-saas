import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { gptAccountMessages, gptAccounts, gptAccountUsers } from '@/lib/db/schema'
import { deleteCredential, readCredential, storeCredential } from '@/lib/supabase/admin'

const aiAccountCredentialScope = (accountId: string) => `ai-account-${accountId}`

export const DEFAULT_AI_ACCOUNTS = [
  { name: '한상철', email: 'tapeoff@naver.com' },
  { name: '김기환', email: 'belload89@naver.com' },
  { name: '최종석', email: '010-9156-9321' },
  { name: '김소희', email: '010-7367-5527' },
  { name: '오지은', email: '010-7233-3187' },
  { name: '박현빈', email: '010-9423-3999' },
] as const

export const AI_ACCOUNT_STATUS_LABELS: Record<string, string> = {
  available: '비어 있음',
  in_use: '사용 중',
  limit_warning: '한도 임박',
  limit_reached: '한도 초과',
  five_hour_limit_reached: '사용 가능',
  weekly_limit_reached: '주간 소진',
  needs_check: '확인 필요',
}

const AI_ACCOUNT_STATUSES = new Set(Object.keys(AI_ACCOUNT_STATUS_LABELS))

const DEFAULT_USER_CANDIDATES = ['한상철', '김기환', '최종석', '김소희', '오지은', '박현빈']

export async function ensureAiAccountTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gpt_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "name" varchar(100) NOT NULL,
      "email" varchar(255),
      "secondary_email" varchar(255),
      "status" varchar(30) NOT NULL DEFAULT 'available',
      "current_user_name" varchar(100),
      "daily_reset_time" varchar(10),
      "weekly_reset_at" timestamp with time zone,
      "five_hour_limit" varchar(100),
      "five_hour_limit_period" varchar(10),
      "weekly_limit" varchar(100),
      "notes" text,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "secondary_email" varchar(255)`)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "five_hour_limit" varchar(100)`)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "five_hour_limit_period" varchar(10)`)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "weekly_limit" varchar(100)`)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "renewal_due_on" date`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "gpt_accounts_user_name_uniq" ON "gpt_accounts" ("user_id", "name")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_accounts_user_sort_idx" ON "gpt_accounts" ("user_id", "sort_order")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_accounts_user_status_idx" ON "gpt_accounts" ("user_id", "status")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gpt_account_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "account_id" uuid NOT NULL REFERENCES "gpt_accounts"("id") ON DELETE cascade,
      "author_name" varchar(100),
      "event_type" varchar(50) NOT NULL DEFAULT 'memo',
      "message" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_messages_account_created_idx" ON "gpt_account_messages" ("account_id", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_messages_user_created_idx" ON "gpt_account_messages" ("user_id", "created_at")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gpt_account_sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "account_id" uuid NOT NULL REFERENCES "gpt_accounts"("id") ON DELETE cascade,
      "user_name" varchar(100) NOT NULL,
      "started_at" timestamp with time zone DEFAULT now() NOT NULL,
      "ended_at" timestamp with time zone,
      "status" varchar(30) NOT NULL DEFAULT 'active'
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_sessions_account_started_idx" ON "gpt_account_sessions" ("account_id", "started_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_sessions_user_status_idx" ON "gpt_account_sessions" ("user_id", "status")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gpt_account_waitlist" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "account_id" uuid NOT NULL REFERENCES "gpt_accounts"("id") ON DELETE cascade,
      "user_name" varchar(100) NOT NULL,
      "status" varchar(30) NOT NULL DEFAULT 'waiting',
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "resolved_at" timestamp with time zone
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_waitlist_account_status_idx" ON "gpt_account_waitlist" ("account_id", "status", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_waitlist_user_status_idx" ON "gpt_account_waitlist" ("user_id", "status")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gpt_account_users" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "name" varchar(100) NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "gpt_account_users_user_name_uniq" ON "gpt_account_users" ("user_id", "name")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "gpt_account_users_user_sort_idx" ON "gpt_account_users" ("user_id", "sort_order")`)
}

export async function seedDefaultAiAccountUsers(userId: string) {
  await ensureAiAccountTables()
  const existingUsers = await db
    .select({ id: gptAccountUsers.id })
    .from(gptAccountUsers)
    .where(eq(gptAccountUsers.userId, userId))
    .limit(1)
  if (existingUsers.length) return

  const rows = DEFAULT_USER_CANDIDATES.map((name, index) => ({
    userId,
    name,
    sortOrder: index + 1,
  }))

  await db.insert(gptAccountUsers)
    .values(rows)
    .onConflictDoNothing({
      target: [gptAccountUsers.userId, gptAccountUsers.name],
    })
}

export async function seedDefaultAiAccounts(userId: string) {
  await ensureAiAccountTables()
  await seedDefaultAiAccountUsers(userId)
  const existingAccounts = await db
    .select({ id: gptAccounts.id })
    .from(gptAccounts)
    .where(eq(gptAccounts.userId, userId))
    .limit(1)

  if (!existingAccounts.length) {
    const rows = DEFAULT_AI_ACCOUNTS.map((account, index) => ({
      userId,
      name: account.name,
      email: account.email,
      sortOrder: index + 1,
      status: 'available',
    }))

    await db.insert(gptAccounts)
      .values(rows)
      .onConflictDoNothing({
        target: [gptAccounts.userId, gptAccounts.name],
      })
  }

  for (const account of DEFAULT_AI_ACCOUNTS) {
    await db.update(gptAccounts)
      .set({ email: account.email, updatedAt: new Date() })
      .where(sql`${gptAccounts.userId} = ${userId} AND ${gptAccounts.name} = ${account.name} AND (${gptAccounts.email} IS NULL OR ${gptAccounts.email} = '')`)
  }
}

export async function listAiAccounts(userId: string) {
  await seedDefaultAiAccounts(userId)
  return db.select().from(gptAccounts).where(eq(gptAccounts.userId, userId)).orderBy(asc(gptAccounts.sortOrder), asc(gptAccounts.createdAt))
}

export async function listAiAccountMessages(userId: string) {
  await ensureAiAccountTables()
  return db
    .select({
      id: gptAccountMessages.id,
      accountId: gptAccountMessages.accountId,
      authorName: gptAccountMessages.authorName,
      eventType: gptAccountMessages.eventType,
      message: gptAccountMessages.message,
      createdAt: gptAccountMessages.createdAt,
    })
    .from(gptAccountMessages)
    .where(eq(gptAccountMessages.userId, userId))
    .orderBy(desc(gptAccountMessages.createdAt))
    .limit(300)
}

export async function listRecentAiAccountMessages(userId: string) {
  const messages = await listAiAccountMessages(userId)
  return messages.slice(0, 12)
}

export async function listAiAccountUserCandidates(userId: string) {
  await seedDefaultAiAccountUsers(userId)
  return db
    .select({
      id: gptAccountUsers.id,
      name: gptAccountUsers.name,
    })
    .from(gptAccountUsers)
    .where(eq(gptAccountUsers.userId, userId))
    .orderBy(asc(gptAccountUsers.sortOrder), asc(gptAccountUsers.createdAt))
}

export async function addAiAccountUserCandidate(input: {
  userId: string
  name: string
}) {
  await seedDefaultAiAccountUsers(input.userId)
  const name = input.name.trim()
  if (!name) return { error: '사용자 이름을 입력해주세요.' as const }

  const [{ nextSortOrder }] = await db.select({
    nextSortOrder: sql<number>`COALESCE(MAX(${gptAccountUsers.sortOrder}), 0)::int + 1`,
  }).from(gptAccountUsers).where(eq(gptAccountUsers.userId, input.userId))

  const [row] = await db.insert(gptAccountUsers)
    .values({
      userId: input.userId,
      name,
      sortOrder: nextSortOrder,
    })
    .onConflictDoNothing({
      target: [gptAccountUsers.userId, gptAccountUsers.name],
    })
    .returning({ id: gptAccountUsers.id })

  if (!row) return { error: '이미 등록된 사용자입니다.' as const }
  return { id: row.id }
}

export async function deleteAiAccountUserCandidate(input: {
  userId: string
  id: string
}) {
  await ensureAiAccountTables()
  const [row] = await db.delete(gptAccountUsers)
    .where(and(eq(gptAccountUsers.userId, input.userId), eq(gptAccountUsers.id, input.id)))
    .returning({ id: gptAccountUsers.id })

  if (!row) return { error: '사용자를 찾을 수 없습니다.' as const }
  return { success: true }
}

export async function deleteAiAccountUserCandidates(input: {
  userId: string
  ids: string[]
}) {
  await ensureAiAccountTables()
  const ids = Array.from(new Set(input.ids.map((id) => id.trim()).filter(Boolean)))
  if (!ids.length) return { error: '삭제할 사용자를 선택해주세요.' as const }

  const rows = await db.delete(gptAccountUsers)
    .where(and(eq(gptAccountUsers.userId, input.userId), inArray(gptAccountUsers.id, ids)))
    .returning({ name: gptAccountUsers.name })

  const deletedNames = rows.map((row) => row.name)
  if (!deletedNames.length) return { error: '사용자를 찾을 수 없습니다.' as const }

  const accounts = await db
    .select({ id: gptAccounts.id, currentUserName: gptAccounts.currentUserName, status: gptAccounts.status })
    .from(gptAccounts)
    .where(eq(gptAccounts.userId, input.userId))

  for (const account of accounts) {
    const activeUsers = (account.currentUserName || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => !deletedNames.includes(name))
    const nextStatus = account.status === 'in_use' && !activeUsers.length ? 'available' : account.status
    await db.update(gptAccounts)
      .set({
        currentUserName: activeUsers.join(', ') || null,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, account.id)))
  }

  return { success: true }
}

export async function createAiAccount(input: {
  userId: string
  name: string
  email?: string | null
  secondaryEmail?: string | null
  password?: string | null
  notes?: string | null
  renewalDueOn?: string | null
}) {
  await seedDefaultAiAccounts(input.userId)
  const name = input.name.trim()
  const email = input.email?.trim() || null
  const secondaryEmail = input.secondaryEmail?.trim() || null
  const password = input.password?.trim() || null
  const notes = input.notes?.trim() || null
  const renewalDueOn = input.renewalDueOn?.trim() || null
  if (!name) return { error: '계정 이름을 입력해주세요.' as const }

  const [{ nextSortOrder }] = await db.select({
    nextSortOrder: sql<number>`COALESCE(MAX(${gptAccounts.sortOrder}), 0)::int + 1`,
  }).from(gptAccounts).where(eq(gptAccounts.userId, input.userId))

  const [row] = await db.insert(gptAccounts)
    .values({
      userId: input.userId,
      name,
      email,
      secondaryEmail,
      notes,
      renewalDueOn,
      sortOrder: nextSortOrder,
      status: 'available',
    })
    .onConflictDoNothing({
      target: [gptAccounts.userId, gptAccounts.name],
    })
    .returning({ id: gptAccounts.id })

  if (!row) return { error: '이미 같은 이름의 AI 계정이 있습니다.' as const }
  if (password) {
    try {
      await storeCredential(aiAccountCredentialScope(row.id), input.userId, 'password', password)
    } catch {
      await db.delete(gptAccounts)
        .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, row.id)))
      return { error: '비밀번호를 안전하게 저장하지 못했습니다. 다시 시도해주세요.' as const }
    }
  }
  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: row.id,
    eventType: 'created',
    message: `${name} 계정을 추가했습니다.`,
  })
  return { id: row.id }
}

export async function updateAiAccount(input: {
  userId: string
  accountId: string
  name: string
  email?: string | null
  secondaryEmail?: string | null
  password?: string | null
  notes?: string | null
  renewalDueOn?: string | null
}) {
  await ensureAiAccountTables()
  const name = input.name.trim()
  const email = input.email?.trim() || null
  const secondaryEmail = input.secondaryEmail?.trim() || null
  const password = input.password?.trim() || null
  const notes = input.notes?.trim() || null
  const renewalDueOn = input.renewalDueOn?.trim() || null
  if (!name) return { error: '계정 이름을 입력해주세요.' as const }

  const [duplicate] = await db
    .select({ id: gptAccounts.id })
    .from(gptAccounts)
    .where(sql`${gptAccounts.userId} = ${input.userId} AND ${gptAccounts.name} = ${name} AND ${gptAccounts.id} <> ${input.accountId}`)
    .limit(1)
  if (duplicate) return { error: '이미 같은 이름의 AI 계정이 있습니다.' as const }

  const [row] = await db.update(gptAccounts)
    .set({
      name,
      email,
      secondaryEmail,
      notes,
      renewalDueOn,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .returning({ id: gptAccounts.id })

  if (!row) return { error: '계정을 찾을 수 없습니다.' as const }
  if (password) {
    try {
      await storeCredential(aiAccountCredentialScope(input.accountId), input.userId, 'password', password)
    } catch {
      return { error: '비밀번호를 안전하게 저장하지 못했습니다. 다시 시도해주세요.' as const }
    }
  }
  return { success: true }
}

export async function readAiAccountPassword(input: {
  userId: string
  accountId: string
}) {
  await ensureAiAccountTables()
  const [account] = await db.select({ id: gptAccounts.id })
    .from(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .limit(1)
  if (!account) return { error: '계정을 찾을 수 없습니다.' as const }

  try {
    const password = await readCredential(aiAccountCredentialScope(input.accountId), input.userId, 'password')
    if (!password) return { error: '저장된 비밀번호가 없습니다.' as const }
    return { password }
  } catch {
    return { error: '비밀번호를 불러오지 못했습니다.' as const }
  }
}

export async function deleteAiAccount(input: {
  userId: string
  accountId: string
}) {
  await ensureAiAccountTables()
  const [row] = await db.delete(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .returning({ id: gptAccounts.id })

  if (!row) return { error: '계정을 찾을 수 없습니다.' as const }
  try {
    await deleteCredential(aiAccountCredentialScope(input.accountId), input.userId, 'password')
  } catch {
    // Accounts created before password storage do not have a Vault secret.
  }
  return { success: true }
}

export async function updateAiAccountOperationalState(input: {
  userId: string
  accountId: string
  status: string
  currentUserName?: string | null
  renewalDueOn?: string | null
  changedField?: string | null
}) {
  await ensureAiAccountTables()
  const status = input.status.trim()
  const currentUserName = input.currentUserName?.trim() || null
  const renewalDueOn = input.renewalDueOn?.trim() || null
  if (!AI_ACCOUNT_STATUSES.has(status)) return { error: '올바른 계정 상태를 선택해주세요.' as const }
  if (renewalDueOn && !/^\d{4}-\d{2}-\d{2}$/.test(renewalDueOn)) {
    return { error: '올바른 갱신 예정일을 입력해주세요.' as const }
  }

  const [account] = await db
    .select({
      id: gptAccounts.id,
      status: gptAccounts.status,
      currentUserName: gptAccounts.currentUserName,
      renewalDueOn: gptAccounts.renewalDueOn,
    })
    .from(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .limit(1)
  if (!account) return { error: '계정을 찾을 수 없습니다.' as const }

  const changedField = input.changedField?.trim() || ''
  let nextStatus = status
  let nextCurrentUserName = currentUserName
  if (changedField === 'status' && status === 'available') nextCurrentUserName = null
  if (changedField === 'currentUserName') {
    if (currentUserName && status === 'available') nextStatus = 'in_use'
    if (!currentUserName && status === 'in_use') nextStatus = 'available'
  }
  if (
    account.status === nextStatus
    && account.currentUserName === nextCurrentUserName
    && account.renewalDueOn === renewalDueOn
  ) return { success: true }

  await db.update(gptAccounts)
    .set({
      status: nextStatus,
      currentUserName: nextCurrentUserName,
      renewalDueOn,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))

  const changes = [
    account.status !== nextStatus ? `상태: ${AI_ACCOUNT_STATUS_LABELS[nextStatus]}` : null,
    account.currentUserName !== nextCurrentUserName ? `사용자: ${nextCurrentUserName || '없음'}` : null,
    account.renewalDueOn !== renewalDueOn ? `갱신 예정일: ${renewalDueOn || '미지정'}` : null,
  ].filter(Boolean)
  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    eventType: 'account_state_updated',
    message: changes.join(' · '),
  })
  return { success: true }
}

export async function bulkUpdateAiAccountRenewal(input: {
  userId: string
  accountIds: string[]
  renewalDueOn: string
}) {
  await ensureAiAccountTables()
  const accountIds = Array.from(new Set(input.accountIds.map((id) => id.trim()).filter(Boolean)))
  const renewalDueOn = input.renewalDueOn.trim()
  if (!accountIds.length) return { error: '갱신일을 적용할 계정을 선택해주세요.' as const }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewalDueOn)) {
    return { error: '올바른 갱신 예정일을 입력해주세요.' as const }
  }

  const rows = await db.update(gptAccounts)
    .set({ renewalDueOn, updatedAt: new Date() })
    .where(and(eq(gptAccounts.userId, input.userId), inArray(gptAccounts.id, accountIds)))
    .returning({ id: gptAccounts.id })
  if (!rows.length) return { error: '선택한 계정을 찾을 수 없습니다.' as const }

  await db.insert(gptAccountMessages).values(rows.map((row) => ({
    userId: input.userId,
    accountId: row.id,
    eventType: 'renewal_bulk_updated',
    message: `갱신 예정일: ${renewalDueOn} (일괄 적용)`,
  })))
  return { success: true, count: rows.length }
}

export async function addAiAccountMessage(input: {
  userId: string
  accountId: string
  authorNames: string[]
  message: string
  messageType: string
}) {
  await ensureAiAccountTables()
  const authorNames = Array.from(new Set(input.authorNames.map((name) => name.trim()).filter(Boolean)))
  const authorName = authorNames.join(', ')
  const message = input.message.trim()
  const messageType = input.messageType.trim() || '직접입력'
  const fullMessage = messageType === '직접입력' ? message : message ? `[${messageType}] ${message}` : `[${messageType}]`
  if (!message) return { error: '내용을 입력해주세요.' as const }

  const [account] = await db
    .select({
      id: gptAccounts.id,
      currentUserName: gptAccounts.currentUserName,
      status: gptAccounts.status,
    })
    .from(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .limit(1)
  if (!account) return { error: '계정을 찾을 수 없습니다.' as const }

  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    authorName: authorName || null,
    eventType: 'chat',
    message: fullMessage,
  })
  for (const name of authorNames) {
    await db.insert(gptAccountUsers)
      .values({ userId: input.userId, name })
      .onConflictDoNothing({
        target: [gptAccountUsers.userId, gptAccountUsers.name],
      })
  }
  const activeUsers = Array.from(new Set((account.currentUserName || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)))
  const isWeeklyLimitEnd = messageType === '사용종료(주간소진)' || messageType === '사용종료(주간초과)'
  const shouldEndUsage = messageType === '사용종료' || isWeeklyLimitEnd
  const nextActiveUsers = messageType === '사용시작'
    ? authorNames.length
      ? Array.from(new Set([...activeUsers, ...authorNames]))
      : activeUsers
    : shouldEndUsage
      ? authorNames.length
        ? activeUsers.filter((name) => !authorNames.includes(name))
        : []
      : activeUsers
  let nextStatus = account.status
  if (messageType === '사용시작') {
    nextStatus = 'in_use'
  } else if (isWeeklyLimitEnd) {
    nextStatus = 'weekly_limit_reached'
  } else if (shouldEndUsage) {
    nextStatus = nextActiveUsers.length ? 'in_use' : 'available'
  }

  await db.update(gptAccounts)
    .set({
      currentUserName: nextActiveUsers.join(', ') || null,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))

  return { success: true }
}

export async function updateAiAccountLimits(input: {
  userId: string
  accountId: string
  weeklyRemainingPercent?: string | null
  weeklyResetAt?: Date | null
}) {
  await ensureAiAccountTables()
  const parsedPercent = Number(input.weeklyRemainingPercent)
  const weeklyLimit = input.weeklyRemainingPercent?.trim() && Number.isFinite(parsedPercent)
    ? `잔여 ${Math.min(100, Math.max(0, Math.round(parsedPercent)))}%`
    : null
  const [row] = await db.update(gptAccounts)
    .set({
      weeklyLimit,
      weeklyResetAt: input.weeklyResetAt || null,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .returning({ id: gptAccounts.id })

  if (!row) return { error: '계정을 찾을 수 없습니다.' as const }
  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    eventType: 'limit_updated',
    message: '주간 한도 설정을 수정했습니다.',
  })
  return { success: true }
}

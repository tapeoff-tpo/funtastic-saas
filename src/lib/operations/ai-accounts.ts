import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { gptAccountMessages, gptAccounts, gptAccountUsers } from '@/lib/db/schema'

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
  needs_check: '확인 필요',
}

const DEFAULT_USER_CANDIDATES = ['한상철', '김기환', '최종석', '김소희', '오지은', '박현빈']

export async function ensureAiAccountTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "gpt_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "name" varchar(100) NOT NULL,
      "email" varchar(255),
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
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "five_hour_limit" varchar(100)`)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "five_hour_limit_period" varchar(10)`)
  await db.execute(sql`ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "weekly_limit" varchar(100)`)
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
  const rows = DEFAULT_AI_ACCOUNTS.map((account, index) => ({
    userId,
    name: account.name,
    email: account.email,
    sortOrder: index + 1,
    status: 'available',
    fiveHourLimit: '5시간 한도',
    fiveHourLimitPeriod: 'PM',
    weeklyLimit: '1주일 한도',
  }))

  await db.insert(gptAccounts)
    .values(rows)
    .onConflictDoNothing({
      target: [gptAccounts.userId, gptAccounts.name],
    })

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

export async function createAiAccount(input: {
  userId: string
  name: string
  email?: string | null
}) {
  await seedDefaultAiAccounts(input.userId)
  const name = input.name.trim()
  const email = input.email?.trim() || null
  if (!name) return { error: '계정 이름을 입력해주세요.' as const }

  const [{ nextSortOrder }] = await db.select({
    nextSortOrder: sql<number>`COALESCE(MAX(${gptAccounts.sortOrder}), 0)::int + 1`,
  }).from(gptAccounts).where(eq(gptAccounts.userId, input.userId))

  const [row] = await db.insert(gptAccounts)
    .values({
      userId: input.userId,
      name,
      email,
      sortOrder: nextSortOrder,
      status: 'available',
      fiveHourLimit: '5시간 한도',
      fiveHourLimitPeriod: 'PM',
      weeklyLimit: '1주일 한도',
    })
    .onConflictDoNothing({
      target: [gptAccounts.userId, gptAccounts.name],
    })
    .returning({ id: gptAccounts.id })

  if (!row) return { error: '이미 같은 이름의 AI 계정이 있습니다.' as const }
  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: row.id,
    eventType: 'created',
    message: `${name} 계정을 추가했습니다.`,
  })
  return { id: row.id }
}

export async function addAiAccountMessage(input: {
  userId: string
  accountId: string
  authorName: string
  message: string
}) {
  await ensureAiAccountTables()
  const authorName = input.authorName.trim()
  const message = input.message.trim()
  if (!authorName) return { error: '사용자를 입력해주세요.' as const }
  if (!message) return { error: '내용을 입력해주세요.' as const }

  const [account] = await db
    .select({ id: gptAccounts.id })
    .from(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .limit(1)
  if (!account) return { error: '계정을 찾을 수 없습니다.' as const }

  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    authorName,
    eventType: 'chat',
    message,
  })
  await db.insert(gptAccountUsers)
    .values({ userId: input.userId, name: authorName })
    .onConflictDoNothing({
      target: [gptAccountUsers.userId, gptAccountUsers.name],
    })
  await db.update(gptAccounts)
    .set({
      currentUserName: authorName,
      status: 'in_use',
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))

  return { success: true }
}

export async function updateAiAccountLimits(input: {
  userId: string
  accountId: string
  fiveHourLimit?: string | null
  fiveHourLimitPeriod?: string | null
  weeklyLimit?: string | null
}) {
  await ensureAiAccountTables()
  const period = input.fiveHourLimitPeriod === 'AM' ? 'AM' : 'PM'
  const [row] = await db.update(gptAccounts)
    .set({
      fiveHourLimit: input.fiveHourLimit?.trim() || null,
      fiveHourLimitPeriod: period,
      weeklyLimit: input.weeklyLimit?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .returning({ id: gptAccounts.id })

  if (!row) return { error: '계정을 찾을 수 없습니다.' as const }
  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    eventType: 'limit_updated',
    message: '한도 설정을 수정했습니다.',
  })
  return { success: true }
}

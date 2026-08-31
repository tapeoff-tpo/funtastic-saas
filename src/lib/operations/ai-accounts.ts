import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { gptAccountMessages, gptAccounts, gptAccountUsers } from '@/lib/db/schema'
import { deleteCredential, readCredential, storeCredential } from '@/lib/supabase/admin'

const aiAccountCredentialScope = (accountId: string) => `ai-account-${accountId}`
const aiAccountLoginPasswordKey = 'login_password'

export const DEFAULT_AI_ACCOUNTS = [
  { name: '한상철', email: 'tapeoff@naver.com' },
  { name: '김기환', email: 'belload89@naver.com' },
  { name: '최종석', email: '010-9156-9321' },
  { name: '김소희', email: '010-7367-5527' },
  { name: '오지은', email: '010-7233-3187' },
  { name: '박현빈', email: '010-9423-3999' },
] as const

export const AI_ACCOUNT_STATUS_LABELS: Record<string, string> = {
  unselected: '선택 안 함',
  in_use: '사용 중',
  daily_limit_reached: '일 소진',
  weekly_limit_reached: '주간 소진',
}

const AI_ACCOUNT_STATUSES = new Set(Object.keys(AI_ACCOUNT_STATUS_LABELS))

const DEFAULT_USER_CANDIDATES = ['한상철', '김기환', '최종석', '김소희', '오지은', '박현빈']

function normalizeResetAvailableCount(value: number | undefined) {
  if (!Number.isFinite(value)) return 0
  return Math.min(3, Math.max(0, Math.round(value || 0)))
}

// The account schema is managed by the committed database migrations. Runtime
// DDL here made a normal page visit issue dozens of CREATE/ALTER statements.
export async function ensureAiAccountTables() {
  return undefined
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
      status: 'in_use',
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
    await db.update(gptAccounts)
      .set({
        currentUserName: activeUsers.join(', ') || null,
        status: account.status,
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
  loginMethod?: string | null
  loginId?: string | null
  loginPassword?: string | null
  secondaryEmail?: string | null
  password?: string | null
  notes?: string | null
  renewalDueOn?: string | null
  resetAvailableCount?: number
  sharedUse?: boolean
}) {
  await seedDefaultAiAccounts(input.userId)
  const name = input.name.trim()
  const email = input.email?.trim() || null
  const loginMethod = input.loginMethod?.trim() || null
  const loginId = input.loginId?.trim() || null
  const loginPassword = input.loginPassword?.trim() || null
  const secondaryEmail = input.secondaryEmail?.trim() || null
  const password = input.password?.trim() || null
  const notes = input.notes?.trim() || null
  const renewalDueOn = input.renewalDueOn?.trim() || null
  const resetAvailableCount = normalizeResetAvailableCount(input.resetAvailableCount)
  if (!name) return { error: '계정 이름을 입력해주세요.' as const }

  const [{ nextSortOrder }] = await db.select({
    nextSortOrder: sql<number>`COALESCE(MAX(${gptAccounts.sortOrder}), 0)::int + 1`,
  }).from(gptAccounts).where(eq(gptAccounts.userId, input.userId))

  const [row] = await db.insert(gptAccounts)
    .values({
      userId: input.userId,
      name,
      email,
      loginMethod,
      loginId,
      secondaryEmail,
      notes,
      renewalDueOn,
      resetAvailableCount,
      sharedUse: Boolean(input.sharedUse),
      sortOrder: nextSortOrder,
      status: 'in_use',
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
  if (loginPassword) {
    try {
      await storeCredential(aiAccountCredentialScope(row.id), input.userId, aiAccountLoginPasswordKey, loginPassword)
    } catch {
      await db.delete(gptAccounts)
        .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, row.id)))
      return { error: '로그인 비밀번호를 안전하게 저장하지 못했습니다. 다시 시도해주세요.' as const }
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
  resetAvailableCount?: number
  sharedUse?: boolean
}) {
  await ensureAiAccountTables()
  const name = input.name.trim()
  const email = input.email?.trim() || null
  const secondaryEmail = input.secondaryEmail?.trim() || null
  const password = input.password?.trim() || null
  const notes = input.notes?.trim() || null
  const renewalDueOn = input.renewalDueOn?.trim() || null
  const resetAvailableCount = normalizeResetAvailableCount(input.resetAvailableCount)
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
      resetAvailableCount,
      sharedUse: sql`${gptAccounts.sharedUse} OR ${Boolean(input.sharedUse)}`,
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

export async function readAiAccountLoginInfo(input: {
  userId: string
  accountId: string
}) {
  await ensureAiAccountTables()
  const [account] = await db.select({
    email: gptAccounts.email,
    loginMethod: gptAccounts.loginMethod,
    loginId: gptAccounts.loginId,
    secondaryEmail: gptAccounts.secondaryEmail,
  })
    .from(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .limit(1)
  if (!account) return { error: '계정을 찾을 수 없습니다.' as const }

  try {
    const [gptPassword, loginPassword] = await Promise.all([
      readCredential(aiAccountCredentialScope(input.accountId), input.userId, 'password'),
      readCredential(aiAccountCredentialScope(input.accountId), input.userId, aiAccountLoginPasswordKey),
    ])
    return {
      gptId: account.email || '',
      gptPassword: gptPassword || '',
      loginMethod: account.loginMethod || '',
      loginId: account.loginId || account.secondaryEmail || '',
      loginPassword: loginPassword || '',
    }
  } catch {
    return { error: '로그인 정보를 불러오지 못했습니다.' as const }
  }
}

export async function updateAiAccountLoginInfo(input: {
  userId: string
  accountId: string
  loginMethod?: string | null
  loginId?: string | null
  loginPassword?: string | null
  gptId?: string | null
  gptPassword?: string | null
}) {
  await ensureAiAccountTables()
  const loginMethod = input.loginMethod?.trim() || null
  const loginId = input.loginId?.trim() || null
  const gptId = input.gptId?.trim() || null
  const [row] = await db.update(gptAccounts)
    .set({
      loginMethod,
      loginId,
      email: gptId,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .returning({ id: gptAccounts.id })
  if (!row) return { error: '계정을 찾을 수 없습니다.' as const }

  try {
    if (input.loginPassword?.trim()) {
      await storeCredential(aiAccountCredentialScope(input.accountId), input.userId, aiAccountLoginPasswordKey, input.loginPassword.trim())
    }
    if (input.gptPassword?.trim()) {
      await storeCredential(aiAccountCredentialScope(input.accountId), input.userId, 'password', input.gptPassword.trim())
    }
  } catch {
    return { error: '비밀번호를 안전하게 저장하지 못했습니다. 다시 시도해주세요.' as const }
  }
  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    eventType: 'login_info_updated',
    message: '로그인 정보를 수정했습니다.',
  })
  return { success: true }
}

export async function updateAiAccountAvailability(input: {
  userId: string
  accountId: string
  resetAvailableCount: number
  sharedUse: boolean
  changedField: 'resetAvailableCount' | 'sharedUse'
}) {
  await ensureAiAccountTables()
  const resetAvailableCount = Math.round(input.resetAvailableCount)
  if (!Number.isInteger(resetAvailableCount) || resetAvailableCount < 0 || resetAvailableCount > 3) {
    return { error: '초기화 가능 수는 0부터 3까지 선택해주세요.' as const }
  }

  const [account] = await db.select({
    resetAvailableCount: gptAccounts.resetAvailableCount,
    sharedUse: gptAccounts.sharedUse,
  }).from(gptAccounts)
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .limit(1)
  if (!account) return { error: '계정을 찾을 수 없습니다.' as const }

  const nextResetCount = input.changedField === 'resetAvailableCount'
    ? resetAvailableCount
    : account.resetAvailableCount
  const nextSharedUse = input.changedField === 'sharedUse'
    ? account.sharedUse || input.sharedUse
    : account.sharedUse
  if (nextResetCount === account.resetAvailableCount && nextSharedUse === account.sharedUse) {
    return { success: true }
  }

  await db.update(gptAccounts).set({
    resetAvailableCount: nextResetCount,
    sharedUse: nextSharedUse,
    updatedAt: new Date(),
  }).where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))

  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    eventType: 'availability_updated',
    message: input.changedField === 'sharedUse'
      ? `공유 사용: ${nextSharedUse ? '사용 중' : '사용 안 함'}`
      : `초기화 가능: ${nextResetCount}개`,
  })
  return { success: true }
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
    await Promise.all([
      deleteCredential(aiAccountCredentialScope(input.accountId), input.userId, 'password'),
      deleteCredential(aiAccountCredentialScope(input.accountId), input.userId, aiAccountLoginPasswordKey),
    ])
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
  if (changedField === 'currentUserName' && status !== 'daily_limit_reached' && status !== 'weekly_limit_reached') {
    nextStatus = currentUserName ? 'in_use' : 'unselected'
  }
  if (changedField === 'status' && status === 'unselected') nextCurrentUserName = null
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
    .set({
      renewalDueOn,
      status: 'unselected',
      currentUserName: null,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), inArray(gptAccounts.id, accountIds)))
    .returning({ id: gptAccounts.id })
  if (!rows.length) return { error: '선택한 계정을 찾을 수 없습니다.' as const }

  await db.insert(gptAccountMessages).values(rows.map((row) => ({
    userId: input.userId,
    accountId: row.id,
    eventType: 'renewal_bulk_updated',
    message: `갱신 예정일: ${renewalDueOn} (일괄 적용) · 사용자/상태 초기화`,
  })))
  return { success: true, count: rows.length }
}

export async function bulkUpdateAiAccountOperationalState(input: {
  userId: string
  status: string
  currentUserName?: string | null
  changedField: 'status' | 'currentUserName'
}) {
  await ensureAiAccountTables()
  const status = input.status.trim()
  const currentUserName = input.currentUserName?.trim() || null
  if (!AI_ACCOUNT_STATUSES.has(status)) return { error: '올바른 계정 상태를 선택해주세요.' as const }

  const accounts = await db.select({
    id: gptAccounts.id,
    status: gptAccounts.status,
    currentUserName: gptAccounts.currentUserName,
  }).from(gptAccounts).where(eq(gptAccounts.userId, input.userId))
  if (!accounts.length) return { error: '변경할 계정이 없습니다.' as const }

  const nextStatus = input.changedField === 'currentUserName'
    ? currentUserName ? 'in_use' : 'unselected'
    : status
  const clearsUser = input.changedField === 'currentUserName' || nextStatus === 'unselected'

  await db.update(gptAccounts).set({
    status: nextStatus,
    ...(clearsUser ? { currentUserName } : {}),
    updatedAt: new Date(),
  }).where(eq(gptAccounts.userId, input.userId))

  await db.insert(gptAccountMessages).values(accounts.map((account) => {
    const nextUser = clearsUser ? currentUserName : account.currentUserName
    const changes = [
      account.status !== nextStatus ? `상태: ${AI_ACCOUNT_STATUS_LABELS[nextStatus]}` : null,
      account.currentUserName !== nextUser ? `사용자: ${nextUser || '없음'}` : null,
    ].filter(Boolean)
    return {
      userId: input.userId,
      accountId: account.id,
      eventType: 'account_state_bulk_updated',
      message: `${changes.join(' · ') || '변경 없음'} (일괄 적용)`,
    }
  }))
  return { success: true, count: accounts.length }
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
    nextStatus = 'in_use'
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
  dailyRemainingPercent?: string | null
  dailyResetTime?: string | null
  weeklyRemainingPercent?: string | null
  weeklyResetAt?: Date | null
}) {
  await ensureAiAccountTables()
  const parsedDailyPercent = Number(input.dailyRemainingPercent)
  const dailyLimit = input.dailyRemainingPercent?.trim() && Number.isFinite(parsedDailyPercent)
    ? `잔여 ${Math.min(100, Math.max(0, Math.round(parsedDailyPercent)))}%`
    : null
  const dailyResetTime = input.dailyResetTime?.trim() || null
  if (dailyResetTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyResetTime)) {
    return { error: '일 초기화 시각은 HH:MM 형식으로 입력해주세요.' as const }
  }
  const parsedPercent = Number(input.weeklyRemainingPercent)
  const weeklyLimit = input.weeklyRemainingPercent?.trim() && Number.isFinite(parsedPercent)
    ? `잔여 ${Math.min(100, Math.max(0, Math.round(parsedPercent)))}%`
    : null
  const [row] = await db.update(gptAccounts)
    .set({
      dailyLimit,
      dailyResetTime,
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
    message: '일/주 사용 한도와 초기화 시각을 수정했습니다.',
  })
  return { success: true }
}

export async function resetAiAccountRuntimeState(input: {
  userId: string
  accountId: string
}) {
  await ensureAiAccountTables()
  const [row] = await db.update(gptAccounts)
    .set({
      status: 'unselected',
      currentUserName: null,
      dailyLimit: null,
      dailyResetTime: null,
      weeklyLimit: null,
      weeklyResetAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(gptAccounts.userId, input.userId), eq(gptAccounts.id, input.accountId)))
    .returning({ id: gptAccounts.id })
  if (!row) return { error: '계정을 찾을 수 없습니다.' as const }

  await db.insert(gptAccountMessages).values({
    userId: input.userId,
    accountId: input.accountId,
    eventType: 'account_runtime_reset',
    message: '상태, 사용자, 일간/주간 초기화 시각을 초기화했습니다.',
  })
  return { success: true }
}

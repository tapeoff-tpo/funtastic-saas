import { and, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  gptAccounts,
  smsBridgeDevices,
  smsBridgeMessages,
  smsBridgePairings,
} from '@/lib/db/schema'
import {
  createSmsBridgeToken,
  extractVerificationCode,
  hashSmsBridgeToken,
  isPicklePlusMessage,
} from '@/lib/operations/sms-bridge-utils'

export const SMS_PAIRING_TTL_MINUTES = 10
export const SMS_CODE_TTL_MINUTES = 5

export async function ensureSmsBridgeTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sms_bridge_pairings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "account_id" uuid REFERENCES "gpt_accounts"("id") ON DELETE set null,
      "device_label" varchar(100),
      "token_hash" varchar(64) NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "claimed_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "sms_bridge_pairings_token_hash_uniq" ON "sms_bridge_pairings" ("token_hash")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sms_bridge_pairings_user_expires_idx" ON "sms_bridge_pairings" ("user_id", "expires_at")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sms_bridge_devices" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "account_id" uuid REFERENCES "gpt_accounts"("id") ON DELETE set null,
      "name" varchar(100) NOT NULL,
      "phone_label" varchar(100),
      "token_hash" varchar(64) NOT NULL,
      "app_version" varchar(30),
      "platform" varchar(30) DEFAULT 'android' NOT NULL,
      "last_seen_at" timestamp with time zone,
      "revoked_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "sms_bridge_devices_token_hash_uniq" ON "sms_bridge_devices" ("token_hash")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sms_bridge_devices_user_idx" ON "sms_bridge_devices" ("user_id", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sms_bridge_devices_account_idx" ON "sms_bridge_devices" ("account_id")`)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sms_bridge_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "device_id" uuid NOT NULL REFERENCES "sms_bridge_devices"("id") ON DELETE cascade,
      "account_id" uuid REFERENCES "gpt_accounts"("id") ON DELETE set null,
      "provider" varchar(30) DEFAULT 'pickleplus' NOT NULL,
      "sender" varchar(100),
      "body" text NOT NULL,
      "verification_code" varchar(12),
      "dedupe_hash" varchar(64) NOT NULL,
      "received_at" timestamp with time zone NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "sms_bridge_messages_dedupe_hash_uniq" ON "sms_bridge_messages" ("dedupe_hash")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sms_bridge_messages_user_received_idx" ON "sms_bridge_messages" ("user_id", "received_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "sms_bridge_messages_account_received_idx" ON "sms_bridge_messages" ("account_id", "received_at")`)
  await db.execute(sql`ALTER TABLE "sms_bridge_pairings" ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE "sms_bridge_devices" ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`ALTER TABLE "sms_bridge_messages" ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`REVOKE ALL ON TABLE "sms_bridge_pairings" FROM anon, authenticated`)
  await db.execute(sql`REVOKE ALL ON TABLE "sms_bridge_devices" FROM anon, authenticated`)
  await db.execute(sql`REVOKE ALL ON TABLE "sms_bridge_messages" FROM anon, authenticated`)
}

export async function createSmsPairing(input: {
  userId: string
  accountId: string
  deviceLabel?: string | null
}) {
  await ensureSmsBridgeTables()
  const [account] = await db
    .select({ id: gptAccounts.id })
    .from(gptAccounts)
    .where(and(eq(gptAccounts.id, input.accountId), eq(gptAccounts.userId, input.userId)))
    .limit(1)
  if (!account) throw new Error('연결할 AI 계정을 찾을 수 없습니다.')

  const token = createSmsBridgeToken(24)
  const expiresAt = new Date(Date.now() + SMS_PAIRING_TTL_MINUTES * 60_000)
  await db.insert(smsBridgePairings).values({
    userId: input.userId,
    accountId: account.id,
    deviceLabel: input.deviceLabel?.trim().slice(0, 100) || null,
    tokenHash: hashSmsBridgeToken(token),
    expiresAt,
  })
  return { token, expiresAt }
}

export async function claimSmsPairing(input: {
  token: string
  deviceName: string
  phoneLabel?: string | null
  appVersion?: string | null
}) {
  await ensureSmsBridgeTables()
  const tokenHash = hashSmsBridgeToken(input.token)
  return db.transaction(async (tx) => {
    const [pairing] = await tx
      .select()
      .from(smsBridgePairings)
      .where(and(
        eq(smsBridgePairings.tokenHash, tokenHash),
        isNull(smsBridgePairings.claimedAt),
        gt(smsBridgePairings.expiresAt, new Date()),
      ))
      .limit(1)
    if (!pairing) throw new Error('연결 QR이 만료되었거나 이미 사용되었습니다.')

    const [claimed] = await tx.update(smsBridgePairings)
      .set({ claimedAt: new Date() })
      .where(and(eq(smsBridgePairings.id, pairing.id), isNull(smsBridgePairings.claimedAt)))
      .returning({ id: smsBridgePairings.id })
    if (!claimed) throw new Error('연결 QR이 이미 사용되었습니다.')

    const deviceToken = createSmsBridgeToken()
    const [device] = await tx.insert(smsBridgeDevices).values({
      userId: pairing.userId,
      accountId: pairing.accountId,
      name: input.deviceName.trim().slice(0, 100) || 'Android 휴대폰',
      phoneLabel: input.phoneLabel?.trim().slice(0, 100) || pairing.deviceLabel,
      tokenHash: hashSmsBridgeToken(deviceToken),
      appVersion: input.appVersion?.trim().slice(0, 30) || null,
      lastSeenAt: new Date(),
    }).returning({ id: smsBridgeDevices.id })
    return { deviceId: device.id, deviceToken }
  })
}

export async function authenticateSmsDevice(token: string) {
  await ensureSmsBridgeTables()
  const [device] = await db.select().from(smsBridgeDevices)
    .where(and(eq(smsBridgeDevices.tokenHash, hashSmsBridgeToken(token)), isNull(smsBridgeDevices.revokedAt)))
    .limit(1)
  return device || null
}

export async function touchSmsDevice(deviceId: string, appVersion?: string | null) {
  await db.update(smsBridgeDevices).set({
    lastSeenAt: new Date(),
    appVersion: appVersion?.trim().slice(0, 30) || undefined,
    updatedAt: new Date(),
  }).where(eq(smsBridgeDevices.id, deviceId))
}

export async function saveSmsBridgeMessage(input: {
  device: typeof smsBridgeDevices.$inferSelect
  sender?: string | null
  body: string
  receivedAt: Date
  sourceMessageId?: string | null
}) {
  // Raw SMS bodies are operationally useful only for a short troubleshooting window.
  await db.delete(smsBridgeMessages).where(lt(smsBridgeMessages.receivedAt, new Date(Date.now() - 24 * 60 * 60_000)))
  const sender = input.sender?.trim().slice(0, 100) || null
  const body = input.body.trim().slice(0, 2000)
  if (!body || !isPicklePlusMessage(sender, body)) return { accepted: false, reason: 'filtered' as const }

  const code = extractVerificationCode(body)
  const fingerprint = `${input.device.id}\n${input.sourceMessageId || ''}\n${sender || ''}\n${body}\n${input.receivedAt.toISOString()}`
  const [message] = await db.insert(smsBridgeMessages).values({
    userId: input.device.userId,
    deviceId: input.device.id,
    accountId: input.device.accountId,
    sender,
    body,
    verificationCode: code,
    dedupeHash: hashSmsBridgeToken(fingerprint),
    receivedAt: input.receivedAt,
    expiresAt: new Date(input.receivedAt.getTime() + SMS_CODE_TTL_MINUTES * 60_000),
  }).onConflictDoNothing({ target: smsBridgeMessages.dedupeHash }).returning({ id: smsBridgeMessages.id })
  await touchSmsDevice(input.device.id)
  return { accepted: true, duplicate: !message, code }
}

export async function listSmsBridgeDevices(userId: string) {
  await ensureSmsBridgeTables()
  return db.select({
    id: smsBridgeDevices.id,
    accountId: smsBridgeDevices.accountId,
    accountName: gptAccounts.name,
    name: smsBridgeDevices.name,
    phoneLabel: smsBridgeDevices.phoneLabel,
    appVersion: smsBridgeDevices.appVersion,
    lastSeenAt: smsBridgeDevices.lastSeenAt,
    revokedAt: smsBridgeDevices.revokedAt,
    createdAt: smsBridgeDevices.createdAt,
  }).from(smsBridgeDevices)
    .leftJoin(gptAccounts, eq(gptAccounts.id, smsBridgeDevices.accountId))
    .where(eq(smsBridgeDevices.userId, userId))
    .orderBy(desc(smsBridgeDevices.createdAt))
}

export async function listSmsBridgeMessages(userId: string) {
  await ensureSmsBridgeTables()
  const since = new Date(Date.now() - 24 * 60 * 60_000)
  return db.select({
    id: smsBridgeMessages.id,
    accountId: smsBridgeMessages.accountId,
    accountName: gptAccounts.name,
    deviceId: smsBridgeMessages.deviceId,
    deviceName: smsBridgeDevices.name,
    sender: smsBridgeMessages.sender,
    body: smsBridgeMessages.body,
    verificationCode: smsBridgeMessages.verificationCode,
    receivedAt: smsBridgeMessages.receivedAt,
    expiresAt: smsBridgeMessages.expiresAt,
  }).from(smsBridgeMessages)
    .innerJoin(smsBridgeDevices, eq(smsBridgeDevices.id, smsBridgeMessages.deviceId))
    .leftJoin(gptAccounts, eq(gptAccounts.id, smsBridgeMessages.accountId))
    .where(and(eq(smsBridgeMessages.userId, userId), gte(smsBridgeMessages.receivedAt, since)))
    .orderBy(desc(smsBridgeMessages.receivedAt))
    .limit(100)
}

export async function revokeSmsBridgeDevice(userId: string, deviceId: string) {
  await ensureSmsBridgeTables()
  const [device] = await db.update(smsBridgeDevices).set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(smsBridgeDevices.userId, userId), eq(smsBridgeDevices.id, deviceId), isNull(smsBridgeDevices.revokedAt)))
    .returning({ id: smsBridgeDevices.id })
  return Boolean(device)
}

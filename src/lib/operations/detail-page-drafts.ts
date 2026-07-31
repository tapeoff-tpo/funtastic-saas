import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  detailPageJobs,
  figmaBridgeCommands,
  figmaBridgeDevices,
  figmaBridgePairings,
} from '@/lib/db/schema'

export const DETAIL_PAGE_FIGMA_FILE_KEY = 'X8yYgVtrAFKycEA0yy0kWI'
export const DETAIL_PAGE_FIGMA_FILE_URL = 'https://www.figma.com/design/X8yYgVtrAFKycEA0yy0kWI/ai-%EC%83%9D%EC%84%B1-%EC%83%81%EC%84%B8%ED%8E%98%EC%9D%B4%EC%A7%80?node-id=0-1'
export const FIGMA_PAIRING_TTL_MINUTES = 10

export type DetailPageDraftInput = {
  userId: string
  requestedByUserId: string
  clientJobKey: string
  product: {
    id: string
    sku: string
    name: string
    option: string
    purchaseUrl: string
    material: string
    size: string
    manufacturer: string
    weight: string
    country: string
    capacity: string
  }
  imageUrls: string[]
  template?: string | null
  note?: string | null
}

export type FigmaImageReplacementInput = {
  userId: string
  figmaFileKey: string
  targetFrameName: string
  targetNodeName: string
  imageUrl: string
}

export type FigmaFinalCompositionInput = {
  userId: string
  figmaFileKey: string
  productName: string
  selections: Array<{
    sourceFrameId: string
    sectionId: string
    sectionName: string
  }>
}

export type FigmaFrameRenameInput = {
  userId: string
  figmaFileKey: string
  frameId: string
  name: string
}

export type FigmaSingleOptionInput = {
  userId: string
  figmaFileKey: string
  frameId: string
}

function cleanText(value: string | null | undefined, limit: number) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, limit) : null
}

function cleanImages(value: string[]) {
  const images = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string' || images.size >= 30) continue
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      images.add(url.toString())
    } catch {
      // Ignore malformed image references sent from the browser workbench.
    }
  }
  return Array.from(images)
}

function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function toDetailPageDraftRecord(row: typeof detailPageJobs.$inferSelect) {
  return {
    id: row.id,
    clientJobKey: row.clientJobKey,
    product: {
      id: row.productId,
      sku: row.sku,
      name: row.productName,
      option: row.optionName ?? '',
      purchaseUrl: row.purchaseUrl ?? '',
      material: row.productSnapshot.material ?? '',
      size: row.productSnapshot.size ?? '',
      manufacturer: row.productSnapshot.manufacturer ?? '',
      weight: row.productSnapshot.weight ?? '',
      country: row.productSnapshot.country ?? '',
      capacity: row.productSnapshot.capacity ?? '',
    },
    imageUrls: row.imageUrls,
    template: row.template,
    note: row.note ?? '',
    status: row.status,
    errorMessage: row.errorMessage,
    figmaFileKey: row.figmaFileKey,
    figmaNodeId: row.figmaNodeId,
    figmaUrl: row.figmaUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function ensureDetailPageDraftTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "detail_page_jobs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "requested_by_user_id" uuid NOT NULL,
      "client_job_key" varchar(160) NOT NULL,
      "product_id" varchar(120) NOT NULL,
      "sku" varchar(100) NOT NULL,
      "product_name" text NOT NULL,
      "option_name" text,
      "purchase_url" text,
      "product_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "image_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "template" varchar(120) NOT NULL DEFAULT '기본 상품 상세',
      "note" text,
      "status" varchar(30) NOT NULL DEFAULT 'queued',
      "error_message" text,
      "figma_file_key" varchar(120) NOT NULL,
      "figma_node_id" varchar(120),
      "figma_url" text,
      "claimed_by_device_id" uuid,
      "claimed_at" timestamptz,
      "completed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "detail_page_jobs_user_client_key_uniq" ON "detail_page_jobs" ("user_id", "client_job_key")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "detail_page_jobs_user_status_created_idx" ON "detail_page_jobs" ("user_id", "status", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "detail_page_jobs_file_status_created_idx" ON "detail_page_jobs" ("figma_file_key", "status", "created_at")`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "figma_bridge_pairings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "device_label" varchar(100),
      "token_hash" varchar(64) NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "claimed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "figma_bridge_pairings_token_hash_uniq" ON "figma_bridge_pairings" ("token_hash")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "figma_bridge_pairings_user_expires_idx" ON "figma_bridge_pairings" ("user_id", "expires_at")`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "figma_bridge_devices" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "name" varchar(100) NOT NULL,
      "figma_file_key" varchar(120) NOT NULL,
      "token_hash" varchar(64) NOT NULL,
      "plugin_version" varchar(30),
      "last_seen_at" timestamptz,
      "revoked_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "figma_bridge_devices_token_hash_uniq" ON "figma_bridge_devices" ("token_hash")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "figma_bridge_devices_user_created_idx" ON "figma_bridge_devices" ("user_id", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "figma_bridge_devices_user_file_idx" ON "figma_bridge_devices" ("user_id", "figma_file_key")`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "figma_bridge_commands" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "figma_file_key" varchar(120) NOT NULL,
      "command_type" varchar(40) NOT NULL,
      "target_frame_name" text NOT NULL,
      "target_node_name" text NOT NULL,
      "image_url" text NOT NULL,
      "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "status" varchar(30) NOT NULL DEFAULT 'queued',
      "error_message" text,
      "claimed_by_device_id" uuid,
      "claimed_at" timestamptz,
      "completed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`ALTER TABLE "figma_bridge_commands" ADD COLUMN IF NOT EXISTS "payload" jsonb NOT NULL DEFAULT '{}'::jsonb`)
  await db.execute(sql`ALTER TABLE "figma_bridge_commands" ADD COLUMN IF NOT EXISTS "result" jsonb NOT NULL DEFAULT '{}'::jsonb`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "figma_bridge_commands_file_status_created_idx" ON "figma_bridge_commands" ("figma_file_key", "status", "created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "figma_bridge_commands_user_created_idx" ON "figma_bridge_commands" ("user_id", "created_at")`)

  for (const table of ['detail_page_jobs', 'figma_bridge_pairings', 'figma_bridge_devices', 'figma_bridge_commands']) {
    await db.execute(sql.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`))
    await db.execute(sql.raw(`REVOKE ALL ON TABLE "${table}" FROM anon, authenticated`))
  }
}

function toFigmaBridgeCommand(row: typeof figmaBridgeCommands.$inferSelect) {
  return {
    id: row.id,
    commandType: row.commandType,
    targetFrameName: row.targetFrameName,
    targetNodeName: row.targetNodeName,
    imageUrl: row.imageUrl,
    payload: row.payload,
    result: row.result,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function queueFigmaImageReplacement(input: FigmaImageReplacementInput) {
  await ensureDetailPageDraftTables()
  const imageUrl = cleanImages([input.imageUrl])[0]
  const figmaFileKey = cleanText(input.figmaFileKey, 120)
  const targetFrameName = cleanText(input.targetFrameName, 500)
  const targetNodeName = cleanText(input.targetNodeName, 500)
  if (!imageUrl || !figmaFileKey || !targetFrameName || !targetNodeName) {
    throw new Error('Figma image replacement data is incomplete.')
  }

  const [command] = await db
    .insert(figmaBridgeCommands)
    .values({
      userId: input.userId,
      figmaFileKey,
      commandType: 'replace-image',
      targetFrameName,
      targetNodeName,
      imageUrl,
      status: 'queued',
      updatedAt: new Date(),
    })
    .returning()
  return toFigmaBridgeCommand(command)
}

export async function queueFigmaFrameCapture(input: {
  userId: string
  figmaFileKey: string
}) {
  await ensureDetailPageDraftTables()
  const figmaFileKey = cleanText(input.figmaFileKey, 120)
  if (!figmaFileKey) throw new Error('Figma file key is required.')

  // Keep only the latest compare capture. The thumbnails are intentionally
  // short-lived operational evidence, not a growing asset archive.
  await db
    .delete(figmaBridgeCommands)
    .where(and(
      eq(figmaBridgeCommands.userId, input.userId),
      eq(figmaBridgeCommands.figmaFileKey, figmaFileKey),
      eq(figmaBridgeCommands.commandType, 'capture-frames'),
    ))

  const [command] = await db
    .insert(figmaBridgeCommands)
    .values({
      userId: input.userId,
      figmaFileKey,
      commandType: 'capture-frames',
      targetFrameName: 'detail-page comparison',
      targetNodeName: 'top-level product frames',
      imageUrl: '',
      payload: { nameFilters: ['델토', '헬리겔'], maxFrames: 8 },
      status: 'queued',
      updatedAt: new Date(),
    })
    .returning()
  return toFigmaBridgeCommand(command)
}

export async function queueFigmaFinalComposition(input: FigmaFinalCompositionInput) {
  await ensureDetailPageDraftTables()
  const figmaFileKey = cleanText(input.figmaFileKey, 120)
  const productName = cleanText(input.productName, 160)
  const selections = input.selections
    .map((selection) => ({
      sourceFrameId: cleanText(selection.sourceFrameId, 120),
      sectionId: cleanText(selection.sectionId, 120),
      sectionName: cleanText(selection.sectionName, 500),
    }))
    .filter((selection): selection is { sourceFrameId: string; sectionId: string; sectionName: string } => Boolean(
      selection.sourceFrameId && selection.sectionId && selection.sectionName,
    ))
    .slice(0, 24)
  if (!figmaFileKey || !productName || selections.length < 3) {
    throw new Error('A product name and at least three source sections are required.')
  }

  await db
    .delete(figmaBridgeCommands)
    .where(and(
      eq(figmaBridgeCommands.userId, input.userId),
      eq(figmaBridgeCommands.figmaFileKey, figmaFileKey),
      eq(figmaBridgeCommands.commandType, 'compose-final'),
      eq(figmaBridgeCommands.targetFrameName, productName),
      eq(figmaBridgeCommands.status, 'queued'),
    ))

  const [command] = await db
    .insert(figmaBridgeCommands)
    .values({
      userId: input.userId,
      figmaFileKey,
      commandType: 'compose-final',
      targetFrameName: productName,
      targetNodeName: 'selected source sections',
      imageUrl: '',
      payload: { selections },
      status: 'queued',
      updatedAt: new Date(),
    })
    .returning()
  return toFigmaBridgeCommand(command)
}

export async function queueFigmaFrameRename(input: FigmaFrameRenameInput) {
  await ensureDetailPageDraftTables()
  const figmaFileKey = cleanText(input.figmaFileKey, 120)
  const frameId = cleanText(input.frameId, 120)
  const name = cleanText(input.name, 300)
  if (!figmaFileKey || !frameId || !name) throw new Error('Figma frame rename data is incomplete.')

  const [command] = await db
    .insert(figmaBridgeCommands)
    .values({
      userId: input.userId,
      figmaFileKey,
      commandType: 'rename-frame',
      targetFrameName: 'frame rename',
      targetNodeName: frameId,
      imageUrl: '',
      payload: { frameId, name },
      status: 'queued',
      updatedAt: new Date(),
    })
    .returning()
  return toFigmaBridgeCommand(command)
}

export async function queueFigmaSingleTransparentOption(input: FigmaSingleOptionInput) {
  await ensureDetailPageDraftTables()
  const figmaFileKey = cleanText(input.figmaFileKey, 120)
  const frameId = cleanText(input.frameId, 120)
  if (!figmaFileKey || !frameId) throw new Error('Figma single-option data is incomplete.')

  const [command] = await db
    .insert(figmaBridgeCommands)
    .values({
      userId: input.userId,
      figmaFileKey,
      commandType: 'replace-option-section',
      targetFrameName: 'single transparent option',
      targetNodeName: frameId,
      imageUrl: '',
      payload: { frameId },
      status: 'queued',
      updatedAt: new Date(),
    })
    .returning()
  return toFigmaBridgeCommand(command)
}

export async function listFigmaBridgeCommands(userId: string) {
  await ensureDetailPageDraftTables()
  const commands = await db
    .select()
    .from(figmaBridgeCommands)
    .where(eq(figmaBridgeCommands.userId, userId))
    .orderBy(desc(figmaBridgeCommands.updatedAt), desc(figmaBridgeCommands.createdAt))
    .limit(50)
  return commands.map(toFigmaBridgeCommand)
}

export async function listFigmaFrameCaptures(userId: string, figmaFileKey: string) {
  await ensureDetailPageDraftTables()
  const commands = await db
    .select()
    .from(figmaBridgeCommands)
    .where(and(
      eq(figmaBridgeCommands.userId, userId),
      eq(figmaBridgeCommands.figmaFileKey, figmaFileKey),
      eq(figmaBridgeCommands.commandType, 'capture-frames'),
    ))
    .orderBy(desc(figmaBridgeCommands.updatedAt))
    .limit(1)
  return commands.map(toFigmaBridgeCommand)
}

export async function createDetailPageDraft(input: DetailPageDraftInput) {
  await ensureDetailPageDraftTables()
  const productName = cleanText(input.product.name, 1_000)
  const sku = cleanText(input.product.sku, 100)
  const productId = cleanText(input.product.id, 120)
  const clientJobKey = cleanText(input.clientJobKey, 160)
  const images = cleanImages(input.imageUrls)
  if (!productName || !sku || !productId || !clientJobKey) throw new Error('상세페이지 작업 정보가 올바르지 않습니다.')
  if (images.length === 0) throw new Error('이미지를 수집한 뒤 Figma 초안 제작을 요청해주세요.')

  const values = {
    requestedByUserId: input.requestedByUserId,
    productId,
    sku,
    productName,
    optionName: cleanText(input.product.option, 1_000),
    purchaseUrl: cleanText(input.product.purchaseUrl, 4_000),
    productSnapshot: {
      material: cleanText(input.product.material, 500) ?? '',
      size: cleanText(input.product.size, 500) ?? '',
      manufacturer: cleanText(input.product.manufacturer, 500) ?? '',
      weight: cleanText(input.product.weight, 500) ?? '',
      country: cleanText(input.product.country, 500) ?? '',
      capacity: cleanText(input.product.capacity, 500) ?? '',
    },
    imageUrls: images,
    template: cleanText(input.template, 120) ?? '기본 상품 상세',
    note: cleanText(input.note, 2_000),
    status: 'queued',
    errorMessage: null,
    figmaFileKey: DETAIL_PAGE_FIGMA_FILE_KEY,
    figmaNodeId: null,
    figmaUrl: null,
    claimedByDeviceId: null,
    claimedAt: null,
    completedAt: null,
    updatedAt: new Date(),
  } as const

  const [existing] = await db
    .select()
    .from(detailPageJobs)
    .where(and(eq(detailPageJobs.userId, input.userId), eq(detailPageJobs.clientJobKey, clientJobKey)))
    .limit(1)

  if (existing) {
    if (existing.figmaUrl || existing.status === 'creating' || existing.status === 'review' || existing.status === 'completed') {
      return toDetailPageDraftRecord(existing)
    }
    const [updated] = await db
      .update(detailPageJobs)
      .set(values)
      .where(and(eq(detailPageJobs.userId, input.userId), eq(detailPageJobs.id, existing.id)))
      .returning()
    return toDetailPageDraftRecord(updated)
  }

  const [created] = await db
    .insert(detailPageJobs)
    .values({ userId: input.userId, clientJobKey, ...values })
    .returning()
  return toDetailPageDraftRecord(created)
}

export async function listDetailPageDrafts(userId: string) {
  await ensureDetailPageDraftTables()
  const rows = await db
    .select()
    .from(detailPageJobs)
    .where(eq(detailPageJobs.userId, userId))
    .orderBy(desc(detailPageJobs.updatedAt), desc(detailPageJobs.createdAt))
    .limit(200)
  return rows.map(toDetailPageDraftRecord)
}

export async function completeDetailPageReview(userId: string, id: string) {
  await ensureDetailPageDraftTables()
  const [row] = await db
    .update(detailPageJobs)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(detailPageJobs.userId, userId), eq(detailPageJobs.id, id), sql`${detailPageJobs.status} <> 'completed'`))
    .returning()
  return row ? toDetailPageDraftRecord(row) : null
}

export async function requeueDetailPageDraft(userId: string, id: string, note?: string) {
  await ensureDetailPageDraftTables()
  const [row] = await db
    .update(detailPageJobs)
    .set({
      status: 'queued',
      ...(note === undefined ? {} : { note: cleanText(note, 2_000) }),
      errorMessage: null,
      claimedByDeviceId: null,
      claimedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(detailPageJobs.userId, userId),
      eq(detailPageJobs.id, id),
      sql`${detailPageJobs.status} <> 'completed'`,
    ))
    .returning()
  return row ? toDetailPageDraftRecord(row) : null
}

export async function deleteDetailPageDraft(userId: string, id: string) {
  await ensureDetailPageDraftTables()
  const [deleted] = await db
    .delete(detailPageJobs)
    .where(and(eq(detailPageJobs.userId, userId), eq(detailPageJobs.id, id)))
    .returning({ id: detailPageJobs.id })
  return Boolean(deleted)
}

export async function createFigmaBridgePairing(userId: string, deviceLabel?: string | null) {
  await ensureDetailPageDraftTables()
  const pairingToken = token(24)
  const expiresAt = new Date(Date.now() + FIGMA_PAIRING_TTL_MINUTES * 60_000)
  await db.insert(figmaBridgePairings).values({
    userId,
    deviceLabel: cleanText(deviceLabel, 100),
    tokenHash: hash(pairingToken),
    expiresAt,
  })
  return { pairingToken, expiresAt }
}

export async function claimFigmaBridgePairing(input: {
  pairingToken: string
  deviceName: string
  figmaFileKey: string
  pluginVersion?: string | null
}) {
  await ensureDetailPageDraftTables()
  const pairingHash = hash(input.pairingToken)
  return db.transaction(async (tx) => {
    const [pairing] = await tx
      .select()
      .from(figmaBridgePairings)
      .where(and(
        eq(figmaBridgePairings.tokenHash, pairingHash),
        isNull(figmaBridgePairings.claimedAt),
        gt(figmaBridgePairings.expiresAt, new Date()),
      ))
      .limit(1)
    if (!pairing) throw new Error('연결 코드가 만료되었거나 이미 사용되었습니다.')

    const [claimed] = await tx
      .update(figmaBridgePairings)
      .set({ claimedAt: new Date() })
      .where(and(eq(figmaBridgePairings.id, pairing.id), isNull(figmaBridgePairings.claimedAt)))
      .returning({ id: figmaBridgePairings.id })
    if (!claimed) throw new Error('연결 코드가 이미 사용되었습니다.')

    const bridgeToken = token()
    const [device] = await tx
      .insert(figmaBridgeDevices)
      .values({
        userId: pairing.userId,
        name: cleanText(input.deviceName, 100) ?? 'Figma 상세페이지 플러그인',
        figmaFileKey: input.figmaFileKey.trim().slice(0, 120),
        tokenHash: hash(bridgeToken),
        pluginVersion: cleanText(input.pluginVersion, 30),
        lastSeenAt: new Date(),
      })
      .returning({ id: figmaBridgeDevices.id })
    return { deviceId: device.id, bridgeToken }
  })
}

export async function authenticateFigmaBridgeDevice(bridgeToken: string) {
  await ensureDetailPageDraftTables()
  const [device] = await db
    .select()
    .from(figmaBridgeDevices)
    .where(and(eq(figmaBridgeDevices.tokenHash, hash(bridgeToken)), isNull(figmaBridgeDevices.revokedAt)))
    .limit(1)
  return device ?? null
}

export async function touchFigmaBridgeDevice(deviceId: string, pluginVersion?: string | null) {
  await db
    .update(figmaBridgeDevices)
    .set({
      lastSeenAt: new Date(),
      pluginVersion: cleanText(pluginVersion, 30) ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(figmaBridgeDevices.id, deviceId))
}

export async function claimNextFigmaBridgeCommand(device: typeof figmaBridgeDevices.$inferSelect) {
  await ensureDetailPageDraftTables()
  const [candidate] = await db
    .select({ id: figmaBridgeCommands.id })
    .from(figmaBridgeCommands)
    .where(and(
      eq(figmaBridgeCommands.userId, device.userId),
      eq(figmaBridgeCommands.figmaFileKey, device.figmaFileKey),
      eq(figmaBridgeCommands.status, 'queued'),
    ))
    .orderBy(asc(figmaBridgeCommands.createdAt))
    .limit(1)
  if (!candidate) return null

  const [claimed] = await db
    .update(figmaBridgeCommands)
    .set({
      status: 'creating',
      claimedByDeviceId: device.id,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(figmaBridgeCommands.id, candidate.id),
      eq(figmaBridgeCommands.status, 'queued'),
    ))
    .returning()
  return claimed ? toFigmaBridgeCommand(claimed) : null
}

export async function finishFigmaBridgeCommand(input: {
  device: typeof figmaBridgeDevices.$inferSelect
  commandId: string
  result?: Record<string, unknown>
}) {
  await ensureDetailPageDraftTables()
  const [command] = await db
    .update(figmaBridgeCommands)
    .set({
      status: 'completed',
      errorMessage: null,
      result: input.result ?? undefined,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(figmaBridgeCommands.id, input.commandId),
      eq(figmaBridgeCommands.userId, input.device.userId),
      eq(figmaBridgeCommands.claimedByDeviceId, input.device.id),
      eq(figmaBridgeCommands.status, 'creating'),
    ))
    .returning()
  return command ? toFigmaBridgeCommand(command) : null
}

export async function failFigmaBridgeCommand(input: {
  device: typeof figmaBridgeDevices.$inferSelect
  commandId: string
  errorMessage: string
}) {
  await ensureDetailPageDraftTables()
  const [command] = await db
    .update(figmaBridgeCommands)
    .set({
      status: 'failed',
      errorMessage: cleanText(input.errorMessage, 2_000) ?? 'Figma image replacement failed.',
      updatedAt: new Date(),
    })
    .where(and(
      eq(figmaBridgeCommands.id, input.commandId),
      eq(figmaBridgeCommands.userId, input.device.userId),
      eq(figmaBridgeCommands.claimedByDeviceId, input.device.id),
      eq(figmaBridgeCommands.status, 'creating'),
    ))
    .returning()
  return command ? toFigmaBridgeCommand(command) : null
}

export async function claimNextDetailPageDraft(device: typeof figmaBridgeDevices.$inferSelect) {
  await ensureDetailPageDraftTables()
  const [candidate] = await db
    .select({ id: detailPageJobs.id })
    .from(detailPageJobs)
    .where(and(
      eq(detailPageJobs.userId, device.userId),
      eq(detailPageJobs.figmaFileKey, device.figmaFileKey),
      eq(detailPageJobs.status, 'queued'),
    ))
    .orderBy(asc(detailPageJobs.createdAt))
    .limit(1)
  if (!candidate) return null

  const [claimed] = await db
    .update(detailPageJobs)
    .set({
      status: 'creating',
      claimedByDeviceId: device.id,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(detailPageJobs.id, candidate.id), eq(detailPageJobs.status, 'queued')))
    .returning()
  return claimed ? toDetailPageDraftRecord(claimed) : null
}

export async function finishDetailPageDraft(input: {
  device: typeof figmaBridgeDevices.$inferSelect
  jobId: string
  figmaNodeId: string
  figmaUrl: string
}) {
  await ensureDetailPageDraftTables()
  const [row] = await db
    .update(detailPageJobs)
    .set({
      status: 'review',
      figmaNodeId: cleanText(input.figmaNodeId, 120),
      figmaUrl: cleanText(input.figmaUrl, 2_000),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(detailPageJobs.id, input.jobId),
      eq(detailPageJobs.userId, input.device.userId),
      eq(detailPageJobs.claimedByDeviceId, input.device.id),
      eq(detailPageJobs.status, 'creating'),
    ))
    .returning()
  return row ? toDetailPageDraftRecord(row) : null
}

export async function failDetailPageDraft(input: {
  device: typeof figmaBridgeDevices.$inferSelect
  jobId: string
  errorMessage: string
}) {
  await ensureDetailPageDraftTables()
  const [row] = await db
    .update(detailPageJobs)
    .set({
      status: 'failed',
      errorMessage: cleanText(input.errorMessage, 2_000) ?? 'Figma 초안 제작에 실패했습니다.',
      updatedAt: new Date(),
    })
    .where(and(
      eq(detailPageJobs.id, input.jobId),
      eq(detailPageJobs.userId, input.device.userId),
      eq(detailPageJobs.claimedByDeviceId, input.device.id),
      eq(detailPageJobs.status, 'creating'),
    ))
    .returning()
  return row ? toDetailPageDraftRecord(row) : null
}

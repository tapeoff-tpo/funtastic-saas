import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { figmaBridgeDevices } from '@/lib/db/schema'
import {
  DETAIL_PAGE_FIGMA_FILE_KEY,
  queueFigmaImageReplacement,
} from '@/lib/operations/detail-page-drafts'

const [targetFrameName, targetNodeName, imageUrl] = process.argv.slice(2)

if (!targetFrameName || !targetNodeName || !imageUrl) {
  throw new Error('Usage: queue-figma-image-replacement <frame name> <image layer name> <image URL>')
}

const [device] = await db
  .select()
  .from(figmaBridgeDevices)
  .where(and(
    eq(figmaBridgeDevices.figmaFileKey, DETAIL_PAGE_FIGMA_FILE_KEY),
    isNull(figmaBridgeDevices.revokedAt),
  ))
  .orderBy(desc(figmaBridgeDevices.lastSeenAt), desc(figmaBridgeDevices.updatedAt))
  .limit(1)

if (!device) throw new Error('No connected Figma bridge device was found for the AI detail-page file.')

const command = await queueFigmaImageReplacement({
  userId: device.userId,
  figmaFileKey: device.figmaFileKey,
  targetFrameName,
  targetNodeName,
  imageUrl,
})

console.log(JSON.stringify(command))

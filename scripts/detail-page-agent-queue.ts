import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { detailPageJobs } from '@/lib/db/schema'

type Command = 'list' | 'claim' | 'review' | 'needs-info' | 'requeue'

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined
}

function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const command = (process.argv[2] ?? 'list') as Command
const jobId = option('job')

if (!['list', 'claim', 'review', 'needs-info', 'requeue'].includes(command)) {
  fail('Usage: detail-page-agent-queue <list|claim|review|needs-info|requeue> [--job ID]')
}

if (command === 'list') {
  const jobs = await db
    .select()
    .from(detailPageJobs)
    .where(inArray(detailPageJobs.status, ['agent_pending', 'agent_creating', 'review', 'needs_info']))
    .orderBy(asc(detailPageJobs.createdAt))
    .limit(50)
  output(jobs)
  process.exit(0)
}

if (!jobId && command !== 'claim') fail('--job is required for this command.')

if (command === 'claim') {
  const claimed = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(detailPageJobs)
      .where(jobId ? and(eq(detailPageJobs.id, jobId), eq(detailPageJobs.status, 'agent_pending')) : eq(detailPageJobs.status, 'agent_pending'))
      .orderBy(asc(detailPageJobs.createdAt))
      .limit(1)
    if (!candidate) return null

    const [updated] = await tx
      .update(detailPageJobs)
      .set({ status: 'agent_creating', errorMessage: null, claimedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(detailPageJobs.id, candidate.id), eq(detailPageJobs.status, 'agent_pending')))
      .returning()
    return updated ?? null
  })
  output({ job: claimed })
  process.exit(0)
}

if (command === 'review') {
  const figmaUrl = option('figma-url')
  const figmaNodeId = option('figma-node-id')
  if (!figmaUrl || !figmaNodeId) fail('--figma-url and --figma-node-id are required for review.')
  const [updated] = await db
    .update(detailPageJobs)
    .set({ status: 'review', figmaUrl, figmaNodeId, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'agent_creating')))
    .returning()
  output({ job: updated ?? null })
  process.exit(updated ? 0 : 1)
}

if (command === 'needs-info') {
  const message = option('message')
  if (!message) fail('--message is required for needs-info.')
  const [updated] = await db
    .update(detailPageJobs)
    .set({ status: 'needs_info', errorMessage: message, updatedAt: new Date() })
    .where(and(eq(detailPageJobs.id, jobId!), inArray(detailPageJobs.status, ['agent_pending', 'agent_creating'])))
    .returning()
  output({ job: updated ?? null })
  process.exit(updated ? 0 : 1)
}

const [updated] = await db
  .update(detailPageJobs)
  .set({ status: 'agent_pending', errorMessage: null, claimedAt: null, updatedAt: new Date() })
  .where(and(eq(detailPageJobs.id, jobId!), inArray(detailPageJobs.status, ['needs_info', 'failed', 'review'])))
  .returning()
output({ job: updated ?? null })
process.exit(updated ? 0 : 1)

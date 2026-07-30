import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { detailPageJobs } from '@/lib/db/schema'
import { ensureDetailPageDraftTables } from '@/lib/operations/detail-page-drafts'

type Command = 'list' | 'claim' | 'submit' | 'review' | 'qa-stage' | 'qa-claim' | 'qa-approve' | 'qa-reject' | 'qa' | 'needs-info' | 'requeue'

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

async function main() {
  await ensureDetailPageDraftTables()
  const command = (process.argv[2] ?? 'list') as Command
  const jobId = option('job')

  if (!['list', 'claim', 'submit', 'review', 'qa-stage', 'qa-claim', 'qa-approve', 'qa-reject', 'qa', 'needs-info', 'requeue'].includes(command)) {
    fail('Usage: detail-page-agent-queue <list|claim|submit|review|qa-stage|qa-claim|qa-approve|qa-reject|qa|needs-info|requeue> [--job ID]')
  }

  if (command === 'list') {
  const jobs = await db
    .select()
    .from(detailPageJobs)
    .where(inArray(detailPageJobs.status, ['agent_pending', 'agent_creating', 'agent_qa_pending', 'agent_qa_reviewing', 'review', 'needs_info']))
    .orderBy(asc(detailPageJobs.createdAt))
    .limit(50)
  output(jobs)
    process.exit(0)
  }

  if (!jobId && command !== 'claim' && command !== 'qa-claim') fail('--job is required for this command.')

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

  if (command === 'submit' || command === 'review') {
    const figmaUrl = option('figma-url')
    const figmaNodeId = option('figma-node-id')
    if (!figmaUrl || !figmaNodeId) fail('--figma-url and --figma-node-id are required for submit.')
    const [updated] = await db
      .update(detailPageJobs)
      .set({ status: 'agent_qa_pending', figmaUrl, figmaNodeId, agentQa: null, agentQaAt: null, errorMessage: null, updatedAt: new Date() })
      .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'agent_creating')))
    .returning()
  output({ job: updated ?? null })
    process.exit(updated ? 0 : 1)
  }

  if (command === 'qa-stage') {
    const [updated] = await db
      .update(detailPageJobs)
      .set({ status: 'agent_qa_pending', agentQa: null, agentQaAt: null, errorMessage: null, updatedAt: new Date() })
      .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'review')))
      .returning()
    output({ job: updated ?? null })
    process.exit(updated ? 0 : 1)
  }

  if (command === 'qa-claim') {
    const claimed = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(detailPageJobs)
        .where(jobId ? and(eq(detailPageJobs.id, jobId), eq(detailPageJobs.status, 'agent_qa_pending')) : eq(detailPageJobs.status, 'agent_qa_pending'))
        .orderBy(asc(detailPageJobs.updatedAt), asc(detailPageJobs.createdAt))
        .limit(1)
      if (!candidate) return null

      const [updated] = await tx
        .update(detailPageJobs)
        .set({ status: 'agent_qa_reviewing', errorMessage: null, updatedAt: new Date() })
        .where(and(eq(detailPageJobs.id, candidate.id), eq(detailPageJobs.status, 'agent_qa_pending')))
        .returning()
      return updated ?? null
    })
    output({ job: claimed })
    process.exit(0)
  }

  if (command === 'qa-approve') {
    const qaReport = option('qa-report')
    if (!qaReport) fail('--qa-report is required for qa-approve.')
    const [updated] = await db
      .update(detailPageJobs)
      .set({ status: 'review', agentQa: qaReport.slice(0, 2_000), agentQaAt: new Date(), errorMessage: null, updatedAt: new Date() })
      .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'agent_qa_reviewing')))
      .returning()
    output({ job: updated ?? null })
    process.exit(updated ? 0 : 1)
  }

  if (command === 'qa-reject') {
    const qaReport = option('qa-report')
    if (!qaReport) fail('--qa-report is required for qa-reject.')
    const [current] = await db
      .select({ note: detailPageJobs.note })
      .from(detailPageJobs)
      .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'agent_qa_reviewing')))
      .limit(1)
    if (!current) {
      output({ job: null })
      process.exit(1)
    }
    const marker = '[독립 검수 재작업 지시]'
    const baseNote = (current.note ?? '').split(`\n\n${marker}`)[0].trim()
    const revisionNote = [baseNote, `${marker}\n${qaReport.trim()}`].filter(Boolean).join('\n\n').slice(0, 2_000)
    const [updated] = await db
      .update(detailPageJobs)
      .set({
        status: 'agent_pending',
        note: revisionNote,
        errorMessage: `독립 검수 불합격: ${qaReport.slice(0, 1_700)}`,
        agentQa: qaReport.slice(0, 2_000),
        agentQaAt: new Date(),
        claimedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'agent_qa_reviewing')))
      .returning()
    output({ job: updated ?? null })
    process.exit(updated ? 0 : 1)
  }

  if (command === 'qa') {
    const qaReport = option('qa-report')
    if (!qaReport) fail('--qa-report is required for qa.')
    const [updated] = await db
      .update(detailPageJobs)
      .set({ agentQa: qaReport.slice(0, 2_000), agentQaAt: new Date(), updatedAt: new Date() })
      .where(and(eq(detailPageJobs.id, jobId!), eq(detailPageJobs.status, 'review')))
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

  const note = option('note')
  const [updated] = await db
    .update(detailPageJobs)
    .set({
      status: 'agent_pending',
      ...(note ? { note: note.slice(0, 2_000) } : {}),
      errorMessage: null,
      agentQa: null,
      agentQaAt: null,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(detailPageJobs.id, jobId!), inArray(detailPageJobs.status, ['needs_info', 'failed', 'agent_qa_pending', 'agent_qa_reviewing', 'review'])))
    .returning()
  output({ job: updated ?? null })
  process.exit(updated ? 0 : 1)
}

void main()

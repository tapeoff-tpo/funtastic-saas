import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectOrdersForConnection: vi.fn(),
  queueManualCollection: vi.fn().mockResolvedValue('queued-job-id'),
  scrapeQueueAdd: vi.fn().mockResolvedValue({ id: 'scrape-job-id' }),
  createCollectionJobLogsWithLock: vi.fn().mockResolvedValue({
    ok: true,
    jobLogIds: ['job-log-api'],
  }),
  getIntegrationMethod: vi.fn().mockReturnValue('api'),
  isRegisteredScraperMarketplace: vi.fn().mockReturnValue(true),
  dbSelectRows: [
    {
      id: 'conn-api',
      marketplaceId: 'funtastic-b2b',
      userId: 'workspace-user',
      isManual: false,
      authType: 'api_key',
    },
  ],
  dbUpdateWhere: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-user' } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/admin-accounts/queries', () => ({
  getWorkspaceUserId: vi.fn().mockResolvedValue('workspace-user'),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(mocks.dbSelectRows),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mocks.dbUpdateWhere,
      })),
    })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  marketplaceConnections: {
    id: 'marketplace_connections.id',
    userId: 'marketplace_connections.user_id',
    marketplaceId: 'marketplace_connections.marketplace_id',
    isManual: 'marketplace_connections.is_manual',
    authType: 'marketplace_connections.auth_type',
  },
  jobLogs: {
    id: 'job_logs.id',
    status: 'job_logs.status',
    completedAt: 'job_logs.completed_at',
    errorMessage: 'job_logs.error_message',
    progressMessage: 'job_logs.progress_message',
  },
}))

vi.mock('@/lib/jobs/workers/order-collector', () => ({
  collectOrdersForConnection: mocks.collectOrdersForConnection,
}))

vi.mock('@/lib/jobs/queues', () => ({
  queueManualCollection: mocks.queueManualCollection,
  getMarketplaceScrapeQueue: vi.fn(() => ({
    add: mocks.scrapeQueueAdd,
  })),
}))

vi.mock('@/lib/marketplace/integration-methods', () => ({
  getIntegrationMethod: mocks.getIntegrationMethod,
}))

vi.mock('@/lib/jobs/collection-lock', () => ({
  createCollectionJobLogsWithLock: mocks.createCollectionJobLogsWithLock,
}))

vi.mock('@/scrapers/supported', () => ({
  isRegisteredScraperMarketplace: mocks.isRegisteredScraperMarketplace,
}))

describe('POST /api/orders/collect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getIntegrationMethod.mockReturnValue('api')
    mocks.createCollectionJobLogsWithLock.mockResolvedValue({
      ok: true,
      jobLogIds: ['job-log-api'],
    })
    mocks.dbSelectRows = [
      {
        id: 'conn-api',
        marketplaceId: 'funtastic-b2b',
        userId: 'workspace-user',
        isManual: false,
        authType: 'api_key',
      },
    ]
  })

  it('queues API marketplace collection instead of running it inside the Vercel request', async () => {
    const { POST } = await import('@/app/api/orders/collect/route')

    const response = await POST(new Request('http://test.local/api/orders/collect', {
      method: 'POST',
      body: JSON.stringify({ connectionIds: ['conn-api'], manualLookbackDays: 3 }),
    }) as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ jobLogIds: ['job-log-api'] })
    expect(mocks.queueManualCollection).toHaveBeenCalledWith({
      marketplaceId: 'funtastic-b2b',
      connectionId: 'conn-api',
      userId: 'workspace-user',
      jobType: 'manual-order-collection',
      jobLogId: 'job-log-api',
      manualLookbackDays: 3,
      manualDateFrom: undefined,
      manualDateTo: undefined,
    })
    expect(mocks.collectOrdersForConnection).not.toHaveBeenCalled()
  })
})

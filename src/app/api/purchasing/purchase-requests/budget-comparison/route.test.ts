// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  comparison: null as Record<string, unknown> | null,
  getWorkspaceUserId: vi.fn(async () => 'workspace-owner'),
  getComparison: vi.fn(async () => state.comparison),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: state.getWorkspaceUserId }))
vi.mock('@/lib/purchasing/purchase-budget-comparison-store', () => ({ getLatestPurchaseBudgetComparison: state.getComparison }))

import { GET } from './route'

describe('budget comparison download', () => {
  beforeEach(() => {
    state.user = { id: 'admin' }
    state.comparison = null
    state.getWorkspaceUserId.mockClear()
    state.getComparison.mockClear()
  })

  it('requires authentication', async () => {
    state.user = null
    const response = await GET()
    expect(response.status).toBe(401)
    expect(state.getComparison).not.toHaveBeenCalled()
  })

  it('shows a useful message when there is no saved budget comparison', async () => {
    const response = await GET()
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain('구매예산')
    expect(state.getWorkspaceUserId).toHaveBeenCalledWith('admin')
    expect(state.getComparison).toHaveBeenCalledWith('workspace-owner')
  })

  it('downloads a private Excel file for the shared workspace', async () => {
    state.comparison = {
      version: 1, calculatedAt: '2026-10-20T16:00:00.000Z', targetStockMonths: 1.5,
      budgetKrw: 6_000_000, spentBudgetKrw: 5_900_000, exchangeRateKrw: 200, rows: [],
    }
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml')
    expect(response.headers.get('content-disposition')).toContain('20261021.xlsx')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(state.getComparison).toHaveBeenCalledWith('workspace-owner')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100)
  })
})

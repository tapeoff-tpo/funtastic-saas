import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module before importing actions
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

import { holdOrder, releaseOrder, updateOrderStatus } from '@/lib/orders/actions'
import { db } from '@/lib/db'

describe('holdOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets is_held=true and stores previous status', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'confirmed',
      isHeld: false,
    }

    // Mock transaction to execute the callback
    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await holdOrder('order-1', 'waiting for stock')
    expect(result.success).toBe(true)
  })

  it('fails if order is already held', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'confirmed',
      isHeld: true,
    }

    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await holdOrder('order-1', 'reason')
    expect(result.success).toBe(false)
    expect(result.error).toContain('already held')
  })

  it('fails if order not found', async () => {
    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await holdOrder('nonexistent', 'reason')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('releaseOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores previous status when released', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'confirmed',
      isHeld: true,
      previousStatus: 'confirmed',
    }

    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await releaseOrder('order-1')
    expect(result.success).toBe(true)
  })

  it('fails if order is not held', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'confirmed',
      isHeld: false,
    }

    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await releaseOrder('order-1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not held')
  })
})

describe('updateOrderStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('succeeds for valid transition (new -> confirmed)', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'new',
      isHeld: false,
    }

    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await updateOrderStatus('order-1', 'confirmed')
    expect(result.success).toBe(true)
  })

  it('fails for invalid transition (new -> delivered)', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'new',
      isHeld: false,
    }

    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await updateOrderStatus('order-1', 'delivered')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid transition')
  })

  it('fails if order is held', async () => {
    const mockOrder = {
      id: 'order-1',
      status: 'new',
      isHeld: true,
    }

    vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([mockOrder]),
            }),
          }),
        }),
      }
      return cb(tx)
    })

    const result = await updateOrderStatus('order-1', 'confirmed')
    expect(result.success).toBe(false)
    expect(result.error).toContain('held')
  })
})

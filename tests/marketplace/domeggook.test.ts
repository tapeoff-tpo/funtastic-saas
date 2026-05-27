import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomeggookAdapter } from '@/lib/marketplace/adapters/domeggook/adapter'
import {
  createDomeggookClient,
  postDomeggookFormJson,
  readDomeggookJson,
} from '@/lib/marketplace/adapters/domeggook/client'

vi.mock('@/lib/marketplace/adapters/domeggook/client', () => ({
  createDomeggookClient: vi.fn(() => ({})),
  postDomeggookFormJson: vi.fn(),
  readDomeggookJson: vi.fn(),
}))

describe('DomeggookAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ ip: '208.77.246.15' }),
    })))
    vi.mocked(postDomeggookFormJson).mockResolvedValue({ domeggook: { sId: 'session-id' } })
    vi.mocked(readDomeggookJson).mockResolvedValue({ domeggook: { items: [], header: { numberOfPages: 1 } } })
  })

  it('uses one login session while collecting multiple day slices in parallel', async () => {
    const adapter = new DomeggookAdapter({
      api_key: 'api-key',
      seller_id: 'seller-id',
      session_id: 'password',
    })

    await adapter.getOrders(new Date(Date.now() - 3 * 86_400_000))

    expect(createDomeggookClient).toHaveBeenCalledWith('api-key')
    expect(postDomeggookFormJson).toHaveBeenCalledTimes(1)
    expect(readDomeggookJson).toHaveBeenCalledTimes(3)
  })
})

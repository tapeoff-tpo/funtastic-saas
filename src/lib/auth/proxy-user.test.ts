import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { getProxyUser } from './proxy-user'

const mocks = vi.hoisted(() => ({ validate: vi.fn() }))
vi.mock('./local-session', () => ({ LOCAL_SESSION_COOKIE: 'funtastic_session', validateLocalSession: mocks.validate }))

describe('Proxy identity validation', () => {
  beforeEach(() => vi.clearAllMocks())
  it('validates the local session from the request cookie', async () => {
    mocks.validate.mockResolvedValue({ id: 'verified-staff-id' })
    const request = new NextRequest('https://app.example/orders', { headers: { cookie: 'funtastic_session=cookie-value' } })
    expect(await getProxyUser(request, NextResponse.next())).toEqual({ id: 'verified-staff-id' })
    expect(mocks.validate).toHaveBeenCalledWith('cookie-value')
  })
  it('never derives identity from an unverified cookie', async () => {
    mocks.validate.mockResolvedValue(null)
    expect(await getProxyUser(new NextRequest('https://app.example/orders'), NextResponse.next())).toBeNull()
    expect(mocks.validate).toHaveBeenCalledWith(undefined)
  })
})

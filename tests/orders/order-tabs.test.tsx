import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrderTabs } from '@/app/(auth)/orders/order-tabs'

let currentSearch = ''
const pushedUrls: string[] = []

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (url: string) => pushedUrls.push(url),
  }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

describe('OrderTabs', () => {
  beforeEach(() => {
    currentSearch = ''
    pushedUrls.length = 0
  })

  it('renders the mapping archive tab', () => {
    render(<OrderTabs />)

    expect(screen.getByText('보관')).toBeInTheDocument()
  })

  it('opens the mapping archive tab with all dates enabled', () => {
    currentSearch = 'status=new&page=3&dateFrom=2026-05-01&mapping=mapped'
    render(<OrderTabs />)

    fireEvent.click(screen.getByText('보관'))

    expect(pushedUrls).toHaveLength(1)
    const pushed = pushedUrls[0]
    expect(pushed).toContain('/orders?')
    expect(pushed).toContain('archive=mapping')
    expect(pushed).toContain('datePreset=all')
    expect(pushed).not.toContain('status=')
    expect(pushed).not.toContain('page=')
    expect(pushed).not.toContain('mapping=')
  })

  it('keeps the mapping archive tab active when archive=mapping is present', () => {
    currentSearch = 'archive=mapping'
    render(<OrderTabs />)

    expect(screen.getByText('보관')).toHaveClass('border-primary')
  })
})

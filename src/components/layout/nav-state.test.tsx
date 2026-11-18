import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
const search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  usePathname: () => '/operations/marketplace-registration',
  useSearchParams: () => search,
}))
vi.mock('./menu-access-provider', () => ({ useMenuAccess: () => ({ superAdmin: true, allowedMenus: null }) }))
import { NavStateProvider, useNavState } from './nav-state'
afterEach(() => { cleanup(); localStorage.clear() })

function Tabs() {
  const state = useNavState()
  return <>{state.tabs.map((tab) => <span key={tab.href}>{tab.label}</span>)}</>
}

it('updates the name of a previously saved inactive item tab', async () => {
  localStorage.setItem('funtastic-tabs', JSON.stringify([{ href: '/costs?search=112001', label: '품목리스트' }]))
  render(<NavStateProvider><Tabs /></NavStateProvider>)
  expect(await screen.findByText('품목·원가')).toBeVisible()
  expect(screen.queryByText('품목리스트')).not.toBeInTheDocument()
})

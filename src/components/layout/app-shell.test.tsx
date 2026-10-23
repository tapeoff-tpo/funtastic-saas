import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

vi.mock('./sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar">사이드바</aside>,
}))

vi.mock('./tab-bar', () => ({
  TabBar: () => <nav data-testid="tab-bar">탭</nav>,
}))

vi.mock('./nav-state', () => ({
  getRouteLabel: () => '대시보드',
  NavStateProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/purchasing-language-switcher', () => ({
  PurchasingLanguageSwitcher: () => <div data-testid="language-switcher">언어 전환</div>,
}))

describe('AppShell', () => {
  it('places all authenticated app chrome and route content inside the app translation boundary', () => {
    render(<AppShell><p>페이지 내용</p></AppShell>)

    const boundary = document.querySelector('[data-app-translate]')

    expect(boundary).toBeInTheDocument()
    expect(boundary).toContainElement(screen.getByTestId('sidebar'))
    expect(boundary).toContainElement(screen.getByTestId('tab-bar'))
    expect(boundary).toContainElement(screen.getByTestId('language-switcher'))
    expect(boundary).toContainElement(screen.getByText('페이지 내용'))
  })
})

export const SIDEBAR_MENU_ORDER_KEY = 'funtastic-sidebar-menu-order'
export const SIDEBAR_MENU_ORDER_EVENT = 'funtastic-sidebar-menu-order-changed'

export interface SidebarMenuOrder {
  sections: string[]
  items: Record<string, string[]>
}

export interface OrderableNavItem {
  href: string
}

export interface OrderableNavSection<TItem extends OrderableNavItem = OrderableNavItem> {
  id: string
  items: TItem[]
}

export function readSidebarMenuOrder(): SidebarMenuOrder | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_MENU_ORDER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SidebarMenuOrder>
    if (!Array.isArray(parsed.sections) || !parsed.items || typeof parsed.items !== 'object') return null
    return { sections: parsed.sections, items: parsed.items }
  } catch {
    return null
  }
}

export function saveSidebarMenuOrder(order: SidebarMenuOrder): void {
  localStorage.setItem(SIDEBAR_MENU_ORDER_KEY, JSON.stringify(order))
  window.dispatchEvent(new CustomEvent(SIDEBAR_MENU_ORDER_EVENT))
}

export async function saveSidebarMenuOrderRemote(order: SidebarMenuOrder): Promise<void> {
  const response = await fetch('/api/settings/menu-order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error ?? '메뉴 순서를 저장하지 못했습니다.')
  }
  saveSidebarMenuOrder(order)
}

export function clearSidebarMenuOrder(): void {
  localStorage.removeItem(SIDEBAR_MENU_ORDER_KEY)
  window.dispatchEvent(new CustomEvent(SIDEBAR_MENU_ORDER_EVENT))
}

export async function clearSidebarMenuOrderRemote(): Promise<void> {
  const response = await fetch('/api/settings/menu-order', { method: 'DELETE' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error ?? '기본 메뉴 순서로 복원하지 못했습니다.')
  }
  clearSidebarMenuOrder()
}

export async function fetchSidebarMenuOrder(): Promise<SidebarMenuOrder | null> {
  const response = await fetch('/api/settings/menu-order', { cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error ?? '메뉴 순서를 불러오지 못했습니다.')
  }
  const order = body.order as SidebarMenuOrder | null
  if (order) saveSidebarMenuOrder(order)
  return order
}

export function applySidebarMenuOrder<TItem extends OrderableNavItem, TSection extends OrderableNavSection<TItem>>(
  sections: TSection[],
  order: SidebarMenuOrder | null,
): TSection[] {
  if (!order) return sections.map((section) => ({ ...section, items: [...section.items] }))

  const sectionRank = new Map(order.sections.map((id, index) => [id, index]))
  const defaultSectionRank = new Map(sections.map((section, index) => [section.id, index]))
  return sections
    .map((section) => {
      const itemRank = new Map((order.items[section.id] ?? []).map((href, index) => [href, index]))
      const defaultItemRank = new Map(section.items.map((item, index) => [item.href, index]))
      return {
        ...section,
        items: [...section.items].sort((a, b) => (
          (itemRank.get(a.href) ?? Number.MAX_SAFE_INTEGER) - (itemRank.get(b.href) ?? Number.MAX_SAFE_INTEGER)
          || (defaultItemRank.get(a.href) ?? Number.MAX_SAFE_INTEGER) - (defaultItemRank.get(b.href) ?? Number.MAX_SAFE_INTEGER)
        )),
      }
    })
    .sort((a, b) => (
      (sectionRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (sectionRank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      || (defaultSectionRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (defaultSectionRank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    ))
}

export function createSidebarMenuOrder<TSection extends OrderableNavSection>(sections: TSection[]): SidebarMenuOrder {
  return {
    sections: sections.map((section) => section.id),
    items: Object.fromEntries(sections.map((section) => [section.id, section.items.map((item) => item.href)])),
  }
}

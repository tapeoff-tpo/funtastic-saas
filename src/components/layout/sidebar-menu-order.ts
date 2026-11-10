export const SIDEBAR_MENU_ORDER_KEY = 'funtastic-sidebar-menu-order'
export const SIDEBAR_MENU_ORDER_EVENT = 'funtastic-sidebar-menu-order-changed'
export const SIDEBAR_MENU_ORDER_VERSION = 4

export interface SidebarMenuOrder {
  version: number
  sections: string[]
  items: Record<string, string[]>
}

export interface OrderableNavItem {
  href: string
}

export interface OrderableNavSection<TItem extends OrderableNavItem = OrderableNavItem> {
  id: string
  items: TItem[]
  groups?: readonly unknown[]
}

export function canMoveSidebarItemAcrossSections(section: Pick<OrderableNavSection, 'id' | 'groups'>): boolean {
  return section.id !== 'dashboard' && !section.groups?.length
}

export function readSidebarMenuOrder(): SidebarMenuOrder | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_MENU_ORDER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SidebarMenuOrder>
    if (
      parsed.version !== SIDEBAR_MENU_ORDER_VERSION ||
      !Array.isArray(parsed.sections) ||
      parsed.sections.some((section) => typeof section !== 'string') ||
      !parsed.items ||
      typeof parsed.items !== 'object' ||
      Object.values(parsed.items).some((items) => !Array.isArray(items) || items.some((href) => typeof href !== 'string'))
    ) return null
    return { version: parsed.version, sections: parsed.sections, items: parsed.items }
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
  else clearSidebarMenuOrder()
  return order
}

export function moveSidebarEntry<T>(entries: T[], from: number, to: number): T[] {
  if (from < 0 || from >= entries.length || to < 0 || to >= entries.length || from === to) return entries
  const next = [...entries]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry)
  return next
}

export function applySidebarMenuOrder<TItem extends OrderableNavItem, TSection extends OrderableNavSection<TItem>>(
  sections: TSection[],
  order: SidebarMenuOrder | null,
): TSection[] {
  if (!order || order.version !== SIDEBAR_MENU_ORDER_VERSION) return sections.map((section) => ({ ...section, items: [...section.items] }))

  const sectionRank = new Map(order.sections.map((id, index) => [id, index]))
  const defaultSectionRank = new Map(sections.map((section, index) => [section.id, index]))
  const resolvedSectionRank = (sectionId: string): number =>
    sectionRank.get(sectionId) ?? defaultSectionRank.get(sectionId) ?? Number.MAX_SAFE_INTEGER
  const catalogue = new Map(sections.flatMap((section) => section.items.map((item) => [item.href, { item, section }] as const)))
  const destinations = new Map<string, string>()
  for (const section of sections) {
    if (!canMoveSidebarItemAcrossSections(section)) continue
    for (const href of order.items[section.id] ?? []) {
      const original = catalogue.get(href)?.section
      if (!original || original.id === section.id || !canMoveSidebarItemAcrossSections(original)) continue
      if ((order.items[original.id] ?? []).includes(href) || destinations.has(href)) continue
      destinations.set(href, section.id)
    }
  }
  return sections
    .map((section) => {
      const items: TItem[] = []
      const seen = new Set<string>()
      for (const href of order.items[section.id] ?? []) {
        const entry = catalogue.get(href)
        if (entry && (destinations.get(href) ?? entry.section.id) === section.id && !seen.has(href)) {
          items.push(entry.item)
          seen.add(href)
        }
      }
      items.push(...section.items.filter((item) => !seen.has(item.href) && !destinations.has(item.href)))
      return { ...section, items }
    })
    .sort((a, b) => (
      resolvedSectionRank(a.id) - resolvedSectionRank(b.id)
      || (defaultSectionRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (defaultSectionRank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    ))
}

export function createSidebarMenuOrder<TSection extends OrderableNavSection>(sections: TSection[]): SidebarMenuOrder {
  return {
    version: SIDEBAR_MENU_ORDER_VERSION,
    sections: sections.map((section) => section.id),
    items: Object.fromEntries(sections.map((section) => [section.id, section.items.map((item) => item.href)])),
  }
}

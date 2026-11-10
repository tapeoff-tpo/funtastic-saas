'use client'

import Link from 'next/link'
import { useIntentPrefetch } from './use-intent-prefetch'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { usePathname } from 'next/navigation'
import {
  ShoppingCart,
  ArrowRightLeft,
  Package,
  FolderTree,
  Truck,
  Upload,
  PackageX,
  Warehouse,
  BarChart3,
  Store,
  Users,
  LogOut,
  ChevronsLeft,
  Download,
  Star,
  Search,
  Headphones,
  MessageSquareText,
  Boxes,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  Bot,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  PanelsTopLeft,
  Sparkles,
  WalletCards,
  GripVertical,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { signOut } from '@/app/(auth)/actions'
import { useNavState } from './nav-state'
import { useMenuAccess } from './menu-access-provider'
import { canAccessPage } from '@/lib/auth/menu-permissions'
import {
  applySidebarMenuOrder,
  canMoveSidebarItemAcrossSections,
  createSidebarMenuOrder,
  fetchSidebarMenuOrder,
  moveSidebarEntry,
  readSidebarMenuOrder,
  saveSidebarMenuOrderRemote,
  SIDEBAR_MENU_ORDER_EVENT,
} from './sidebar-menu-order'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  id: string
  title: string
  items: NavItem[]
}

export interface NavSection {
  id: string
  title?: string
  items: NavItem[]
  groups?: NavGroup[]
  collapsible?: boolean
  defaultCollapsed?: boolean
}

const orderRelatedGroups: NavGroup[] = [
  {
    id: 'orders',
    title: '주문',
    items: [
      { href: '/orders', label: '전체 주문', icon: ShoppingCart },
      { href: '/orders/collect', label: '주문 수집', icon: Download },
      { href: '/shipping/held', label: '미발송 관리', icon: PackageX },
    ],
  },
  {
    id: 'cs',
    title: 'CS',
    items: [
      { href: '/cs', label: '상품검수/CS', icon: Headphones },
      { href: '/cs/inquiries', label: '문의', icon: MessageSquareText },
    ],
  },
  {
    id: 'shipping-work',
    title: '출고작업',
    items: [
      { href: '/shipping/scan', label: '바코드 스캔/출고', icon: Truck },
      { href: '/shipping/invoice', label: '송장 업로드 현황', icon: Upload },
    ],
  },
  {
    id: 'sabangnet-review',
    title: '사방넷 검수',
    items: [
      { href: '/analytics/sabangnet-review', label: '사방넷 검수', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'products',
    title: '상품',
    items: [
      { href: '/products', label: '상품 관리', icon: Package },
      { href: '/products/mapping', label: '매핑관리', icon: ArrowRightLeft },
      { href: '/products/mapping-codes', label: '매핑코드 마스터', icon: ArrowRightLeft },
      { href: '/products/marketplace-categories', label: '카테고리 매핑', icon: FolderTree },
      { href: '/inventory/adjustments', label: '입출고관리', icon: ArrowRightLeft },
    ],
  },
  {
    id: 'settings',
    title: '설정',
    items: [
      { href: '/settings/marketplaces', label: '마켓연동', icon: Store },
    ],
  },
]

export const navSections: NavSection[] = [
  {
    id: 'product-preparation',
    title: '소싱·상품 준비',
    items: [
      { href: '/new-products', label: '상품관리', icon: Sparkles },
      { href: '/operations/sourcing', label: '소싱', icon: Search },
    ],
  },
  {
    id: 'purchasing',
    title: '발주·입고',
    items: [
      { href: '/purchasing/purchases', label: '발주검토', icon: CreditCard },
      { href: '/purchasing/orders', label: '발주', icon: ClipboardList },
      { href: '/purchasing/payment-flow', label: '발주금액', icon: WalletCards },
      { href: '/purchasing/raw-data', label: '발주 로우데이터', icon: FileSpreadsheet },
      { href: '/purchasing/overdue', label: '구매/입고지연', icon: ClipboardList },
    ],
  },
  {
    id: 'inventory-flow',
    title: '중국재고·재고관리',
    items: [
      { href: '/purchasing/china-inventory', label: '중국재고', icon: Boxes },
      { href: '/purchasing/saas-china-inventory', label: '중국재고(SaaS)', icon: Boxes },
      { href: '/purchasing/china-shipments', label: '중국출고', icon: Truck },
      { href: '/inventory', label: '재고관리', icon: Warehouse },
      { href: '/outbound-reflection', label: '출고반영', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'pricing',
    title: '원가·판매가',
    items: [
      { href: '/costs', label: '원가', icon: Package },
      { href: '/analytics/price-table', label: '판매가 테이블', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'product-registration',
    title: '상세페이지·상품등록',
    items: [
      { href: '/operations/detail-pages', label: '상세페이지 제작', icon: PanelsTopLeft },
      { href: '/operations/marketplace-registration', label: '상품등록', icon: Package },
      { href: '/operations/coupang-registration', label: '쿠팡상품등록', icon: FileSpreadsheet },
      { href: '/operations/deal-calendar', label: '딜 캘린더', icon: CalendarDays },
    ],
  },
  {
    id: 'analytics',
    title: '매출분석',
    items: [
      { href: '/analytics/overview', label: '대시보드', icon: BarChart3 },
      { href: '/analytics/channels', label: '매출분석', icon: BarChart3 },
      { href: '/settings/market-settings', label: '설정', icon: Store },
      { href: '/analytics/settlements', label: '정산 캘린더', icon: CalendarDays },
      { href: '/analytics/rocket-outbound', label: '로켓배송/대량 매출', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'order-related',
    title: '주문관련',
    collapsible: true,
    defaultCollapsed: true,
    groups: orderRelatedGroups,
    items: orderRelatedGroups.flatMap((group) => group.items),
  },
  {
    id: 'operations',
    title: '운영',
    items: [
      { href: '/operations/ai-accounts', label: 'AI 계정공유', icon: Bot },
      { href: '/purchasing/quotes', label: '견적서', icon: FileSpreadsheet },
    ],
  },
  {
    id: 'admin',
    title: '관리자',
    items: [
      { href: '/admin/accounts', label: '계정관리', icon: Users },
    ],
  },
]

interface SidebarProps {
  onCollapse?: () => void
  onNavigate?: () => void
  mobile?: boolean
}

type MenuPosition = { sectionId: string; groupId?: string; href?: string; crossSection?: boolean }

function canDropMenu(source: MenuPosition, target: MenuPosition) {
  if (!source.href) return !target.href && source.sectionId !== target.sectionId
  if (source.sectionId === target.sectionId) {
    return Boolean(target.href && source.groupId === target.groupId && source.href !== target.href)
  }
  return Boolean(source.crossSection && target.crossSection)
}

const menuPositionKey = ({ sectionId, href }: MenuPosition) => href ?? sectionId
const sectionPosition = (section: NavSection): MenuPosition => ({
  sectionId: section.id,
  crossSection: canMoveSidebarItemAcrossSections(section),
})

export function Sidebar({ onCollapse, onNavigate, mobile = false }: SidebarProps = {}) {
  const pathname = usePathname()
  const intent = useIntentPrefetch()
  const { favorites, toggleFavorite, isFavorite } = useNavState()
  const access = useMenuAccess()
  const [orderedSections, setOrderedSections] = useState<NavSection[]>(navSections)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [orderReady, setOrderReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const dragged = useRef<MenuPosition | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const syncOrder = () => setOrderedSections(applySidebarMenuOrder(navSections, readSidebarMenuOrder()))
    syncOrder()
    void fetchSidebarMenuOrder()
      .then((order) => {
        if (mounted) {
          setOrderedSections(applySidebarMenuOrder(navSections, order))
          setOrderReady(true)
        }
      })
      .catch(() => {
        // Keep the local menu order if account-level settings cannot be loaded.
      })
    window.addEventListener(SIDEBAR_MENU_ORDER_EVENT, syncOrder)
    window.addEventListener('storage', syncOrder)
    return () => {
      mounted = false
      window.removeEventListener(SIDEBAR_MENU_ORDER_EVENT, syncOrder)
      window.removeEventListener('storage', syncOrder)
    }
  }, [])

  const visibleSections = orderedSections.map((section) => {
    const items = section.items.filter((item) => canAccessPage(access, item.href))
    return {
      ...section,
      items,
      groups: section.groups?.map((group) => {
        const groupHrefs = new Set(group.items.map((item) => item.href))
        return { ...group, items: items.filter((item) => groupHrefs.has(item.href)) }
      }).filter((group) => group.items.length),
    }
  }).filter((section) => section.items.length || (
    !mobile && canMoveSidebarItemAcrossSections(section)
    && navSections.find(({ id }) => id === section.id)?.items.some((item) => canAccessPage(access, item.href))
  ))
  const orderedNavItems = visibleSections.flatMap((section) => section.items)
  const favoriteItems = favorites
    .map((href) => orderedNavItems.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))
  const sortableSections = visibleSections.filter((section) => section.id !== 'dashboard')
  const sectionPositions = sortableSections.map(sectionPosition)
  const crossSectionCount = sectionPositions.filter((position) => position.crossSection).length

  async function reorder(source: MenuPosition, target: MenuPosition) {
    if (savingRef.current || mobile || !orderReady || !canDropMenu(source, target)) return
    const previous = orderedSections
    const from = previous.findIndex((section) => section.id === source.sectionId)
    const to = previous.findIndex((section) => section.id === target.sectionId)
    if (from < 0 || to < 0) return
    let next = previous
    if (source.href) {
      const item = previous[from].items.find((entry) => entry.href === source.href)
      if (!item) return
      const targetItems = previous[to].items
      const targetIndex = target.href ? targetItems.findIndex((entry) => entry.href === target.href) : targetItems.length
      if (targetIndex < 0) return
      if (from === to) {
        const items = moveSidebarEntry(targetItems, targetItems.indexOf(item), targetIndex)
        next = previous.map((section, index) => index === to ? { ...section, items } : section)
      } else {
        const items = [...targetItems]
        items.splice(targetIndex, 0, item)
        next = [...previous]
        next[from] = { ...previous[from], items: previous[from].items.filter((entry) => entry !== item) }
        next[to] = { ...previous[to], items }
      }
    } else next = moveSidebarEntry(previous, from, to)

    savingRef.current = true
    setSaving(true)
    setOrderedSections(next)
    try {
      await saveSidebarMenuOrderRemote(createSidebarMenuOrder(next))
    } catch (error) {
      setOrderedSections(previous)
      toast.error(error instanceof Error ? error.message : '메뉴 순서를 저장하지 못했습니다.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function clearDrag() {
    dragged.current = null
    setDropTarget(null)
  }

  function dropHandlers(position: MenuPosition) {
    return {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!dragged.current || !canDropMenu(dragged.current, position)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropTarget(menuPositionKey(position))
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setDropTarget((current) => current === menuPositionKey(position) ? null : current)
      },
      onDrop(event: DragEvent<HTMLElement>) {
        const source = dragged.current
        if (!source || !canDropMenu(source, position)) return
        event.preventDefault()
        clearDrag()
        void reorder(source, position)
      },
    }
  }

  function renderDragHandle(label: string, position: MenuPosition, positions: MenuPosition[]) {
    const canChangeCategory = position.href && position.crossSection && crossSectionCount > 1
    if (mobile || !orderReady || (positions.length < 2 && !canChangeCategory)) return null
    const description = `${label} 순서 변경`
    return (
      <button
        type="button"
        aria-label={description}
        title={`${description} · 드래그 또는 위아래 방향키`}
        aria-disabled={saving}
        draggable={!saving}
        onDragStart={(event) => {
          dragged.current = position
          intent.cancel()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', menuPositionKey(position))
        }}
        onDragEnd={clearDrag}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const index = positions.findIndex((entry) => menuPositionKey(entry) === menuPositionKey(position))
          const target = positions[index + (event.key === 'ArrowUp' ? -1 : 1)]
          if (target) void reorder(position, target)
        }}
        className="mr-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-gray-500 opacity-0 hover:bg-gray-700 hover:text-white focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100 aria-disabled:cursor-wait"
      >
        <GripVertical className="size-3.5" />
      </button>
    )
  }

  function isItemActive(href: string) {
    const itemPath = href.split('?')[0]
    if (itemPath === '/orders' || itemPath === '/cs' || itemPath === '/settings' || itemPath === '/products' || itemPath === '/inventory' || itemPath === '/analytics') {
      return pathname === itemPath
    }
    return pathname.startsWith(itemPath)
  }

  function isSectionActive(section: NavSection) {
    return section.items.some((item) => isItemActive(item.href))
  }

  function renderNavItem(item: NavItem, opts: { showStar: boolean; position?: MenuPosition; siblings?: MenuPosition[] }) {
    const Icon = item.icon
    const active = isItemActive(item.href)
    const fav = isFavorite(item.href)

    return (
      <div
        key={item.href}
        {...(opts.position ? dropHandlers(opts.position) : {})}
        className={`group flex items-center rounded transition-colors ${
          active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        } ${opts.position && dropTarget === item.href ? 'ring-1 ring-inset ring-sky-400' : ''}`}
      >
        <Link
          href={item.href}
          draggable={false}
          prefetch={false}
          onClick={() => onNavigate?.()}
          onMouseEnter={() => intent.prepare(item.href)}
          onFocus={() => intent.prepare(item.href)}
          onMouseLeave={intent.cancel}
          onBlur={intent.cancel}
          onTouchEnd={intent.cancel}
          onTouchStart={() => intent.prepare(item.href)}
          className={`flex min-w-0 flex-1 items-center font-medium ${
            mobile
              ? 'min-h-11 gap-3 px-3 py-2 text-sm'
              : 'gap-2 px-2 py-1 text-xs'
          }`}
        >
          <Icon className={mobile ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'} />
          <span className="min-w-0 whitespace-normal break-keep [overflow-wrap:anywhere]">{item.label}</span>
        </Link>
        {opts.position && opts.siblings && renderDragHandle(item.label, opts.position, opts.siblings)}
        {opts.showStar && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleFavorite(item.href)
            }}
            aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            className={`mr-1 flex items-center justify-center rounded transition-opacity hover:bg-gray-700 ${
              mobile ? 'h-10 w-10' : 'h-5 w-5'
            } ${
              fav || mobile ? 'text-yellow-400 opacity-100' : 'text-gray-500 opacity-0 group-hover:opacity-100'
            }`}
          >
            <Star className={`${mobile ? 'h-4 w-4' : 'h-3 w-3'} ${fav ? 'fill-yellow-400' : ''}`} />
          </button>
        )}
      </div>
    )
  }

  function renderSectionItems(section: NavSection) {
    function renderItems(items: NavItem[], groupId?: string) {
      const positions = items.map((item) => ({ ...sectionPosition(section), groupId, href: item.href }))
      return items.map((item, index) => renderNavItem(item, { showStar: true, position: positions[index], siblings: positions }))
    }
    if (!section.groups?.length) {
      return renderItems(section.items)
    }

    return section.groups.map((group) => (
      <div key={group.id} className="space-y-px">
        <p className={mobile ? 'px-3 pt-2 text-xs font-semibold text-gray-500' : 'px-2 pt-1 text-[9px] font-semibold text-gray-500'}>
          {group.title}
        </p>
        <div className="space-y-px">
          {renderItems(group.items, group.id)}
        </div>
      </div>
    ))
  }

  return (
    <aside className={`flex h-full flex-col bg-gray-900 text-white ${mobile ? 'w-full pt-[env(safe-area-inset-top)]' : 'w-48'}`}>
      <div className={`flex items-center justify-between border-b border-gray-800 px-3 ${mobile ? 'h-14 pr-12' : 'h-10'}`}>
        <div className="flex items-center gap-1.5">
          <span className={mobile ? 'text-base font-bold' : 'text-sm font-bold'}>Funtastic</span>
          <span className={mobile ? 'text-[10px] text-gray-500' : 'text-[9px] text-gray-500'}>v2.1</span>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="사이드바 접기"
            className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto ${mobile ? 'px-3 py-3' : 'px-2 py-1.5'}`}>
        <div className="space-y-px">
          {visibleSections.find((section) => section.id === 'dashboard')?.items.map((item) => renderNavItem(item, { showStar: false }))}
        </div>

        {favoriteItems.length > 0 && (
          <div className="mt-2">
            <p className={`mb-0.5 flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 ${mobile ? 'px-3 text-xs' : 'px-2 text-[9px]'}`}>
              <Star className={mobile ? 'h-3 w-3 fill-yellow-400 text-yellow-400' : 'h-2.5 w-2.5 fill-yellow-400 text-yellow-400'} />
              즐겨찾기
            </p>
            <div className="space-y-px">
              {favoriteItems.map((item) => renderNavItem(item, { showStar: true }))}
            </div>
          </div>
        )}

        {sortableSections.map((section) => {
          const sectionIsActive = isSectionActive(section)
          const sectionIsOpen = section.collapsible
            ? openSections[section.id] ?? (sectionIsActive || !section.defaultCollapsed)
            : true
          return (
          <div key={section.id} className="mt-2">
            {section.title && <div
              {...dropHandlers(sectionPosition(section))}
              className={`group flex items-center rounded ${dropTarget === section.id ? 'ring-1 ring-inset ring-sky-400' : ''}`}
            >
              {section.collapsible ? (
                <button
                  type="button"
                  onClick={() => setOpenSections((current) => ({
                    ...current,
                    [section.id]: !(current[section.id] ?? (sectionIsActive || !section.defaultCollapsed)),
                  }))}
                  className={`mb-0.5 flex w-full items-center justify-between rounded text-left font-semibold uppercase tracking-wider transition-colors ${
                    mobile ? 'min-h-10 px-3 py-2 text-xs' : 'px-2 py-0.5 text-[9px]'
                  } ${
                    sectionIsActive ? 'text-gray-300' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                  }`}
                >
                  <span>{section.title}</span>
                  {sectionIsOpen ? <ChevronDown className={mobile ? 'h-4 w-4' : 'h-3 w-3'} /> : <ChevronRight className={mobile ? 'h-4 w-4' : 'h-3 w-3'} />}
                </button>
              ) : (
                <p className={`mb-0.5 flex-1 font-semibold uppercase tracking-wider text-gray-500 ${mobile ? 'px-3 pt-2 text-xs' : 'px-2 text-[9px]'}`}>
                  {section.title}
                </p>
              )}
              {renderDragHandle(section.title, sectionPosition(section), sectionPositions)}
            </div>}
            {sectionIsOpen && (
              <div className="space-y-px">
                {renderSectionItems(section)}
              </div>
            )}
          </div>
          )
        })}
      </nav>

      <div className={`border-t border-gray-800 ${mobile ? 'px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3' : 'px-2 py-1.5'}`}>
        <form action={signOut}>
          <button
            type="submit"
            className={`flex w-full items-center gap-2 rounded font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white ${mobile ? 'min-h-11 px-3 py-2 text-sm' : 'px-2 py-1 text-xs'}`}
          >
          <LogOut className={mobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          로그아웃
          </button>
        </form>
      </div>
    </aside>
  )
}

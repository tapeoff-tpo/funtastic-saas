'use client'

import { Menu } from '@base-ui/react/menu'
import { ChevronDown, Download, Layers3, Package, Printer } from 'lucide-react'

type Props = {
  shipmentId: string
  kind: 'boxes' | 'pallets'
  enabled: boolean
  disabledReason: string
}

export function ShipmentLabelMenu({ shipmentId, kind, enabled, disabledReason }: Props) {
  const label = kind === 'boxes' ? '박스 쉽먼트' : '파렛트 쉽먼트'
  const Icon = kind === 'boxes' ? Package : Layers3
  const href = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/labels?type=${kind}`
  const itemClassName = 'flex min-h-9 items-center gap-2 rounded-md px-2.5 py-2 text-sm text-blue-900 outline-none hover:bg-blue-50 data-highlighted:bg-blue-50'

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        type="button"
        disabled={!enabled}
        title={!enabled ? disabledReason : undefined}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-3 text-sm font-medium text-white outline-none transition-colors hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon aria-hidden="true" className="size-4" />
        {label}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-50">
          <Menu.Popup aria-label={label} className="min-w-44 rounded-lg border border-blue-200 bg-white p-1.5 shadow-lg outline-none">
            <Menu.LinkItem
              href={href}
              aria-label={`${label} 일괄 다운로드`}
              closeOnClick
              className={itemClassName}
            >
              <Download aria-hidden="true" className="size-4" />
              엑셀 다운로드
            </Menu.LinkItem>
            <Menu.LinkItem
              href={`${href}&format=print`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${label} 바로 인쇄`}
              closeOnClick
              className={itemClassName}
            >
              <Printer aria-hidden="true" className="size-4" />
              바로 인쇄
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

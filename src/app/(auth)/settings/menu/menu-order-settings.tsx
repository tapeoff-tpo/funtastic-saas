'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { navSections, type NavSection } from '@/components/layout/sidebar'
import {
  applySidebarMenuOrder,
  clearSidebarMenuOrder,
  createSidebarMenuOrder,
  readSidebarMenuOrder,
  saveSidebarMenuOrder,
} from '@/components/layout/sidebar-menu-order'

function move<T>(values: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= values.length) return values
  const next = [...values]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MenuOrderSettings() {
  const [sections, setSections] = useState<NavSection[]>(() => applySidebarMenuOrder(navSections, readSidebarMenuOrder()))

  function moveSection(index: number, direction: -1 | 1) {
    if (sections[index]?.id === 'dashboard' || index + direction === 0) return
    setSections((current) => move(current, index, direction))
  }

  function moveItem(sectionId: string, index: number, direction: -1 | 1) {
    setSections((current) => current.map((section) => (
      section.id === sectionId ? { ...section, items: move(section.items, index, direction) } : section
    )))
  }

  function save() {
    saveSidebarMenuOrder(createSidebarMenuOrder(sections))
    toast.success('왼쪽 메뉴 순서를 저장했습니다.')
  }

  function reset() {
    clearSidebarMenuOrder()
    setSections(applySidebarMenuOrder(navSections, null))
    toast.success('기본 메뉴 순서로 복원했습니다.')
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 items-center gap-2 rounded border bg-white px-3 text-sm font-medium hover:bg-gray-50"
        >
          <RotateCcw className="h-4 w-4" />
          기본값 복원
        </button>
        <button
          type="button"
          onClick={save}
          className="inline-flex h-9 items-center gap-2 rounded bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Save className="h-4 w-4" />
          저장
        </button>
      </div>

      <div className="divide-y rounded border bg-white">
        {sections.map((section, sectionIndex) => (
          <section key={section.id} className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flex-1 text-sm font-semibold">{section.title ?? '대시보드'}</h2>
              {section.id !== 'dashboard' && (
                <OrderButtons
                  label={`${section.title} 그룹`}
                  index={sectionIndex - 1}
                  count={sections.length - 1}
                  onMove={(direction) => moveSection(sectionIndex, direction)}
                />
              )}
            </div>
            <div className="divide-y rounded border">
              {section.items.map((item, itemIndex) => {
                const Icon = item.icon
                return (
                  <div key={item.href} className="flex min-h-10 items-center gap-2 px-3">
                    <Icon className="h-4 w-4 text-gray-500" />
                    <span className="flex-1 text-sm">{item.label}</span>
                    <OrderButtons
                      label={item.label}
                      index={itemIndex}
                      count={section.items.length}
                      onMove={(direction) => moveItem(section.id, itemIndex, direction)}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function OrderButtons({
  label,
  index,
  count,
  onMove,
}: {
  label: string
  index: number
  count: number
  onMove: (direction: -1 | 1) => void
}) {
  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        title={`${label} 위로 이동`}
        aria-label={`${label} 위로 이동`}
        className="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-50 disabled:opacity-30"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        title={`${label} 아래로 이동`}
        aria-label={`${label} 아래로 이동`}
        className="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-50 disabled:opacity-30"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

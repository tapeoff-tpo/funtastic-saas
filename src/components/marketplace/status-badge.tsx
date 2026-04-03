'use client'

import type { ConnectionStatus } from '@/lib/marketplace/types'

const statusConfig: Record<
  ConnectionStatus,
  { label: string; dotClass: string; bgClass: string }
> = {
  connected: {
    label: '연결됨',
    dotClass: 'bg-green-500',
    bgClass: 'bg-green-100 text-green-800',
  },
  error: {
    label: '오류',
    dotClass: 'bg-red-500',
    bgClass: 'bg-red-100 text-red-800',
  },
  expired: {
    label: '만료됨',
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-100 text-amber-800',
  },
  disconnected: {
    label: '미연결',
    dotClass: 'bg-gray-400',
    bgClass: 'bg-gray-100 text-gray-600',
  },
}

interface StatusBadgeProps {
  status: ConnectionStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bgClass}`}
    >
      <span className={`h-2 w-2 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  )
}

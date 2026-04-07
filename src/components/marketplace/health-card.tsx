import type { ConnectionStatus } from '@/lib/marketplace/types'
import { StatusBadge } from './status-badge'
import { CollectButton } from './collect-button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface HealthCardProps {
  marketplaceId: string
  displayName: string
  status: ConnectionStatus
  lastCheckedAt: Date | null
  lastErrorMessage: string | null
  expiresAt: Date | null
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes < 1) return '방금 전'
  if (diffMinutes < 60) return `${diffMinutes}분 전`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}시간 전`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}일 전`
}

function isExpiringSoon(expiresAt: Date): boolean {
  const now = new Date()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return expiresAt.getTime() - now.getTime() < sevenDays
}

export function HealthCard({
  marketplaceId,
  displayName,
  status,
  lastCheckedAt,
  lastErrorMessage,
  expiresAt,
}: HealthCardProps) {
  const isDisconnected = status === 'disconnected'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{displayName}</CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            마지막 확인:{' '}
            {lastCheckedAt ? formatRelativeTime(lastCheckedAt) : '확인 안됨'}
          </p>
          {status === 'error' && lastErrorMessage && (
            <p className="text-red-600">
              {lastErrorMessage.length > 100
                ? `${lastErrorMessage.slice(0, 100)}...`
                : lastErrorMessage}
            </p>
          )}
          {expiresAt && isExpiringSoon(expiresAt) && (
            <p className="text-amber-600">
              인증 만료 예정: {expiresAt.toLocaleDateString('ko-KR')}
            </p>
          )}
        </div>

        <CollectButton
          marketplaceId={marketplaceId}
          displayName={displayName}
          disabled={isDisconnected}
        />
      </CardContent>
    </Card>
  )
}

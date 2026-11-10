import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { listChinaOutboundShipments } from '@/lib/purchasing/saas-china-outbound'
import { ImportDocumentsWorkspace } from './import-documents-workspace'

export const metadata: Metadata = { title: '인보이스·패킹리스트' }

export default async function ImportDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) return null
  const [params, workspaceUserId] = await Promise.all([searchParams, getWorkspaceUserId(user.id)])
  const shipments = await listChinaOutboundShipments(workspaceUserId)
  const selectedId = Array.isArray(params.shipment) ? params.shipment[0] : params.shipment
  const selected = shipments.find((shipment) => shipment.id === selectedId)

  return <div className="min-w-0 space-y-4">
    <h1 className="text-2xl font-semibold">인보이스·패킹리스트</h1>
    <ImportDocumentsWorkspace
      key={selected?.id ?? 'none'}
      selectedShipmentId={selected?.id ?? ''}
      invalidSelection={Boolean(selectedId && !selected)}
      shipments={shipments.map((shipment) => ({
        id: shipment.id,
        label: [
          shipment.displayName || shipment.shipmentNo,
          shipment.displayName ? shipment.shipmentNo : null,
          shipment.plannedOutboundDate,
          shipment.destinationName,
        ].filter(Boolean).join(' · '),
      }))}
    />
  </div>
}

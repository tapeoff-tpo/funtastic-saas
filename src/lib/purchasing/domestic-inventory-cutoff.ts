const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The browser can keep an inventory cutoff captured when the page first
 * rendered. A domestic-inventory upload performed from that page may make the
 * value stale before the purchasing request is sent. Prefer the timestamp of
 * the latest explicitly recorded successful inventory refresh; only use the
 * browser value for workspaces that do not have such an event yet.
 */
export function resolveDomesticInventoryReflectedThrough(input: {
  requestedDate: string
  latestSuccessfulRefreshAt: string | Date | null | undefined
}) {
  if (!input.latestSuccessfulRefreshAt) return input.requestedDate
  return seoulDateFormatter.format(new Date(input.latestSuccessfulRefreshAt))
}

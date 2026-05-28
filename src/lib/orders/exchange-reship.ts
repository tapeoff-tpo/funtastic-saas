export const EXCHANGE_RESHIP_MARKETPLACE_STATUS = '교환발송준비'

export function isExchangeReshipOrder(marketplaceStatus?: string | null): boolean {
  return marketplaceStatus?.trim() === EXCHANGE_RESHIP_MARKETPLACE_STATUS
}

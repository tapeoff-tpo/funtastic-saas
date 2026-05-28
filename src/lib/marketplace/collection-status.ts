export type MarketplaceCollectionStatus =
  | 'new'
  | 'ready'
  | 'shipping'
  | 'delivered'
  | 'cancelled'
  | 'claim'
  | 'unknown'

export const MARKETPLACE_COLLECTION_STATUS_LABELS: Record<MarketplaceCollectionStatus, string> = {
  new: '\uc2e0\uaddc',
  ready: '\ubc30\uc1a1\uc900\ube44',
  shipping: '\ubc30\uc1a1\uc911',
  delivered: '\ubc30\uc1a1\uc644\ub8cc',
  cancelled: '\ucde8\uc18c',
  claim: '\ud074\ub808\uc784',
  unknown: '\ubbf8\ubd84\ub958',
}

const NEW_STATUS_RE = /\uacb0\uc81c\uc644\ub8cc|\uc2e0\uaddc|\uc2e0\uaddc\uc8fc\ubb38|\uc8fc\ubb38\uc811\uc218|\uc8fc\ubb38\ud1b5\ubcf4|\ubc1c\uc8fc\uc694\uccad|\ubc1c\uc8fc\uc804|PAYED|PAID|NEW|ORDERED/i
const READY_STATUS_RE = /\ubc30\uc1a1\uc900\ube44|\ubc30\uc1a1\uc900\ube44\uc911|\ubc1c\uc1a1\ub300\uc0c1|\ucd9c\uace0\uc900\ube44|\uc0c1\ud488\uc900\ube44|\uc0c1\ud488\uc900\ube44\uc911|\uc8fc\ubb38\ud655\uc778|\ubc1c\uc8fc\ud655\uc778|INSTRUCT|READY|PREPAR/i
const SHIPPING_STATUS_RE = /\ubc30\uc1a1\uc911|\ubc1c\uc1a1\uc644\ub8cc|\ucd9c\uace0\uc644\ub8cc|\uc1a1\uc7a5|SHIPPED|DELIVERING/i
const DELIVERED_STATUS_RE = /\ubc30\uc1a1\uc644\ub8cc|\uad6c\ub9e4\ud655\uc815|DELIVERED|COMPLETED/i
const CANCELLED_STATUS_RE = /\ucde8\uc18c|CANCEL/i
const CLAIM_STATUS_RE = /\ubc18\ud488|\uad50\ud658|\ud658\ubd88|\ud074\ub808\uc784|CLAIM|RETURN|EXCHANGE|REFUND/i

export function normalizeMarketplaceCollectionStatus(
  status: string | null | undefined,
): MarketplaceCollectionStatus | null {
  const text = status?.replace(/\s+/g, '').trim()
  if (!text) return null

  // Match paid/new before generic completed wording so "결제완료" is not delivered.
  if (NEW_STATUS_RE.test(text)) return 'new'
  if (READY_STATUS_RE.test(text)) return 'ready'
  if (SHIPPING_STATUS_RE.test(text)) return 'shipping'
  if (DELIVERED_STATUS_RE.test(text)) return 'delivered'
  if (CANCELLED_STATUS_RE.test(text)) return 'cancelled'
  if (CLAIM_STATUS_RE.test(text)) return 'claim'

  return 'unknown'
}

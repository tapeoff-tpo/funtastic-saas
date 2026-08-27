import type { ManualSourcingItem, SourcingMeeting } from '@/lib/operations/sourcing'

export const SOURCING_SEARCH_RESULT_LIMIT = 100

const reviewStatusSearchTerms: Record<ManualSourcingItem['status'], string> = {
  pending: '진행 전 진행전 대기',
  passed: '통과 승인',
  rejected: '탈락 반려',
  hold: '보류',
}

export type SourcingSearchResult = {
  meeting: SourcingMeeting
  item: ManualSourcingItem
}

export function searchSourcingItems(
  meetings: SourcingMeeting[],
  query: string,
  activeOwnerId: string | null,
): SourcingSearchResult[] {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (terms.length === 0) return []

  const results: SourcingSearchResult[] = []

  for (const meeting of meetings) {
    for (const item of meeting.items) {
      if (activeOwnerId && item.ownerOperatorId !== activeOwnerId) continue

      const searchableText = normalizeSearchText([
        meeting.title,
        meeting.meetingDate,
        item.productName,
        item.productOption,
        ...item.options.map((option) => option.name),
        item.ownerName,
        item.chinaPurchaseUrl,
        item.domesticSaleUrl,
        item.detailPageUrl,
        item.memo1,
        item.memo2,
        reviewStatusSearchTerms[item.status],
      ].filter((value): value is string => Boolean(value)).join(' '))

      if (terms.every((term) => searchableText.includes(term))) {
        results.push({ meeting, item })
      }
    }
  }

  return results
}

export function sourcingOptionSummary(item: ManualSourcingItem) {
  const options = [item.productOption, ...item.options.map((option) => option.name)]
    .map((option) => option?.trim())
    .filter((option): option is string => Boolean(option))

  return [...new Set(options)].join(' · ')
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ')
}

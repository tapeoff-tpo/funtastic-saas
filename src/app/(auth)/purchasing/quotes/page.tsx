import QuoteWorkspace from './quote-workspace'

/**
 * 운영 > 견적서의 전체 영업·견적 작업 공간.
 * 인증과 메뉴 권한은 상위 (auth) layout에서 유지하고, 데이터 요청은
 * workspace API에서 다시 검증한다.
 */
export default function QuotesPage() {
  return <QuoteWorkspace />
}

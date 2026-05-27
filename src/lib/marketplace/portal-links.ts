export type MarketplacePortalLink = {
  href: string
  label?: string
}

export const MARKETPLACE_PORTAL_LINKS: Record<string, MarketplacePortalLink> = {
  '10x10': { href: 'https://scm.10x10.co.kr' },
  ably: { href: 'https://seller.a-bly.com' },
  always: { href: 'https://alwayzseller.ilevit.com' },
  auction: { href: 'https://www.esmplus.com/Home/Login' },
  'banana-b2b': { href: 'https://store.bananab2b.shop/login' },
  cafe24: { href: 'https://eclogin.cafe24.com/Shop/' },
  cjonestyle: { href: 'https://partners.cjonstyle.com' },
  coupang: { href: 'https://wing.coupang.com' },
  domechango: { href: 'https://www.wholesaledepot.co.kr/wms/login' },
  domeggook: { href: 'https://domeggook.com/main/member/mem_loginForm.php' },
  domesin: { href: 'https://domesin.com/scm/login.html' },
  elevenst: { href: 'https://soffice.11st.co.kr' },
  esm: { href: 'https://www.esmplus.com/Home/Login' },
  'funtastic-b2b': { href: 'https://funtasticb2b.com' },
  gmarket: { href: 'https://www.esmplus.com/Home/Login' },
  'gs-shop': { href: 'https://partners.gsshop.com/sign-in' },
  'hyundai-hmall': { href: 'https://scm.hmall.com' },
  'kakao-gift': { href: 'https://gift-sell.kakao.com' },
  'kakao-store': { href: 'https://shopping-sell.kakao.com' },
  naver: { href: 'https://sell.smartstore.naver.com' },
  nsmall: { href: 'https://partners.nsmall.com' },
  ohouse: { href: 'https://orora.ohou.se/signin?redirectUrl=%2F' },
  onchannel: { href: 'https://www.onch3.co.kr/login/login_web.php' },
  ownerclan: { href: 'https://ownerclan.com' },
  'playauto-emp': { href: 'https://emp.playauto.co.kr' },
  ssgmall: { href: 'https://po.ssgadm.com' },
  specialoffer: { href: 'https://specialoffer.kr' },
  tobizon: { href: 'https://tobizon.co.kr/mall/member/login.php?ltype=vender' },
  'toss-shopping': { href: 'https://partners-shopping.toss.im' },
  zigzag: { href: 'https://partner.kakaostyle.com' },
}

export function getMarketplacePortalLink(marketplaceId: string): MarketplacePortalLink | null {
  return MARKETPLACE_PORTAL_LINKS[marketplaceId] ?? null
}

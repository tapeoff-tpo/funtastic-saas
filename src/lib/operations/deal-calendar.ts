import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealEvents } from '@/lib/db/schema'

export const DEAL_TYPE_LABELS: Record<string, string> = { today: '오늘의딜', one_plus_one: '1+1톡딜', under_10000: '만원톡딜', promotion: '프로모션', ad_campaign: '광고 캠페인', promotion_application: '프로모션 신청' }
export const DEAL_STATUS_LABELS: Record<string, string> = { draft: '작성 중', application_pending: '신청 대기', submitted: '제안 완료', applied: '신청 완료', selected: '선정', setup_complete: '설정 완료', live: '진행 중', ended: '종료', rejected: '미선정' }
export const DEAL_PLATFORM_LABELS: Record<string, string> = { kakao: '카카오', '10x10': '텐바이텐', '11st': '11번가', other: '기타' }

export type DealChecklistItem = { key: string; label: string; completed: boolean }

export const DEFAULT_DEAL_CHECKLIST: DealChecklistItem[] = [
  { key: 'product', label: '상품 선정', completed: false },
  { key: 'discount', label: '할인율·판매가 설정', completed: false },
  { key: 'stock', label: '재고·출고량 확인', completed: false },
  { key: 'creative', label: '상세페이지·배너 준비', completed: false },
  { key: 'application', label: '판매자센터 신청', completed: false },
  { key: 'restore', label: '행사 종료 후 가격 복구', completed: false },
]

export const AD_CAMPAIGN_CHECKLIST: DealChecklistItem[] = [
  { key: 'product', label: '광고 상품 선정', completed: false },
  { key: 'creative', label: '상품명·대표이미지 점검', completed: false },
  { key: 'bid', label: '입찰가·일 예산 설정', completed: false },
  { key: 'launch', label: '캠페인 ON 확인', completed: false },
  { key: 'performance', label: '노출·클릭·전환 성과 확인', completed: false },
  { key: 'close', label: '종료·연장 여부 결정', completed: false },
]

export const PROMOTION_APPLICATION_CHECKLIST: DealChecklistItem[] = [
  { key: 'product', label: '신청 상품 선정', completed: false },
  { key: 'price', label: '가격·배송 조건 확인', completed: false },
  { key: 'application', label: '판매자센터 신청 제출', completed: false },
  { key: 'result', label: '신청 결과 확인', completed: false },
]

function checklistTemplate(dealType?: string) {
  if (dealType === 'ad_campaign') return AD_CAMPAIGN_CHECKLIST
  if (dealType === 'promotion_application') return PROMOTION_APPLICATION_CHECKLIST
  return DEFAULT_DEAL_CHECKLIST
}

export function normalizeDealChecklist(value: unknown, dealType?: string): DealChecklistItem[] {
  const saved = Array.isArray(value) ? value : []
  return checklistTemplate(dealType).map((item) => {
    const match = saved.find((candidate) => candidate && typeof candidate === 'object' && 'key' in candidate && candidate.key === item.key)
    return { ...item, completed: Boolean(match && 'completed' in match && match.completed) }
  })
}

export async function ensureDealCalendarTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "deal_events" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "platform" varchar(30) NOT NULL DEFAULT 'kakao', "deal_type" varchar(30) NOT NULL, "title" text NOT NULL, "product_id" varchar(100), "product_code" varchar(100), "options" text, "regular_price" integer, "deal_price" integer NOT NULL, "unit_cost" integer, "shipping_cost" integer NOT NULL DEFAULT 0, "stock" integer NOT NULL DEFAULT 500, "daily_capacity" integer NOT NULL DEFAULT 500, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "application_starts_on" date, "application_ends_on" date, "minimum_discount_rate" integer, "applied_product_count" integer, "discount_code" varchar(50), "external_promotion_id" varchar(50), "source_key" varchar(100), "status" varchar(30) NOT NULL DEFAULT 'draft', "contact" varchar(50), "notes" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now())`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "platform" varchar(30) NOT NULL DEFAULT 'kakao'`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "application_starts_on" date`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "application_ends_on" date`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "minimum_discount_rate" integer`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "applied_product_count" integer`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "discount_code" varchar(50)`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "external_promotion_id" varchar(50)`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "campaign_name" varchar(100)`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "daily_budget" integer`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "search_bid" integer`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "recommendation_bid" integer`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "source_key" varchar(100)`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "sold_quantity" integer NOT NULL DEFAULT 0`)
  await db.execute(sql`ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "sales_amount" integer NOT NULL DEFAULT 0`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "deal_events_user_date_idx" ON "deal_events" ("user_id", "starts_on")`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "deal_events_user_source_key_uniq" ON "deal_events" ("user_id", "source_key") WHERE "source_key" IS NOT NULL`)
}

export async function seedDealCalendar(userId: string) {
  await ensureDealCalendarTable()
  const existing = await db.select({ id: dealEvents.id }).from(dealEvents).where(eq(dealEvents.userId, userId)).limit(1)
  if (!existing.length) {
    await db.insert(dealEvents).values([
      { userId, platform: 'kakao', dealType: 'today', title: '차량용 듀얼 선풍기', productId: '761182274', productCode: '112304-0001', regularPrice: 12900, dealPrice: 9900, startsOn: '2026-07-27', endsOn: '2026-08-02', status: 'submitted', contact: '010-5344-9024', notes: '17시 시작 · 79시간 톡딜할인 · 무료배송 설정' },
      { userId, platform: 'kakao', dealType: 'one_plus_one', title: '[1+1] 스테인리스 캔맥주 보냉 캔쿨러 2개 세트', productId: '763754981', productCode: '112261-0001-11', options: '실버+실버 / 블랙+블랙 / 실버+블랙 / 실버+로즈골드 / 블랙+로즈골드 / 로즈골드+로즈골드', regularPrice: 19800, dealPrice: 15900, unitCost: 9688, shippingCost: 3000, startsOn: '2026-07-27', endsOn: '2026-08-02', status: 'submitted', contact: '010-5344-9024', notes: '1+1 옵션 구성 확인 · 무료배송 설정' },
      { userId, platform: 'kakao', dealType: 'under_10000', title: '스테인리스 캔맥주 보냉 캔쿨러 단품', productId: '756998187', productCode: '112261-0001', regularPrice: 9900, dealPrice: 9500, unitCost: 4844, shippingCost: 3000, startsOn: '2026-07-27', endsOn: '2026-08-02', status: 'submitted', contact: '010-5344-9024', notes: '만원 이하 · 무료배송 설정' },
    ])
  }

  await db.insert(dealEvents).values([
    { userId, platform: '10x10', dealType: 'promotion', title: '7월 셋째 주 연휴특가', dealPrice: 0, applicationStartsOn: '2026-07-02', applicationEndsOn: '2026-07-14', startsOn: '2026-07-16', endsOn: '2026-07-19', minimumDiscountRate: 10, appliedProductCount: 10, discountCode: '246639', externalPromotionId: '42', sourceKey: '10x10:promotion:42', status: 'applied', notes: '텐바이텐 판매자센터 신청 완료' },
    { userId, platform: '10x10', dealType: 'promotion', title: '신학기 기획전 참여 모집', dealPrice: 0, applicationStartsOn: '2026-07-13', applicationEndsOn: '2026-07-29', startsOn: '2026-08-03', endsOn: '2026-08-24', minimumDiscountRate: 15, appliedProductCount: 3, discountCode: '246642', externalPromotionId: '45', sourceKey: '10x10:promotion:45', status: 'applied', notes: '텐바이텐 판매자센터 신청 완료' },
    { userId, platform: '10x10', dealType: 'promotion', title: '8월 할인 신청', dealPrice: 0, applicationStartsOn: '2026-07-01', applicationEndsOn: '2026-07-31', startsOn: '2026-08-15', endsOn: '2026-08-15', minimumDiscountRate: 10, appliedProductCount: 17, discountCode: '246639', externalPromotionId: '38', sourceKey: '10x10:promotion:38', status: 'applied', notes: '텐바이텐 판매자센터 신청 완료' },
    { userId, platform: '10x10', dealType: 'promotion', title: '8월 텐일페', dealPrice: 0, applicationStartsOn: '2026-04-24', applicationEndsOn: '2026-08-09', startsOn: '2026-08-18', endsOn: '2026-08-31', minimumDiscountRate: 5, appliedProductCount: 4, discountCode: '246645', externalPromotionId: '21', sourceKey: '10x10:promotion:21', status: 'applied', notes: '텐바이텐 판매자센터 신청 완료' },
  ]).onConflictDoNothing()
}

export async function listDealEvents(userId: string) { await seedDealCalendar(userId); return db.select().from(dealEvents).where(eq(dealEvents.userId, userId)).orderBy(asc(dealEvents.startsOn), asc(dealEvents.createdAt)) }
export async function updateDealStatus(userId: string, id: string, status: string) { await ensureDealCalendarTable(); return db.update(dealEvents).set({ status, updatedAt: new Date() }).where(and(eq(dealEvents.userId, userId), eq(dealEvents.id, id))) }
export async function createDealEvent(input: typeof dealEvents.$inferInsert) { await ensureDealCalendarTable(); return db.insert(dealEvents).values(input) }

export async function updateDealPerformance(userId: string, id: string, soldQuantity: number, salesAmount: number) {
  await ensureDealCalendarTable()
  const safeQuantity = Number.isFinite(soldQuantity) ? Math.max(0, Math.round(soldQuantity)) : 0
  const safeSalesAmount = Number.isFinite(salesAmount) ? Math.max(0, Math.round(salesAmount)) : 0
  return db.update(dealEvents)
    .set({ soldQuantity: safeQuantity, salesAmount: safeSalesAmount, updatedAt: new Date() })
    .where(and(eq(dealEvents.userId, userId), eq(dealEvents.id, id)))
}

export async function updateDealChecklist(userId: string, id: string, taskKey: string, completed: boolean) {
  await ensureDealCalendarTable()
  if (!DEFAULT_DEAL_CHECKLIST.some((item) => item.key === taskKey)) return
  const [event] = await db.select({ checklist: dealEvents.checklist, dealType: dealEvents.dealType }).from(dealEvents).where(and(eq(dealEvents.userId, userId), eq(dealEvents.id, id))).limit(1)
  if (!event) return
  const checklist = normalizeDealChecklist(event.checklist, event.dealType).map((item) => item.key === taskKey ? { ...item, completed } : item)
  return db.update(dealEvents).set({ checklist, updatedAt: new Date() }).where(and(eq(dealEvents.userId, userId), eq(dealEvents.id, id)))
}

import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealEvents } from '@/lib/db/schema'

export const DEAL_TYPE_LABELS: Record<string, string> = { today: '오늘의딜', one_plus_one: '1+1톡딜', under_10000: '만원톡딜' }
export const DEAL_STATUS_LABELS: Record<string, string> = { draft: '작성 중', submitted: '제안 완료', selected: '선정', setup_complete: '설정 완료', live: '진행 중', ended: '종료', rejected: '미선정' }

export async function ensureDealCalendarTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "deal_events" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "deal_type" varchar(30) NOT NULL, "title" text NOT NULL, "product_id" varchar(100), "product_code" varchar(100), "options" text, "regular_price" integer, "deal_price" integer NOT NULL, "unit_cost" integer, "shipping_cost" integer NOT NULL DEFAULT 0, "stock" integer NOT NULL DEFAULT 500, "daily_capacity" integer NOT NULL DEFAULT 500, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "status" varchar(30) NOT NULL DEFAULT 'draft', "contact" varchar(50), "notes" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now())`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "deal_events_user_date_idx" ON "deal_events" ("user_id", "starts_on")`)
}

export async function seedDealCalendar(userId: string) {
  await ensureDealCalendarTable()
  const existing = await db.select({ id: dealEvents.id }).from(dealEvents).where(eq(dealEvents.userId, userId)).limit(1)
  if (existing.length) return
  await db.insert(dealEvents).values([
    { userId, dealType: 'today', title: '차량용 듀얼 선풍기', productId: '761182274', productCode: '112304-0001', regularPrice: 12900, dealPrice: 9900, startsOn: '2026-07-27', endsOn: '2026-08-02', status: 'submitted', contact: '010-5344-9024', notes: '17시 시작 · 79시간 톡딜할인 · 무료배송 설정' },
    { userId, dealType: 'one_plus_one', title: '[1+1] 스테인리스 캔맥주 보냉 캔쿨러 2개 세트', productId: '763754981', productCode: '112261-0001-11', options: '실버+실버 / 블랙+블랙 / 실버+블랙 / 실버+로즈골드 / 블랙+로즈골드 / 로즈골드+로즈골드', regularPrice: 19800, dealPrice: 15900, unitCost: 9688, shippingCost: 3000, startsOn: '2026-07-27', endsOn: '2026-08-02', status: 'submitted', contact: '010-5344-9024', notes: '1+1 옵션 구성 확인 · 무료배송 설정' },
    { userId, dealType: 'under_10000', title: '스테인리스 캔맥주 보냉 캔쿨러 단품', productId: '756998187', productCode: '112261-0001', regularPrice: 9900, dealPrice: 9500, unitCost: 4844, shippingCost: 3000, startsOn: '2026-07-27', endsOn: '2026-08-02', status: 'submitted', contact: '010-5344-9024', notes: '만원 이하 · 무료배송 설정' },
  ])
}

export async function listDealEvents(userId: string) { await seedDealCalendar(userId); return db.select().from(dealEvents).where(eq(dealEvents.userId, userId)).orderBy(asc(dealEvents.startsOn), asc(dealEvents.createdAt)) }
export async function updateDealStatus(userId: string, id: string, status: string) { await ensureDealCalendarTable(); return db.update(dealEvents).set({ status, updatedAt: new Date() }).where(and(eq(dealEvents.userId, userId), eq(dealEvents.id, id))) }
export async function createDealEvent(input: typeof dealEvents.$inferInsert) { await ensureDealCalendarTable(); return db.insert(dealEvents).values(input) }

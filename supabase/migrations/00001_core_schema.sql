-- ============================================================
-- funtastic-saas: 멀티몰 통합 관리 핵심 스키마
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 0. 확장 활성화
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. sellers (셀러/회원)
-- ============================================================
create table public.sellers (
  id            uuid primary key default uuid_generate_v4(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  company_name  text not null,
  owner_name    text not null,
  biz_number    text,                   -- 사업자등록번호
  phone         text,
  email         text,
  plan          text not null default 'free' check (plan in ('free','basic','pro','enterprise')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.sellers is '셀러(회원) 마스터';

-- ============================================================
-- 2. channels (연동 쇼핑몰)
-- ============================================================
create type public.channel_platform as enum (
  'coupang',          -- 쿠팡
  'smartstore',       -- 네이버 스마트스토어
  'esm',              -- ESM (G마켓/옥션)
  'eleven_st',        -- 11번가
  'tmon',             -- 티몬
  'wemakeprice',      -- 위메프
  'lotteon',          -- 롯데온
  'interpark',        -- 인터파크
  'cafe24',           -- 카페24 자사몰
  'shopify',          -- Shopify
  'other'
);

create table public.channels (
  id            uuid primary key default uuid_generate_v4(),
  seller_id     uuid not null references public.sellers(id) on delete cascade,
  platform      public.channel_platform not null,
  channel_name  text not null,                  -- 셀러가 지정하는 별칭
  api_key       text,                           -- 암호화 저장 권장
  api_secret    text,
  credentials   jsonb default '{}'::jsonb,      -- 플랫폼별 추가 인증 정보
  is_active     boolean not null default true,
  last_synced_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.channels is '셀러별 연동 쇼핑몰 채널';

-- ============================================================
-- 3. products (상품 마스터)
-- ============================================================
create table public.products (
  id              uuid primary key default uuid_generate_v4(),
  seller_id       uuid not null references public.sellers(id) on delete cascade,
  sku             text not null,
  name            text not null,
  barcode         text,
  brand           text,
  category        text,
  description     text,
  base_price      integer not null default 0,       -- 기준 판매가 (원)
  cost_price      integer not null default 0,       -- 원가
  weight_g        integer,                           -- 무게(g)
  images          jsonb default '[]'::jsonb,         -- URL 배열
  options         jsonb default '[]'::jsonb,         -- 옵션(색상/사이즈 등)
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (seller_id, sku)
);

comment on table public.products is '셀러별 상품 마스터';

-- ============================================================
-- 4. product_channels (쇼핑몰별 상품 등록 현황)
-- ============================================================
create type public.product_channel_status as enum (
  'draft',        -- 등록 준비 중
  'pending',      -- 등록 요청됨
  'listed',       -- 판매 중
  'paused',       -- 판매 일시중지
  'rejected',     -- 등록 반려
  'deleted'       -- 삭제됨
);

create table public.product_channels (
  id                uuid primary key default uuid_generate_v4(),
  product_id        uuid not null references public.products(id) on delete cascade,
  channel_id        uuid not null references public.channels(id) on delete cascade,
  seller_id         uuid not null references public.sellers(id) on delete cascade,
  remote_product_id text,                              -- 쇼핑몰측 상품 ID
  status            public.product_channel_status not null default 'draft',
  sell_price        integer not null default 0,        -- 채널별 판매가
  channel_data      jsonb default '{}'::jsonb,         -- 채널 전용 메타
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (product_id, channel_id)
);

comment on table public.product_channels is '상품-채널 매핑 (쇼핑몰별 등록 현황)';

-- ============================================================
-- 5. inventory (재고)
-- ============================================================
create table public.inventory (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references public.products(id) on delete cascade,
  seller_id       uuid not null references public.sellers(id) on delete cascade,
  warehouse       text not null default 'default',    -- 창고 구분
  quantity        integer not null default 0 check (quantity >= 0),
  safety_stock    integer not null default 0,         -- 안전재고
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (product_id, warehouse)
);

comment on table public.inventory is '상품별 재고';

-- ============================================================
-- 6. orders (주문 통합)
-- ============================================================
create type public.order_status as enum (
  'new',                -- 신규 주문
  'confirmed',          -- 주문 확인
  'preparing',          -- 상품 준비 중
  'shipping',           -- 배송 중
  'delivered',          -- 배송 완료
  'cancel_requested',   -- 취소 요청
  'cancelled',          -- 취소 완료
  'return_requested',   -- 반품 요청
  'returned',           -- 반품 완료
  'exchange_requested', -- 교환 요청
  'exchanged'           -- 교환 완료
);

create table public.orders (
  id                  uuid primary key default uuid_generate_v4(),
  seller_id           uuid not null references public.sellers(id) on delete cascade,
  channel_id          uuid not null references public.channels(id) on delete cascade,
  remote_order_id     text,                                -- 쇼핑몰측 주문번호
  status              public.order_status not null default 'new',

  -- 주문자 정보
  buyer_name          text,
  buyer_phone         text,
  buyer_email         text,

  -- 수령자 정보
  receiver_name       text,
  receiver_phone      text,
  receiver_zipcode    text,
  receiver_address    text,
  receiver_message    text,

  -- 금액
  total_amount        integer not null default 0,
  shipping_fee        integer not null default 0,
  discount_amount     integer not null default 0,

  -- 배송
  courier             text,                                -- 택배사
  tracking_number     text,
  shipped_at          timestamptz,
  delivered_at        timestamptz,

  ordered_at          timestamptz not null default now(),   -- 원래 주문 시각
  channel_data        jsonb default '{}'::jsonb,           -- 채널 전용 원본
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.orders is '통합 주문';

-- 주문 상품 라인
create table public.order_items (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  seller_id       uuid not null references public.sellers(id) on delete cascade,
  sku             text,
  product_name    text not null,
  option_info     text,
  quantity        integer not null default 1,
  unit_price      integer not null default 0,
  total_price     integer not null default 0,
  created_at      timestamptz not null default now()
);

comment on table public.order_items is '주문 상품 라인';

-- ============================================================
-- 인덱스
-- ============================================================
create index idx_channels_seller        on public.channels(seller_id);
create index idx_products_seller        on public.products(seller_id);
create index idx_product_channels_prod  on public.product_channels(product_id);
create index idx_product_channels_ch    on public.product_channels(channel_id);
create index idx_inventory_product      on public.inventory(product_id);
create index idx_orders_seller          on public.orders(seller_id);
create index idx_orders_channel         on public.orders(channel_id);
create index idx_orders_status          on public.orders(status);
create index idx_orders_ordered_at      on public.orders(ordered_at desc);
create index idx_order_items_order      on public.order_items(order_id);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_sellers_updated_at         before update on public.sellers          for each row execute function public.set_updated_at();
create trigger trg_channels_updated_at        before update on public.channels         for each row execute function public.set_updated_at();
create trigger trg_products_updated_at        before update on public.products         for each row execute function public.set_updated_at();
create trigger trg_product_channels_updated_at before update on public.product_channels for each row execute function public.set_updated_at();
create trigger trg_inventory_updated_at       before update on public.inventory        for each row execute function public.set_updated_at();
create trigger trg_orders_updated_at          before update on public.orders           for each row execute function public.set_updated_at();

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

-- 헬퍼: 현재 로그인 유저의 seller_id 반환
create or replace function public.get_my_seller_id()
returns uuid as $$
  select id from public.sellers where auth_user_id = auth.uid();
$$ language sql security definer stable;

-- sellers
alter table public.sellers enable row level security;

create policy "sellers: 본인 조회"
  on public.sellers for select
  using (auth_user_id = auth.uid());

create policy "sellers: 본인 수정"
  on public.sellers for update
  using (auth_user_id = auth.uid());

-- channels
alter table public.channels enable row level security;

create policy "channels: 본인 채널 전체"
  on public.channels for all
  using (seller_id = public.get_my_seller_id());

-- products
alter table public.products enable row level security;

create policy "products: 본인 상품 전체"
  on public.products for all
  using (seller_id = public.get_my_seller_id());

-- product_channels
alter table public.product_channels enable row level security;

create policy "product_channels: 본인 데이터 전체"
  on public.product_channels for all
  using (seller_id = public.get_my_seller_id());

-- inventory
alter table public.inventory enable row level security;

create policy "inventory: 본인 재고 전체"
  on public.inventory for all
  using (seller_id = public.get_my_seller_id());

-- orders
alter table public.orders enable row level security;

create policy "orders: 본인 주문 전체"
  on public.orders for all
  using (seller_id = public.get_my_seller_id());

-- order_items
alter table public.order_items enable row level security;

create policy "order_items: 본인 주문상품 전체"
  on public.order_items for all
  using (seller_id = public.get_my_seller_id());

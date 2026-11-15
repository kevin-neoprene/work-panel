-- 工作面板 Supabase 建表 SQL（v2）
-- 在 Supabase 控制台 -> SQL Editor 粘贴执行（项目 neoprene-order-assistant，
-- https://gplkvdodbfzknyafdttb.supabase.co，region ap-southeast-1）
-- v1 的三张表原样保留；v2 新增五张业务表。

create table if not exists public.panel_tasks (
  id bigint generated always as identity primary key,
  title text not null,
  done boolean not null default false,
  starred boolean not null default false,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  due_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.panel_notes (
  id bigint generated always as identity primary key,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.panel_links (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);

-- ============ v2 新增：询盘 ============
create table if not exists public.panel_inquiries (
  id uuid default gen_random_uuid() primary key,
  customer text not null default '',
  product text not null default '',
  quantity text not null default '',
  status text not null default '待报价' check (status in ('待报价','已报价','跟进中','已成交','已丢单')),
  followup text not null default '',
  inquiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ v2 新增：供应商 ============
create table if not exists public.panel_suppliers (
  id uuid default gen_random_uuid() primary key,
  name text not null default '',
  product text not null default '',
  price text not null default '',
  moq text not null default '',
  contact text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ v2 新增：SEO 进度 ============
create table if not exists public.panel_seo (
  id uuid default gen_random_uuid() primary key,
  keyword text not null default '',
  rank text not null default '',
  target_rank text not null default '',
  page text not null default '',
  status text not null default '待写' check (status in ('待写','写作中','已发布','已收录')),
  updated_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ v2 新增：订单 / PI ============
create table if not exists public.panel_orders (
  id uuid default gen_random_uuid() primary key,
  order_no text not null default '',
  customer text not null default '',
  supplier text not null default '',
  product text not null default '',
  amount text not null default '',
  currency text not null default 'USD' check (currency in ('USD','CNY','EUR')),
  pi_no text not null default '',
  pay_status text not null default '未付' check (pay_status in ('未付','定金','已付清')),
  progress text not null default '待生产' check (progress in ('待生产','生产中','已完成')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ v2 新增：发货 ============
create table if not exists public.panel_shipments (
  id uuid default gen_random_uuid() primary key,
  customer text not null default '',
  order_no text not null default '',
  carrier text not null default '',
  tracking text not null default '',
  ship_date date,
  status text not null default '已发货' check (status in ('已发货','运输中','已签收')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 简化部署：允许 anon 角色读写这些表（单人自用面板；如需登录鉴权，
-- 请改为只允许 authenticated 角色，并接 Supabase Auth）。
alter table public.panel_tasks enable row level security;
alter table public.panel_notes enable row level security;
alter table public.panel_links enable row level security;
alter table public.panel_inquiries enable row level security;
alter table public.panel_suppliers enable row level security;
alter table public.panel_seo enable row level security;
alter table public.panel_orders enable row level security;
alter table public.panel_shipments enable row level security;

create policy "anon all tasks" on public.panel_tasks for all to anon using (true) with check (true);
create policy "anon all notes" on public.panel_notes for all to anon using (true) with check (true);
create policy "anon all links" on public.panel_links for all to anon using (true) with check (true);

-- 新增表的策略用 DO 块包裹，重复执行也不会报错
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'panel_inquiries' and policyname = 'anon all inquiries') then
    create policy "anon all inquiries" on public.panel_inquiries for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'panel_suppliers' and policyname = 'anon all suppliers') then
    create policy "anon all suppliers" on public.panel_suppliers for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'panel_seo' and policyname = 'anon all seo') then
    create policy "anon all seo" on public.panel_seo for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'panel_orders' and policyname = 'anon all orders') then
    create policy "anon all orders" on public.panel_orders for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'panel_shipments' and policyname = 'anon all shipments') then
    create policy "anon all shipments" on public.panel_shipments for all to anon using (true) with check (true);
  end if;
end $$;

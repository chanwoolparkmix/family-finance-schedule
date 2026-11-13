-- 가족금융일정표 알림용 테이블 (family-ledger 프로젝트에 적용됨)
create table if not exists public.fs_config (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.fs_devices (
  device_id uuid primary key, subscription jsonb, enabled boolean not null default true,
  offsets integer[] not null default '{7,3,1}', notify_hour integer not null default 9 check (notify_hour between 0 and 23),
  tz text not null default 'Asia/Seoul', loans jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.fs_sent (
  device_id uuid not null references public.fs_devices(device_id) on delete cascade,
  loan_id text not null, due_date date not null, days_before integer not null, sent_at timestamptz not null default now(),
  primary key (device_id, loan_id, due_date, days_before));
alter table public.fs_config enable row level security;
alter table public.fs_devices enable row level security;
alter table public.fs_sent enable row level security;
revoke all on public.fs_config, public.fs_devices, public.fs_sent from anon, authenticated;
insert into public.fs_config (key, value) values ('cron_secret', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))) on conflict (key) do nothing;

-- 매시 1분에 알림 점검 실행 (<PROJECT_REF>는 본인 프로젝트 값으로)
-- select cron.schedule('fs-push-hourly', '1 * * * *', $$
--   select net.http_post(url := 'https://<PROJECT_REF>.supabase.co/functions/v1/fs-push',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value#>>'{}' from public.fs_config where key='cron_secret')),
--     body := '{"action":"run"}'::jsonb, timeout_milliseconds := 20000); $$);

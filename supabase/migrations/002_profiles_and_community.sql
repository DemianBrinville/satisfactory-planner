-- Perfiles públicos y planos compartidos con la comunidad.

create table if not exists public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  username text unique check (char_length(username) between 3 and 24 and username ~ '^[A-Za-z0-9_.-]+$'),
  display_name text check (char_length(display_name) <= 60),
  bio text check (char_length(bio) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: lectura pública" on public.profiles;
create policy "profiles: lectura pública" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "profiles: crear el propio" on public.profiles;
create policy "profiles: crear el propio" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles: editar el propio" on public.profiles;
create policy "profiles: editar el propio" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

-- planos públicos
alter table public.plans add column if not exists is_public boolean not null default false;
alter table public.plans add column if not exists description text check (char_length(description) <= 500);
alter table public.plans add column if not exists copied_from uuid references public.plans (id) on delete set null;
create index if not exists plans_public_idx on public.plans (is_public, updated_at desc) where is_public;

drop policy if exists "plans: ver los públicos" on public.plans;
create policy "plans: ver los públicos" on public.plans for select to anon, authenticated using (is_public);

grant select on public.plans to anon;

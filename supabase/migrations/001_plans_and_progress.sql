-- Planos y progreso de cada usuario. Cada fila pertenece a un usuario (auth.uid()) y RLS
-- impide leer o escribir datos de otros.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Plano sin nombre',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plans_user_updated_idx on public.plans (user_id, updated_at desc);

alter table public.plans enable row level security;

drop policy if exists "plans: ver los propios" on public.plans;
create policy "plans: ver los propios" on public.plans for select to authenticated using (auth.uid() = user_id);
drop policy if exists "plans: crear propios" on public.plans;
create policy "plans: crear propios" on public.plans for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "plans: editar propios" on public.plans;
create policy "plans: editar propios" on public.plans for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "plans: borrar propios" on public.plans;
create policy "plans: borrar propios" on public.plans for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.user_progress (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

drop policy if exists "progress: ver el propio" on public.user_progress;
create policy "progress: ver el propio" on public.user_progress for select to authenticated using (auth.uid() = user_id);
drop policy if exists "progress: crear el propio" on public.user_progress;
create policy "progress: crear el propio" on public.user_progress for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "progress: editar el propio" on public.user_progress;
create policy "progress: editar el propio" on public.user_progress for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update on public.user_progress to authenticated;

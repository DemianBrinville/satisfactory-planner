-- Bloques guardados: grupos de estructuras reutilizables en cualquier plano (como los planos del juego).

create table if not exists public.blocks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blocks_user_idx on public.blocks (user_id, updated_at desc);

alter table public.blocks enable row level security;

drop policy if exists "blocks: ver los propios" on public.blocks;
create policy "blocks: ver los propios" on public.blocks for select to authenticated using (auth.uid() = user_id);
drop policy if exists "blocks: crear los propios" on public.blocks;
create policy "blocks: crear los propios" on public.blocks for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "blocks: editar los propios" on public.blocks;
create policy "blocks: editar los propios" on public.blocks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "blocks: borrar los propios" on public.blocks;
create policy "blocks: borrar los propios" on public.blocks for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.blocks to authenticated;

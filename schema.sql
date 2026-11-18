create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  mode text not null check (mode in ('Meeting','Interview')),
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null,
  kind text not null default 'note' check (kind in ('note','transcript','ai','screen')),
  created_at timestamptz not null default now()
);

alter table public.sessions enable row level security;
alter table public.notes enable row level security;

create policy "own sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Milestone 2 (already included above if you run this file on a fresh project):
-- existing projects only, run this line once:
-- alter table public.notes add column if not exists kind text not null default 'note' check (kind in ('note','transcript','ai'));

-- Screen reading: allow kind 'screen'
-- alter table public.notes drop constraint if exists notes_kind_check;
-- alter table public.notes add constraint notes_kind_check check (kind in ('note','transcript','ai','screen'));

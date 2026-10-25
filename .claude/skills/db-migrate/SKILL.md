---
name: db-migrate
description: Create a new Supabase migration for my-trainer with the standard RLS/updated_at template and apply it. Use when adding or altering tables, policies, triggers or storage buckets.
argument-hint: <slug> [description of change]
---

Create a migration `supabase/migrations/<YYYYMMDDHHMMSS>_<slug>.sql` (UTC timestamp) for: $ARGUMENTS

Steps:
1. Read `supabase/migrations/20261025000000_init_auth_lock.sql` to reuse `public.is_allowed_user()` and `public.set_updated_at()`.
2. Write the migration. For every new user table use this template (adapt names):

```sql
create table if not exists public.<table> (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- columns...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists <table>_user_date_idx on public.<table>(user_id, <date_col>);
alter table public.<table> enable row level security;
drop policy if exists "<table>_owner_all" on public.<table>;
create policy "<table>_owner_all" on public.<table>
  for all to authenticated
  using (user_id = auth.uid() and public.is_allowed_user())
  with check (user_id = auth.uid() and public.is_allowed_user());
drop trigger if exists <table>_set_updated_at on public.<table>;
create trigger <table>_set_updated_at before update on public.<table>
  for each row execute function public.set_updated_at();
```

3. Extend `supabase/tests/rls.test.sql` with a case for the new table.
4. If Docker is running: `npx supabase db reset` to validate locally. Otherwise `npx supabase db push --dry-run` and show the user the SQL to review.
5. Regenerate types: `npx supabase gen types typescript --local > src/lib/database.types.ts` (or `--project-id <ref>` for the hosted project).
6. Report the files changed and any dashboard action required.

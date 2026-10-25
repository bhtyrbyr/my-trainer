-- Food catalog: a shared, read-only nutrition reference searched before asking the AI.
--
-- Sources (loaded by scripts/sync-foods.mjs with the service role, never by clients):
--   curated          Turkish dishes and staples (scripts/food-catalog-tr.json), approximate values
--   usda_foundation  USDA FoodData Central Foundation Foods (CC0)
--   usda_sr          USDA FoodData Central SR Legacy (CC0)
-- Values are per 100 g. Turkish names for USDA rows are machine-translated (name_tr_machine = true)
-- until reviewed. Packaged products come live from Open Food Facts via the food-search Edge Function.

create extension if not exists pg_trgm with schema extensions;

-- Accent- and case-insensitive folding for Turkish (İ/ı/ş/ğ/ç/ö/ü) and English text.
create or replace function public.fold_tr(p text)
returns text language sql immutable parallel safe set search_path = public as $$
  select lower(translate(coalesce(p, ''), 'İIıŞşĞğÇçÖöÜüÂâÎîÛû', 'iiissggccoouuaaiiuu'))
$$;

create table if not exists public.food_catalog (
  id text primary key,                       -- 'tr:<slug>' | 'usda:<fdc_id>'
  source text not null check (source in ('curated', 'usda_foundation', 'usda_sr')),
  name_en text not null check (char_length(name_en) between 1 and 200),
  name_tr text check (name_tr is null or char_length(name_tr) between 1 and 200),
  name_tr_machine boolean not null default false,
  category text,
  kcal_100g numeric(6,1) not null check (kcal_100g between 0 and 1000),
  protein_100g numeric(5,1) not null default 0 check (protein_100g between 0 and 100),
  carb_100g numeric(5,1) not null default 0 check (carb_100g between 0 and 100),
  fat_100g numeric(5,1) not null default 0 check (fat_100g between 0 and 100),
  portion_g numeric(6,1) check (portion_g is null or portion_g between 1 and 2000),
  portion_tr text check (portion_tr is null or char_length(portion_tr) <= 60),
  portion_en text check (portion_en is null or char_length(portion_en) <= 60),
  search_text text generated always as (public.fold_tr(coalesce(name_tr, '') || ' ' || name_en)) stored,
  updated_at timestamptz not null default now()
);
create index if not exists food_catalog_search_trgm on public.food_catalog using gin (search_text extensions.gin_trgm_ops);

alter table public.food_catalog enable row level security;
drop policy if exists "food_catalog_read" on public.food_catalog;
create policy "food_catalog_read" on public.food_catalog for select to authenticated using (public.can_access());
-- no insert/update/delete policies: only the service role (sync script) writes

drop trigger if exists food_catalog_set_updated_at on public.food_catalog;
create trigger food_catalog_set_updated_at before update on public.food_catalog
  for each row execute function public.set_updated_at();

-- Search: every query word must appear (substring, folded); curated Turkish entries and names that
-- start with the query rank first, then trigram similarity. Runs as the caller (RLS applies).
create or replace function public.search_food_catalog(p_query text, p_limit integer default 25)
returns setof public.food_catalog
language sql stable set search_path = public, extensions as $$
  with q as (
    select public.fold_tr(btrim(p_query)) as text,
           array_remove(regexp_split_to_array(public.fold_tr(btrim(p_query)), '\s+'), '') as words
  )
  select fc.*
  from public.food_catalog fc, q
  where char_length(q.text) >= 2
    and not exists (select 1 from unnest(q.words) w where position(w in fc.search_text) = 0)
  order by
    (fc.source = 'curated') desc,
    (public.fold_tr(coalesce(fc.name_tr, fc.name_en)) like q.text || '%') desc,
    similarity(fc.search_text, q.text) desc,
    char_length(coalesce(fc.name_tr, fc.name_en))
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
$$;
revoke execute on function public.search_food_catalog(text, integer) from public, anon;
grant execute on function public.search_food_catalog(text, integer) to authenticated;
grant execute on function public.fold_tr(text) to authenticated;

-- meal entries can now come from the catalog or Open Food Facts
alter table public.meal_entries drop constraint if exists meal_entries_source_check;
alter table public.meal_entries add constraint meal_entries_source_check
  check (source in ('manual', 'food', 'ai_text', 'ai_photo', 'catalog', 'off'));

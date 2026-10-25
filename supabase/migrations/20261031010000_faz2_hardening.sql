-- Faz 2 QA hardening (review 2026-10-26).

-- H1: users cannot raise their own AI quota. Only admins (or internal code) change ai_daily_limit.
create or replace function public.user_settings_protect()
returns trigger language plpgsql set search_path = public as $$
begin
  -- admins, our own security-definer code and server roles (SQL editor, service role) may change it
  if public.is_admin() or public.is_internal() or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ai_daily_limit := 40;
  else
    new.ai_daily_limit := old.ai_daily_limit;
  end if;
  return new;
end;
$$;
drop trigger if exists user_settings_protect on public.user_settings;
create trigger user_settings_protect before insert or update on public.user_settings
  for each row execute function public.user_settings_protect();
revoke execute on function public.user_settings_protect() from public, anon, authenticated;

-- H2: usage rows only against real reservations: at most 3 log rows (Flash, Lite, OpenRouter attempts)
-- per request counted by ai_reserve today, so nobody can flood the shared quota counter.
create or replace function public.ai_log_usage(
  p_action text,
  p_provider text,
  p_model text,
  p_prompt_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_ok boolean
) returns void
language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_reserved integer;
  v_logged integer;
begin
  if auth.uid() is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('food_estimate_text', 'food_estimate_photo', 'coach_chat') then
    raise exception 'BAD_ACTION' using errcode = '22023';
  end if;
  v_reserved := coalesce((select request_count from public.ai_usage where user_id = auth.uid() and day = current_date), 0);
  v_logged := (select count(*) from public.ai_usage_log where user_id = auth.uid() and created_at >= current_date::timestamptz);
  if v_logged >= v_reserved * 3 then
    raise exception 'NO_RESERVATION' using errcode = 'P0001';
  end if;
  insert into public.ai_usage_log (user_id, action, provider, model, prompt_tokens, output_tokens, total_tokens, ok)
  values (
    auth.uid(), p_action, p_provider, left(p_model, 100),
    least(greatest(coalesce(p_prompt_tokens, 0), 0), 1000000),
    least(greatest(coalesce(p_output_tokens, 0), 0), 1000000),
    least(greatest(coalesce(p_total_tokens, 0), 0), 1000000),
    coalesce(p_ok, true)
  );
end;
$$;

-- L14: the old counter is superseded by ai_reserve (the Edge Function no longer calls it).
drop function if exists public.ai_consume();

-- H3: the photo vault can be created once and never deleted; the recovery wrap never changes.
drop policy if exists "photo_vault_owner_all" on public.photo_vault;
drop policy if exists "photo_vault_owner_select" on public.photo_vault;
drop policy if exists "photo_vault_owner_insert" on public.photo_vault;
drop policy if exists "photo_vault_owner_update" on public.photo_vault;
create policy "photo_vault_owner_select" on public.photo_vault for select to authenticated
  using (user_id = auth.uid() and public.can_access());
create policy "photo_vault_owner_insert" on public.photo_vault for insert to authenticated
  with check (user_id = auth.uid() and public.can_access());
create policy "photo_vault_owner_update" on public.photo_vault for update to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

create or replace function public.photo_vault_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.user_id := old.user_id;
  new.recovery_kdf := old.recovery_kdf;
  new.recovery_wrapped_key := old.recovery_wrapped_key;
  new.recovery_iv := old.recovery_iv;
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists photo_vault_guard on public.photo_vault;
create trigger photo_vault_guard before update on public.photo_vault
  for each row execute function public.photo_vault_guard();
revoke execute on function public.photo_vault_guard() from public, anon, authenticated;

-- M5: storage names must be <uid>/<uuid>.img.bin|.thumb.bin, at most 1000 objects (500 photos) per user.
-- The caller's own object count only (no argument, so nobody can count someone else's photos).
create or replace function public.progress_photo_object_count()
returns integer language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects where bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text
$$;
revoke execute on function public.progress_photo_object_count() from public, anon;
grant execute on function public.progress_photo_object_count() to authenticated;

drop policy if exists "progress_photos_owner_insert" on storage.objects;
create policy "progress_photos_owner_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(img|thumb)\.bin$')
    and public.progress_photo_object_count() < 1000
    and public.can_access()
  );

-- L12: a photo row (and its weekly points) needs both encrypted objects uploaded first.
create or replace function public.progress_photos_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.user_id := old.user_id;
    new.image_path := old.image_path;
    new.thumb_path := old.thumb_path;
  else
    if new.image_path <> new.user_id::text || '/' || new.id::text || '.img.bin'
       or new.thumb_path <> new.user_id::text || '/' || new.id::text || '.thumb.bin' then
      raise exception 'BAD_PATH' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'progress-photos' and name = new.image_path)
       or not exists (select 1 from storage.objects where bucket_id = 'progress-photos' and name = new.thumb_path) then
      raise exception 'MISSING_UPLOAD' using errcode = 'P0001';
    end if;
  end if;
  if new.taken_on > current_date then
    raise exception 'FUTURE_DATE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.progress_photos_guard() from public, anon, authenticated;

-- M6: the protein-goal bonus needs a realistic goal (>= 40 g); a 1 g goal earns nothing.
create or replace function public.sync_protein_goal(p_user uuid, p_day date)
returns void language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_goal integer;
  v_sum numeric;
begin
  select us.daily_protein_g into v_goal from public.user_settings us where us.user_id = p_user;
  select coalesce(sum(me.protein_g), 0) into v_sum from public.meal_entries me where me.user_id = p_user and me.eaten_on = p_day;
  if coalesce(v_goal, 0) >= 40 and v_sum >= v_goal then
    perform public.award_points(p_user, 'protein_goal', p_day, 'meal_entries', 'protein:' || p_day::text);
  else
    perform public.revoke_points(p_user, 'meal_entries', 'protein:' || p_day::text);
  end if;
end;
$$;
revoke execute on function public.sync_protein_goal(uuid, date) from public, anon, authenticated;

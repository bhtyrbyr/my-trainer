-- The app is 18+: a birth year that makes someone certainly under 18 is rejected, and the "I am 18 or
-- older" confirmation is refused when the stored birth year contradicts it (year-only precision: born in
-- the year that is 18 years ago may still be 17 and is accepted).
create or replace function public.profile_private_age_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if new.birth_year is not null and new.birth_year > extract(year from current_date)::int - 18 then
    raise exception 'UNDERAGE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists profile_private_age_guard on public.profile_private;
create trigger profile_private_age_guard before insert or update of birth_year on public.profile_private
  for each row execute function public.profile_private_age_guard();
revoke execute on function public.profile_private_age_guard() from public, anon, authenticated;

create or replace function public.record_consent(p_kind text, p_version text)
returns void language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = auth.uid() and is_blocked) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind not in ('privacy_notice', 'health_data', 'adult', 'ai_processing') then
    raise exception 'BAD_KIND' using errcode = '22023';
  end if;
  if p_kind in ('adult', 'ai_processing')
     and exists (select 1 from public.profile_private
                  where user_id = auth.uid() and birth_year > extract(year from current_date)::int - 18) then
    raise exception 'UNDERAGE' using errcode = 'P0001';
  end if;
  insert into public.user_consents (user_id, kind, version, granted) values (auth.uid(), p_kind, left(p_version, 20), true);
end;
$$;

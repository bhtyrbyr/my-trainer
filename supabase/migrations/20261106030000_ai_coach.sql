-- Faz 4: AI coach storage and context (docs/faz4-spec.md sections 1 and 7, PRD M10).
--
-- ai_conversations / ai_messages: owner-only. Clients insert only role 'user' messages; assistant
-- replies are written by the ai-coach Edge Function with the CALLER's token through
-- ai_add_assistant_message() (security definer: ownership, length, and one reply per AI request
-- reserved through ai_reserve()). Messages are immutable (delete only).
-- Abuse limits (free-tier storage): 100 conversations per user, 100 user messages per Istanbul day.
-- get_coach_context(): security invoker, aggregates of the last 28 days only; never photos, never
-- names or e-mails; health parts only with health consent (RLS hides them otherwise).

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_updated_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) >= 1 and char_length(content) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_created_idx on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_user_created_idx on public.ai_messages (user_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists "ai_conversations_owner_all" on public.ai_conversations;
create policy "ai_conversations_owner_all" on public.ai_conversations for all to authenticated
  using (user_id = auth.uid() and public.can_access())
  with check (user_id = auth.uid() and public.can_access());

drop policy if exists "ai_messages_owner_select" on public.ai_messages;
create policy "ai_messages_owner_select" on public.ai_messages for select to authenticated
  using (user_id = auth.uid() and public.can_access());
drop policy if exists "ai_messages_owner_insert_user" on public.ai_messages;
create policy "ai_messages_owner_insert_user" on public.ai_messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_access() and role = 'user');
drop policy if exists "ai_messages_owner_delete" on public.ai_messages;
create policy "ai_messages_owner_delete" on public.ai_messages for delete to authenticated
  using (user_id = auth.uid() and public.can_access());
-- no update policy: messages are immutable

drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
create trigger ai_conversations_set_updated_at before update on public.ai_conversations
  for each row execute function public.set_updated_at();

-- Conversations: owner and creation time frozen; at most 100 per user.
create or replace function public.ai_conversations_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_conversations:' || new.user_id::text, 0));
  if (select count(*) from public.ai_conversations c where c.user_id = new.user_id) >= 100 then
    raise exception 'LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists ai_conversations_guard on public.ai_conversations;
create trigger ai_conversations_guard before insert or update on public.ai_conversations
  for each row execute function public.ai_conversations_guard();

-- Messages: the conversation must be the writer's own (FORBIDDEN otherwise, also for a guessed id);
-- server clock only; user messages capped per Istanbul day.
create or replace function public.ai_messages_guard()
returns trigger language plpgsql set search_path = public set timezone = 'Europe/Istanbul' as $$
begin
  if not exists (select 1 from public.ai_conversations c where c.id = new.conversation_id and c.user_id = new.user_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  new.created_at := now();
  if new.role = 'user' then
    perform pg_advisory_xact_lock(hashtextextended('ai_messages:' || new.user_id::text, 0));
    if (select count(*) from public.ai_messages m
         where m.user_id = new.user_id and m.role = 'user' and m.created_at >= current_date::timestamptz) >= 100 then
      raise exception 'LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ai_messages_guard on public.ai_messages;
create trigger ai_messages_guard before insert on public.ai_messages
  for each row execute function public.ai_messages_guard();

-- A new message moves its conversation to the top of the list.
create or replace function public.ai_messages_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.ai_conversations set updated_at = now() where id = new.conversation_id;
  return null;
end;
$$;
drop trigger if exists ai_messages_touch on public.ai_messages;
create trigger ai_messages_touch after insert on public.ai_messages
  for each row execute function public.ai_messages_touch();

-- ---------------------------------------------------------------------------------------------
-- Assistant replies (Edge Function, caller's token). Returns the new message id.
-- One reply per request counted by ai_reserve() (today + yesterday, so a reply that lands just after
-- midnight still matches its reservation).
create or replace function public.ai_add_assistant_message(p_conversation uuid, p_content text)
returns uuid language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_reserved integer;
  v_written integer;
  v_id uuid;
begin
  if v_uid is null or not public.can_access() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 4000 then
    raise exception 'BAD_CONTENT' using errcode = '22023';
  end if;
  if p_conversation is null
     or not exists (select 1 from public.ai_conversations c where c.id = p_conversation and c.user_id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- serialise per user (same lock ai_reserve takes on today's counter row)
  insert into public.ai_usage (user_id, day, request_count) values (v_uid, current_date, 0)
  on conflict (user_id, day) do nothing;
  perform 1 from public.ai_usage where user_id = v_uid and day = current_date for update;
  select coalesce(sum(u.request_count), 0)::int into v_reserved
  from public.ai_usage u where u.user_id = v_uid and u.day >= current_date - 1;
  select count(*)::int into v_written
  from public.ai_messages m
  where m.user_id = v_uid and m.role = 'assistant' and m.created_at >= (current_date - 1)::timestamptz;
  if v_written >= v_reserved then
    raise exception 'NO_RESERVATION' using errcode = 'P0001';
  end if;
  insert into public.ai_messages (conversation_id, user_id, role, content)
  values (p_conversation, v_uid, 'assistant', p_content)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Coach context: the caller's last 28 days (today included) as aggregates. Exercise names and body
-- parts come only from the shared catalog (custom exercises are free text: reported as "custom").
create or replace function public.get_coach_context()
returns jsonb language plpgsql stable set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_to date := current_date;
  v_from date := current_date - 27;
  v_health boolean := coalesce(public.has_health_consent(), false);
  v_workouts jsonb;
  v_parts jsonb;
  v_records jsonb;
  v_due integer;
  v_done integer;
  v_habits integer;
  v_todos integer;
  v_streak integer;
  v_weight jsonb;
  v_sleep jsonb;
  v_nutrition jsonb;
  v_last numeric;
  v_last_on date;
  v_before numeric;
begin
  if v_uid is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select jsonb_build_object(
           'sessions', count(*),
           'strength', count(*) filter (where s.kind = 'strength'),
           'cardio', count(*) filter (where s.kind = 'cardio'),
           'training_days', count(distinct s.started_at::date),
           'sets', coalesce(sum(s.total_sets), 0),
           'volume_kg', round(coalesce(sum(s.total_volume_kg), 0), 1),
           'cardio_minutes', round(coalesce(sum(s.duration_sec) filter (where s.kind = 'cardio'), 0) / 60.0)::int,
           'last_session_on', max(s.started_at::date))
    into v_workouts
  from public.workout_sessions s
  where s.user_id = v_uid and s.ended_at is not null and s.started_at >= v_from::timestamptz;

  select coalesce(jsonb_agg(jsonb_build_object('body_part', x.bp, 'sets', x.sets, 'volume_kg', x.volume_kg, 'last_on', x.last_on)
                            order by x.sets desc, x.bp), '[]'::jsonb)
    into v_parts
  from (
    select bp, count(*) as sets,
           round(sum(coalesce(ss.weight_kg, 0) * ss.reps), 1) as volume_kg,
           max(s.started_at::date) as last_on
    from public.session_sets ss
    join public.workout_sessions s on s.id = ss.session_id
    join public.session_exercises se on se.id = ss.session_exercise_id
    join public.exercises e on e.id = se.exercise_id
    cross join lateral unnest(
      case when e.is_custom then array['custom']
           when cardinality(e.body_parts) = 0 then array['other']
           else e.body_parts end) as bp
    where ss.user_id = v_uid and s.ended_at is not null and s.started_at >= v_from::timestamptz
      and not ss.is_warmup and coalesce(ss.reps, 0) >= 1
    group by bp
    order by count(*) desc
    limit 20
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'exercise', case when r.is_custom then null else r.name_en end,
           'custom', r.is_custom, 'e1rm', r.e1rm, 'weight_kg', r.weight_kg, 'reps', r.reps, 'on', r.achieved_on)
           order by r.achieved_on desc, r.e1rm desc), '[]'::jsonb)
    into v_records
  from (
    select e.is_custom, e.name_en, pr.e1rm, pr.weight_kg, pr.reps, pr.achieved_on
    from public.personal_records pr join public.exercises e on e.id = pr.exercise_id
    where pr.user_id = v_uid and pr.achieved_on >= v_from
    order by pr.achieved_on desc, pr.e1rm desc
    limit 10
  ) r;

  select hd.due, hd.done into v_due, v_done from public.habit_due_done(v_from, v_to) hd;
  select count(*)::int into v_habits from public.habits h where h.user_id = v_uid and h.archived_at is null;
  select count(*)::int into v_todos from public.todo_completions c where c.user_id = v_uid and c.completed_on >= v_from;
  select public.effective_streak(p.current_streak, p.last_active_on) into v_streak from public.profiles p where p.user_id = v_uid;

  if v_health then
    select bm.weight_kg, bm.measured_on into v_last, v_last_on from public.body_metrics bm
    where bm.user_id = v_uid and bm.weight_kg is not null and bm.measured_on >= v_from
    order by bm.measured_on desc limit 1;
    select bm.weight_kg into v_before from public.body_metrics bm
    where bm.user_id = v_uid and bm.weight_kg is not null and bm.measured_on < v_from
    order by bm.measured_on desc limit 1;
    v_weight := jsonb_build_object('latest_kg', v_last, 'latest_on', v_last_on, 'change_kg', v_last - v_before);

    select jsonb_build_object('nights', count(*), 'avg_minutes', round(avg(se.duration_min))::int,
                              'avg_quality', round(avg(se.quality), 1))
      into v_sleep
    from public.sleep_entries se where se.user_id = v_uid and se.sleep_on >= v_from;

    select jsonb_build_object(
             'days_logged', count(*),
             'avg_kcal', round(avg(d.kcal))::int,
             'avg_protein_g', round(avg(d.protein_g), 1),
             'goal_kcal', (select us.daily_kcal from public.user_settings us where us.user_id = v_uid),
             'goal_protein_g', (select us.daily_protein_g from public.user_settings us where us.user_id = v_uid))
      into v_nutrition
    from (
      select me.eaten_on, sum(me.kcal) as kcal, sum(me.protein_g) as protein_g
      from public.meal_entries me where me.user_id = v_uid and me.eaten_on >= v_from
      group by me.eaten_on
    ) d;
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', 28),
    'workouts', v_workouts,
    'body_parts', v_parts,
    'records', v_records,
    'habits', jsonb_build_object('active', v_habits, 'due', v_due, 'done', v_done,
                                 'rate', case when coalesce(v_due, 0) = 0 then null else round(v_done::numeric / v_due, 3) end),
    'todos_done', v_todos,
    'streak', coalesce(v_streak, 0),
    'health_consent', v_health,
    'weight', v_weight,
    'sleep', v_sleep,
    'nutrition', v_nutrition
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
revoke execute on function public.ai_conversations_guard(), public.ai_messages_guard(), public.ai_messages_touch()
  from public, anon, authenticated;
revoke execute on function public.ai_add_assistant_message(uuid, text), public.get_coach_context() from public, anon;
grant execute on function public.ai_add_assistant_message(uuid, text), public.get_coach_context() to authenticated;

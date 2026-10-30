-- Reminders re-arm when their time changes: the dedupe key now includes the reminder time, so moving
-- a reminder from 19:00 to 19:35 on the same day sends again (each (item, time, day) still once).
create or replace function private.reminders_due(p_day date, p_from time, p_to time)
returns table (user_id uuid, ref text, label text, remind_at time)
language sql stable set search_path = public as $$
  select h.user_id, 'habit:' || h.id::text || '@' || to_char(h.remind_at, 'HH24:MI'), h.name, h.remind_at
    from public.habits h
   where h.remind_at between p_from and p_to
     and (h.archived_at is null or (h.archived_at at time zone 'Europe/Istanbul')::date > p_day)
     and public.recurrence_matches(h.rule, h.starts_on, p_day)
     and coalesce((select l.count from public.habit_logs l where l.habit_id = h.id and l.day = p_day), 0) < h.target_count
     and (h.rule ->> 'type' is distinct from 'weekly_count'
          or (select count(*) from public.habit_logs l
               where l.habit_id = h.id
                 and l.day >= p_day - (extract(isodow from p_day)::int - 1) and l.day < p_day
                 and l.count >= h.target_count) < (h.rule ->> 'n')::int)
  union all
  select t.user_id, 'todo:' || t.id::text || '@' || to_char(t.remind_at, 'HH24:MI'), t.title, t.remind_at
    from public.todos t
   where t.remind_at between p_from and p_to
     and t.archived_at is null
     and case when t.rule is null then t.due_on is not distinct from p_day
              else public.recurrence_matches(t.rule, t.starts_on, p_day) end
     and not exists (select 1 from public.todo_completions c
                      where c.todo_id = t.id and (t.rule is null or c.day = p_day))
$$;
revoke all on function private.reminders_due(date, time, time) from public, anon, authenticated;

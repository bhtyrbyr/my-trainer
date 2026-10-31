-- Coach replies can only come from the ai-coach Edge Function (Faz 4 QA finding).
-- The function calls the database with the caller's token (never service_role), so before this a user
-- could call ai_add_assistant_message() directly with any reserved AI request and plant made-up
-- "assistant" turns in their own chat, which were then sent back to the model as its own words.
-- Now every reply carries an HMAC-SHA256 over "<conversation id>:<content>" with a key only the server
-- knows: derived from the server secret already in private.push_config (PUSH_DISPATCH_SECRET, also a
-- Supabase Edge Function secret) with the label 'coach-reply-v1', so the two uses never share a key.
drop function if exists public.ai_add_assistant_message(uuid, text);

create or replace function public.ai_add_assistant_message(p_conversation uuid, p_content text, p_signature text)
returns uuid language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_secret text;
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
  select c.secret into v_secret from private.push_config c where c.id;
  if v_secret is null then
    raise exception 'COACH_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  if p_signature is null or p_signature <> encode(
       extensions.hmac(p_conversation::text || ':' || p_content,
                       encode(extensions.hmac('coach-reply-v1', v_secret, 'sha256'), 'hex'), 'sha256'), 'hex') then
    raise exception 'BAD_SIGNATURE' using errcode = '42501';
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
revoke execute on function public.ai_add_assistant_message(uuid, text, text) from public, anon;
grant execute on function public.ai_add_assistant_message(uuid, text, text) to authenticated;

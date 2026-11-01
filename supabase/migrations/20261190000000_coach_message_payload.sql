-- Coach program cards survive a reload.
-- The ai-coach `coach-program` action stored only the readable summary as the assistant message; the
-- structured program ({program, unmatched}) lived in the Edge Function response and therefore only in
-- the in-memory query cache, so the card vanished on reload. Coach data stays network-only on the
-- device (no local persistence), so the program is now stored server-side next to the summary:
--
-- * ai_messages.payload jsonb: assistant messages only, at most 32 KB (as JSON text). RLS unchanged:
--   owner-only select (the existing ai_messages_owner_select policy); still no update policy.
-- * ai_add_assistant_message(uuid, text, text) is replaced by (uuid, text, text, p_payload text default
--   null). A single function (the old one is dropped), so PostgREST never sees an overload; calls
--   without p_payload (an Edge Function deployed before this migration) keep working.
-- * Signature: without a payload, unchanged ('coach-reply-v1' key, "<conversation>:<content>").
--   With a payload, a separate key (label 'coach-reply-v2') over
--   "<conversation>:<octet_length(content)>:<content>:<payload>", where payload is the exact JSON TEXT
--   the server produced (jsonb would reorder keys). The byte-length prefix makes the content/payload
--   split unambiguous, and the separate key keeps the two forms from ever validating each other, so
--   changing either the content or the payload breaks the signature.

alter table public.ai_messages add column if not exists payload jsonb;

alter table public.ai_messages drop constraint if exists ai_messages_payload_check;
alter table public.ai_messages add constraint ai_messages_payload_check
  check (payload is null or (role = 'assistant' and jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768));

drop function if exists public.ai_add_assistant_message(uuid, text, text);

create or replace function public.ai_add_assistant_message(p_conversation uuid, p_content text, p_signature text, p_payload text default null)
returns uuid language plpgsql security definer set search_path = public set timezone = 'Europe/Istanbul' as $$
declare
  v_uid uuid := auth.uid();
  v_secret text;
  v_expected text;
  v_payload jsonb;
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
  if p_payload is not null and octet_length(p_payload) > 32768 then
    raise exception 'BAD_PAYLOAD' using errcode = '22023';
  end if;
  if p_conversation is null
     or not exists (select 1 from public.ai_conversations c where c.id = p_conversation and c.user_id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select c.secret into v_secret from private.push_config c where c.id;
  if v_secret is null then
    raise exception 'COACH_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  if p_payload is null then
    v_expected := encode(
      extensions.hmac(p_conversation::text || ':' || p_content,
                      encode(extensions.hmac('coach-reply-v1', v_secret, 'sha256'), 'hex'), 'sha256'), 'hex');
  else
    v_expected := encode(
      extensions.hmac(p_conversation::text || ':' || octet_length(p_content)::text || ':' || p_content || ':' || p_payload,
                      encode(extensions.hmac('coach-reply-v2', v_secret, 'sha256'), 'hex'), 'sha256'), 'hex');
  end if;
  if p_signature is null or p_signature <> v_expected then
    raise exception 'BAD_SIGNATURE' using errcode = '42501';
  end if;
  if p_payload is not null then
    begin
      v_payload := p_payload::jsonb;
    exception when others then
      raise exception 'BAD_PAYLOAD' using errcode = '22023';
    end;
    if jsonb_typeof(v_payload) <> 'object' then
      raise exception 'BAD_PAYLOAD' using errcode = '22023';
    end if;
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
  insert into public.ai_messages (conversation_id, user_id, role, content, payload)
  values (p_conversation, v_uid, 'assistant', p_content, v_payload)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.ai_add_assistant_message(uuid, text, text, text) from public, anon;
grant execute on function public.ai_add_assistant_message(uuid, text, text, text) to authenticated;

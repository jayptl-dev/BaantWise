-- Baantwise, Phase 3: payment reminders by email.
--
-- In plain words:
--   On the group page, someone who is owed money can press "Remind" next to a
--   person who owes them. The send-reminder Edge Function works out the amount from
--   what the sender can see (the same maths as the app), then emails the person who
--   owes, and a copy to the sender, through Resend. Baantwise never moves money.
--   To stop reminders turning into spam, claim_reminder() allows one reminder to
--   the same person in the same group every 3 days, and at most 20 a day per sender.
--   Only who, to whom, which group and when are kept: never amounts or email text.
--   Rows older than 30 days are forgotten.

create table private.reminders_sent (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  to_member uuid not null references public.group_members (id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index reminders_sent_lookup on private.reminders_sent (sender, sent_at);
comment on table private.reminders_sent is
  'When someone sent a payment reminder, to whom and in which group (no amounts or text). Written only by public.claim_reminder(); kept 30 days.';

alter table private.reminders_sent enable row level security;
revoke all on table private.reminders_sent from public, anon, authenticated;

-- Called by the send-reminder Edge Function with the sender's own sign-in, just before
-- it sends. allowed = false (nothing recorded) when it's too soon or too many today;
-- next_at says when another one to this person is possible.
create function public.claim_reminder(p_group_id uuid, p_to_member uuid)
returns table (allowed boolean, reason text, next_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'You''re not in this group' using errcode = '42501';
  end if;
  if not exists (select 1 from public.group_members m
                 where m.id = p_to_member and m.group_id = p_group_id and m.removed_at is null
                   and m.user_id is not null and m.user_id <> v_uid) then
    raise exception 'That person can''t get reminders' using errcode = '22023';
  end if;

  delete from private.reminders_sent where sent_at < now() - interval '30 days';

  select max(r.sent_at) into v_last from private.reminders_sent r
   where r.sender = v_uid and r.group_id = p_group_id and r.to_member = p_to_member;
  if v_last is not null and v_last > now() - interval '3 days' then
    return query select false, 'too_soon', v_last + interval '3 days';
    return;
  end if;
  if (select count(*) from private.reminders_sent r
      where r.sender = v_uid and r.sent_at > now() - interval '1 day') >= 20 then
    return query select false, 'daily_limit', now() + interval '1 day';
    return;
  end if;

  insert into private.reminders_sent (sender, group_id, to_member) values (v_uid, p_group_id, p_to_member);
  return query select true, null::text, now() + interval '3 days';
end;
$$;
comment on function public.claim_reminder(uuid, uuid) is
  'send-reminder Edge Function only: records a reminder from the caller to a group member, or says why not (too_soon: one per person per group every 3 days; daily_limit: 20 a day).';
revoke execute on function public.claim_reminder(uuid, uuid) from public, anon;
grant execute on function public.claim_reminder(uuid, uuid) to authenticated;

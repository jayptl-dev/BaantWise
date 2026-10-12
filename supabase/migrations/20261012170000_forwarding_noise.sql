-- Baantwise: spot "Gmail is forwarding ALL my email to Baantwise".
--
-- In plain words:
--   If someone turns on Gmail's "forward a copy of all incoming mail" by mistake, every
--   personal email lands at their bill address. receive-bill-email already ignores the
--   ones that aren't bills. This counts those ignored emails (only who and when, never
--   anything about the email). From the 5th in a day, Baantwise stops sending that
--   person's automatic forwards to the AI reader, and emails them ONE warning with the
--   fix (at most one a week). Rows older than 8 days are forgotten.

create table private.inbound_noise (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index inbound_noise_lookup on private.inbound_noise (user_id, at);
comment on table private.inbound_noise is
  'When an automatic forward to a bill address turned out not to be a bill (who and when only). Kept 8 days.';

create table private.inbound_noise_warnings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);
comment on table private.inbound_noise_warnings is
  'When someone was last warned that their email seems to forward everything to Baantwise.';

alter table private.inbound_noise enable row level security;
alter table private.inbound_noise_warnings enable row level security;
revoke all on table private.inbound_noise, private.inbound_noise_warnings from public, anon, authenticated;

-- receive-bill-email (admin key only).
-- p_add = false: just ask whether this person's automatic forwards look like "everything"
--   (5 or more non-bills in the last day).
-- p_add = true: record one more non-bill first. warn = true when they should get the
--   warning email now (they just reached 5 and weren't warned in the last 7 days).
create function public.inbound_noise(p_user_id uuid, p_add boolean)
returns table (noisy boolean, warn boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
  v_warn boolean := false;
begin
  if p_add then
    delete from private.inbound_noise where at < now() - interval '8 days';
    insert into private.inbound_noise (user_id) values (p_user_id);
  end if;
  select count(*)::integer into v_count from private.inbound_noise n
   where n.user_id = p_user_id and n.at > now() - interval '1 day';
  if p_add and v_count >= 5 and not exists (
    select 1 from private.inbound_noise_warnings w
     where w.user_id = p_user_id and w.sent_at > now() - interval '7 days'
  ) then
    insert into private.inbound_noise_warnings (user_id, sent_at) values (p_user_id, now())
    on conflict (user_id) do update set sent_at = excluded.sent_at;
    v_warn := true;
  end if;
  return query select v_count >= 5, v_warn;
end;
$$;
comment on function public.inbound_noise(uuid, boolean) is
  'receive-bill-email Edge Function only (admin key): counts automatic non-bill forwards per person; noisy = 5+ in a day; warn = send the one warning now.';
revoke execute on function public.inbound_noise(uuid, boolean) from public, anon, authenticated;
grant execute on function public.inbound_noise(uuid, boolean) to service_role;

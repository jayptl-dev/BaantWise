-- Baantwise, Phase 3: email forwarding ("forward a bill email, Baantwise reads it").
--
-- In plain words:
--   Every group gets its own private bill address, bills+<forward_token>@mail.baantwise.com.
--   A member forwards a bill email (Enbridge, Bell...) to it, by hand or with a Gmail or
--   Outlook rule. Cloudflare Email Routing hands the email to the baantwise Worker, which
--   passes it to the receive-bill-email Edge Function. That function checks the email
--   really came from someone in the group (the address they sign in with), reads ONLY
--   the biller's name, the amount and the date, and keeps those as a "bill to review"
--   for that person. The email itself is never stored.
--   Nothing is added to the group until that person opens the bill, checks the split and
--   presses Save: it becomes a normal expense then. They can also dismiss it.
--   Only the person who forwarded a bill can see it. Admins can give the group a new
--   address; the old one stops working at once.

-- ---------------------------------------------------------------------------
-- 1. The group's bill address
-- ---------------------------------------------------------------------------
-- "crews-crescent-3f9a1c07d2": the group's name when the address was made, so people
-- recognise it, plus 10 random characters, so nobody can guess it.
create function private.new_forward_token(p_name text)
returns text language sql volatile set search_path = ''
as $$
  select coalesce(nullif(btrim(left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 20), '-'), ''), 'group')
         || '-' || left(replace(gen_random_uuid()::text, '-', ''), 10);
$$;
revoke execute on function private.new_forward_token(text) from public, anon, authenticated;

alter table public.groups add column forward_token text;
update public.groups set forward_token = private.new_forward_token(name) where forward_token is null;
alter table public.groups
  alter column forward_token set not null,
  add constraint groups_forward_token_key unique (forward_token),
  add constraint groups_forward_token_format check (forward_token ~ '^[a-z0-9-]{3,40}$');
comment on column public.groups.forward_token is
  'Secret part of the group''s bill address (bills+<token>@mail.baantwise.com). Members can see it; admins can reset it with reset_forward_address.';

create function private.set_forward_token()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.forward_token is null then
    new.forward_token := private.new_forward_token(new.name);
  end if;
  return new;
end;
$$;
revoke execute on function private.set_forward_token() from public, anon, authenticated;

create trigger groups_set_forward_token
  before insert on public.groups
  for each row execute function private.set_forward_token();

-- Admins: a new bill address. The old one stops working (emails to it are turned away).
create function public.reset_forward_address(p_group_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can do this' using errcode = '42501';
  end if;
  update public.groups g
     set forward_token = private.new_forward_token(g.name)
   where g.id = p_group_id
  returning g.forward_token into v_token;
  return v_token;
end;
$$;
comment on function public.reset_forward_address(uuid) is
  'Admins only: give the group a new bill address. Returns the new token.';
revoke execute on function public.reset_forward_address(uuid) from public, anon;
grant execute on function public.reset_forward_address(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bills to review
-- ---------------------------------------------------------------------------
create table public.forwarded_bills (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- who forwarded it
  biller text check (biller is null or char_length(biller) between 1 and 120),
  amount_cents bigint check (amount_cents is null or amount_cents between 1 and 100000000),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  bill_date date,
  category text not null default 'other'
    check (category in ('food', 'groceries', 'transport', 'housing', 'utilities',
                        'entertainment', 'travel', 'shopping', 'health', 'other')),
  message_key text not null check (char_length(message_key) between 1 and 100), -- a hash, never the email
  status text not null default 'pending' check (status in ('pending', 'added', 'dismissed')),
  expense_id uuid references public.expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (group_id, user_id, message_key)
);
create index forwarded_bills_open on public.forwarded_bills (group_id, user_id) where status = 'pending';
create index forwarded_bills_user_recent on public.forwarded_bills (user_id, created_at);
comment on table public.forwarded_bills is
  'A bill someone forwarded to the group''s bill address: only the biller, amount and date, never the email. Only the person who forwarded it sees it, until they add it as an expense or dismiss it (resolve_forwarded_bill).';

alter table public.forwarded_bills enable row level security;
create policy "See bills you forwarded, in groups you are in"
  on public.forwarded_bills for select to authenticated
  using (user_id = (select auth.uid()) and private.is_group_member(group_id));
revoke all on table public.forwarded_bills from anon, authenticated;
grant select on table public.forwarded_bills to authenticated;
-- Not in the live-updates publication on purpose (it's private to one person).

-- Add it as an expense (p_expense_id = the expense you just saved) or dismiss it (null).
create function public.resolve_forwarded_bill(p_bill_id uuid, p_expense_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_bill public.forwarded_bills;
begin
  select * into v_bill from public.forwarded_bills b
   where b.id = p_bill_id and b.user_id = (select auth.uid()) and b.status = 'pending';
  if not found or not private.is_group_member(v_bill.group_id) then
    raise exception 'This bill was already added or dismissed' using errcode = 'P0002';
  end if;
  if p_expense_id is not null and not exists (
    select 1 from public.expenses e
     where e.id = p_expense_id and e.group_id = v_bill.group_id
       and e.created_by = (select auth.uid()) and e.deleted_at is null
  ) then
    raise exception 'That expense isn''t yours in this group' using errcode = '42501';
  end if;
  update public.forwarded_bills
     set status = case when p_expense_id is null then 'dismissed' else 'added' end,
         expense_id = p_expense_id,
         closed_at = now()
   where id = p_bill_id;
end;
$$;
comment on function public.resolve_forwarded_bill(uuid, uuid) is
  'The person who forwarded a bill: mark it added (with the expense they saved from it) or dismissed (null).';
revoke execute on function public.resolve_forwarded_bill(uuid, uuid) from public, anon;
grant execute on function public.resolve_forwarded_bill(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. For the Edge Functions
-- ---------------------------------------------------------------------------
-- "Jay.Patel+bills@GoogleMail.com" and "jaypatel@gmail.com" are the same Gmail inbox.
create function private.normalize_email(p_email text)
returns text language sql immutable set search_path = ''
as $$
  with e as (
    select split_part(lower(btrim(p_email)), '@', 1) as local,
           split_part(lower(btrim(p_email)), '@', 2) as domain
     where lower(btrim(coalesce(p_email, ''))) ~ '^[^@\s]+@[^@\s]+$'
  )
  select case
           when domain in ('gmail.com', 'googlemail.com')
             then replace(split_part(local, '+', 1), '.', '') || '@gmail.com'
           else split_part(local, '+', 1) || '@' || domain
         end
    from e;
$$;
revoke execute on function private.normalize_email(text) from public, anon, authenticated;

-- receive-bill-email (admin key only): which group a bill address belongs to, and which
-- active member, if any, has one of these sign-in addresses. bills_today counts that
-- person's forwarded bills in the last day, for the daily limit.
create function public.inbound_match(p_token text, p_emails text[])
returns table (group_id uuid, group_name text, user_id uuid, member_name text, email text, bills_today integer)
language sql stable security definer set search_path = ''
as $$
  select g.id, g.name, m.user_id, m.display_name, m.email,
         (select count(*)::integer from public.forwarded_bills b
           where b.user_id = m.user_id and b.created_at > now() - interval '1 day')
    from public.groups g
    left join lateral (
      select gm.user_id, gm.display_name, u.email::text as email
        from public.group_members gm
        join auth.users u on u.id = gm.user_id
       where gm.group_id = g.id and gm.removed_at is null
         and private.normalize_email(u.email) in
             (select private.normalize_email(x) from unnest(p_emails) as x)
       order by gm.created_at
       limit 1
    ) m on true
   where g.forward_token = lower(btrim(p_token));
$$;
comment on function public.inbound_match(text, text[]) is
  'receive-bill-email Edge Function only (admin key): the group behind a bill address and the member who forwarded to it.';

-- receive-bill-email (admin key only): keep a bill to review. Returns its id, or null when
-- the same email was already forwarded. Also forgets closed bills older than 90 days.
create function public.inbound_add_bill(
  p_group_id uuid, p_user_id uuid, p_biller text, p_amount_cents bigint, p_currency text,
  p_bill_date date, p_category text, p_message_key text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.group_members m
                  where m.group_id = p_group_id and m.user_id = p_user_id and m.removed_at is null) then
    raise exception 'Not a member of this group' using errcode = '42501';
  end if;
  delete from public.forwarded_bills where status <> 'pending' and closed_at < now() - interval '90 days';
  insert into public.forwarded_bills (group_id, user_id, biller, amount_cents, currency, bill_date, category, message_key)
  values (p_group_id, p_user_id, p_biller, p_amount_cents, coalesce(p_currency, 'CAD'), p_bill_date,
          coalesce(p_category, 'other'), p_message_key)
  on conflict (group_id, user_id, message_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.inbound_add_bill(uuid, uuid, text, bigint, text, date, text, text) is
  'receive-bill-email Edge Function only (admin key): keep a forwarded bill to review. null = already forwarded.';

revoke execute on function
  public.inbound_match(text, text[]),
  public.inbound_add_bill(uuid, uuid, text, bigint, text, date, text, text)
from public, anon, authenticated;
grant execute on function
  public.inbound_match(text, text[]),
  public.inbound_add_bill(uuid, uuid, text, bigint, text, date, text, text)
to service_role;

-- forwarding-setup (as the signed-in member): may I get the setup email for this group
-- now? At most 5 a day per person. Returns the group's name and address token.
create table private.forwarding_setup_sent (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index forwarding_setup_sent_lookup on private.forwarding_setup_sent (user_id, sent_at);
alter table private.forwarding_setup_sent enable row level security;
revoke all on table private.forwarding_setup_sent from public, anon, authenticated;

create function public.claim_forwarding_setup(p_group_id uuid)
returns table (allowed boolean, group_name text, forward_token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'You''re not in this group' using errcode = '42501';
  end if;
  delete from private.forwarding_setup_sent where sent_at < now() - interval '2 days';
  if (select count(*) from private.forwarding_setup_sent s
       where s.user_id = v_uid and s.sent_at > now() - interval '1 day') >= 5 then
    return query select false, g.name, g.forward_token from public.groups g where g.id = p_group_id;
    return;
  end if;
  insert into private.forwarding_setup_sent (user_id) values (v_uid);
  return query select true, g.name, g.forward_token from public.groups g where g.id = p_group_id;
end;
$$;
comment on function public.claim_forwarding_setup(uuid) is
  'forwarding-setup Edge Function only: records a setup email for the caller (5 a day) and returns the group''s name and bill address token.';
revoke execute on function public.claim_forwarding_setup(uuid) from public, anon;
grant execute on function public.claim_forwarding_setup(uuid) to authenticated;

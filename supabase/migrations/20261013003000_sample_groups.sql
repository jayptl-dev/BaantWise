-- Sample groups: a private, ready-made group someone can play with to see what
-- Baantwise looks like after a couple of months of use.
--
-- - Each person gets their own copy (create_sample_group); nobody else is in it.
--   The other three people are guests, so no one is ever emailed.
-- - The person picks which sample housemate to be; their member row takes that name.
-- - Samples can't be joined (no invite link), can't receive forwarded bills, and
--   can't have receipt photos. The app also hides receipt scanning there, so a
--   sample never uses the paid AI.
-- - Delete it like any group (Group settings → Delete group). Make a new one to
--   be someone else.

alter table public.groups add column is_sample boolean not null default false;
comment on column public.groups.is_sample is
  'A private sample group made by create_sample_group: no invites, no forwarded bills, no receipts.';

-- Invites: a sample group can't be looked up or joined.
create or replace function public.get_invite(p_token uuid)
returns table (group_id uuid, group_name text, member_count integer, already_member boolean)
language sql stable security definer set search_path = ''
as $$
  select
    g.id,
    g.name,
    (select count(*)::integer from public.group_members m
      where m.group_id = g.id and m.removed_at is null),
    private.is_group_member(g.id)
  from public.groups g
  where g.invite_token = p_token
    and not g.is_sample
    and (select auth.uid()) is not null;
$$;

create or replace function public.join_group(p_token uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select g.id into v_group_id from public.groups g
   where g.invite_token = p_token and not g.is_sample;
  if v_group_id is null then
    raise exception 'This invite link doesn''t work any more. Ask someone in the group for a new one.'
      using errcode = 'P0002';
  end if;
  insert into public.group_members (group_id, user_id, display_name)
  values (v_group_id, v_uid, private.my_display_name())
  on conflict (group_id, user_id) do update set removed_at = null;
  return v_group_id;
end;
$$;

-- Receipt photos: none in sample groups.
create or replace function private.can_add_receipt(p_expense_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_recent bigint;
begin
  if not exists (
    select 1 from public.expenses e
    join public.groups g on g.id = e.group_id
    where e.id = p_expense_id
      and e.deleted_at is null
      and e.created_by = (select auth.uid())
      and not g.is_sample
      and private.is_group_member(e.group_id)
  ) then
    return false;
  end if;
  begin
    select count(*) into v_recent
    from storage.objects o
    where o.bucket_id = 'receipts'
      and o.owner_id = (select auth.uid())::text
      and o.created_at > now() - interval '24 hours';
  exception when insufficient_privilege or undefined_column or undefined_table then
    return true;
  end;
  return v_recent < 50;
end;
$$;

-- Forwarded bills: a sample group's bill address goes nowhere.
create or replace function public.inbound_match(p_token text, p_emails text[])
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
   where g.forward_token = lower(btrim(p_token))
     and not g.is_sample;
$$;

-- Makes (or returns) this person's sample group. p_persona is the housemate they
-- want to be: 'Priya', 'Sam', 'Alex' or 'Jordan'. Dates count back from today.
create or replace function public.create_sample_group(p_persona text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := private.toronto_today();
  v_group uuid;
  v_names text[] := array['Priya', 'Sam', 'Alex', 'Jordan'];
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_name text;
  m_priya uuid; m_sam uuid; m_alex uuid; m_jordan uuid;
  e record;
  v_expense uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if p_persona is null or not (p_persona = any (v_names)) then
    raise exception 'Pick who you want to be: Priya, Sam, Alex or Jordan' using errcode = '22023';
  end if;

  -- One sample at a time: if there's already one, open that.
  select g.id into v_group
    from public.groups g
    join public.group_members gm on gm.group_id = g.id
   where g.is_sample and gm.user_id = v_uid and gm.removed_at is null
   order by g.created_at desc
   limit 1;
  if v_group is not null then
    return v_group;
  end if;

  insert into public.groups (name, created_by, is_sample)
  values ('Maple Street (sample)', v_uid, true)
  returning id into v_group;

  foreach v_name in array v_names loop
    insert into public.group_members (group_id, user_id, display_name, is_admin, created_at)
    values (v_group,
            case when v_name = p_persona then v_uid end,
            v_name,
            v_name = p_persona,
            now() - interval '60 days' + (array_position(v_names, v_name) * interval '1 minute'))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  m_priya := v_ids[1]; m_sam := v_ids[2]; m_alex := v_ids[3]; m_jordan := v_ids[4];

  -- days ago, what, category, cents, paid by, who's in it, private?
  for e in
    select * from (values
      (58, 'Rent, September',              'housing',       280000::bigint, m_priya,  array[m_priya, m_sam, m_alex, m_jordan], false),
      (55, 'Costco run',                   'groceries',      18640::bigint, m_sam,    array[m_priya, m_sam, m_alex, m_jordan], false),
      (50, 'Hydro, August',                'utilities',       9620::bigint, m_priya,  array[m_priya, m_sam, m_alex, m_jordan], false),
      (44, 'Pizza night',                  'food',            5280::bigint, m_alex,   array[m_sam, m_alex, m_jordan],          false),
      (40, 'Internet, September',          'utilities',       8250::bigint, m_jordan, array[m_priya, m_sam, m_alex, m_jordan], false),
      (33, 'No Frills groceries',          'groceries',      12477::bigint, m_sam,    array[m_priya, m_sam, m_alex, m_jordan], false),
      (28, 'Rent, October',                'housing',       280000::bigint, m_priya,  array[m_priya, m_sam, m_alex, m_jordan], false),
      (25, 'Uber home from the airport',   'transport',       4300::bigint, m_alex,   array[m_priya, m_alex],                  true),
      (20, 'Enbridge gas',                 'utilities',       6810::bigint, m_priya,  array[m_priya, m_sam, m_alex, m_jordan], false),
      (14, 'Cleaning supplies',            'shopping',        3490::bigint, m_jordan, array[m_priya, m_sam, m_alex, m_jordan], false),
      (9,  'Movie night snacks',           'entertainment',   2760::bigint, m_alex,   array[m_priya, m_sam, m_alex, m_jordan], false),
      (3,  'FreshCo groceries',            'groceries',       9353::bigint, m_sam,    array[m_priya, m_sam, m_alex, m_jordan], false)
    ) as t (days_ago, description, category, cents, paid_by, people, private)
  loop
    insert into public.expenses (group_id, description, amount_cents, paid_by, spent_on, visibility,
                                 created_by, created_at, category, split_method)
    values (v_group, e.description, e.cents, e.paid_by, v_today - e.days_ago,
            case when e.private then 'participants' else 'group' end,
            v_uid, now() - make_interval(days => e.days_ago), e.category, 'equally')
    returning id into v_expense;
    insert into public.expense_shares (expense_id, member_id, share_cents)
    select v_expense, s.member_id, s.share_cents
      from private.split_cents(e.cents, e.people, array_fill(1::numeric, array[cardinality(e.people)]), e.paid_by) s;
  end loop;

  insert into public.settlements (group_id, from_member, to_member, amount_cents, paid_on, visibility, created_by, created_at)
  values (v_group, m_sam, m_priya, 70000, v_today - 52, 'group', v_uid, now() - interval '52 days'),
         (v_group, m_jordan, m_priya, 70000, v_today - 48, 'group', v_uid, now() - interval '48 days'),
         (v_group, m_alex, m_priya, 50000, v_today - 30, 'group', v_uid, now() - interval '30 days'),
         (v_group, m_jordan, m_sam, 6000, v_today - 12, 'group', v_uid, now() - interval '12 days');

  return v_group;
end;
$$;

revoke all on function public.create_sample_group(text) from public, anon;
grant execute on function public.create_sample_group(text) to authenticated;

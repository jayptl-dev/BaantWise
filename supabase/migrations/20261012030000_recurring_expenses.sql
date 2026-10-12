-- Baantwise, Phase 3: recurring expenses (rent, internet, a phone plan...).
--
-- In plain words:
--   A recurring expense is a rule: "Rent, CA$2,400, paid by Jay, split equally
--   between everyone, on the 1st of every month". Three settings, each on its own:
--     1. When (frequency + start date, optional end date): weekly, every 2 weeks,
--        monthly or yearly. Monthly follows the start day; a start on the 31st
--        falls on the last day of shorter months.
--     2. How much: the same amount every time ('fixed'), or an amount that changes
--        ('variable', like a hydro bill): then the person who set it up gets a
--        "bill to fill in" each time instead of an expense.
--     3. Who it's split with: everyone in the group at that moment (people who join
--        later are included automatically), or chosen people only, split equally,
--        by percent, by shares or (fixed amounts only) by exact amounts.
--   A scheduled job (pg_cron, every hour) makes the expenses that are due, as if the
--   person who set up the rule had added them: they can edit or delete each one,
--   and the expense follows the rule's privacy (whole group, or only the people in it).
--   The leftover-cent rule is the app's (src/lib/split.ts): biggest dropped fraction
--   first, ties to the payer, then member order.
--   Only the person who set up a rule can change, pause or delete it. Deleting a rule
--   never deletes the expenses it already made.

create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  category text not null default 'other'
    check (category in ('food', 'groceries', 'transport', 'housing', 'utilities',
                        'entertainment', 'travel', 'shopping', 'health', 'other')),
  paid_by uuid not null,
  visibility text not null default 'group' check (visibility in ('group', 'participants')),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly')),
  start_on date not null check (start_on >= date '2000-01-01'),
  end_on date check (end_on >= start_on),
  amount_kind text not null check (amount_kind in ('fixed', 'variable')),
  amount_cents bigint check (amount_cents between 1 and 100000000),
  split jsonb not null,
  paused boolean not null default false,
  -- Worked out by the database, never sent by the app:
  next_index integer not null default 0 check (next_index >= 0), -- occurrences already made
  next_on date, -- the next one, or null when the rule has ended
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (group_id, paid_by) references public.group_members (group_id, id),
  check ((amount_kind = 'fixed') = (amount_cents is not null))
);
comment on table public.recurring_expenses is
  'A rule that adds the same expense on a schedule (rent, internet...). Made into expenses by private.run_recurring() (pg_cron, hourly). Only created_by can change it; change it through save_recurring.';
comment on column public.recurring_expenses.split is
  '{"method": "equally"|"percent"|"shares"|"exact", "members": null | [{"member_id": "...", "value": n}]}. members null = everyone in the group at that moment (equally only). percent: 0-100, 2 decimals, adds up to 100; shares: whole numbers 1-1000; exact (fixed only): cents adding up to amount_cents; equally: value 1.';
comment on column public.recurring_expenses.next_on is
  'When the next expense (or bill to fill in) is made. null = the rule has ended.';

create index recurring_expenses_due on public.recurring_expenses (next_on) where not paused and next_on is not null;
create index recurring_expenses_group on public.recurring_expenses (group_id);

-- A "bill to fill in" for a variable-amount rule: the person who set it up enters the
-- amount, which adds a normal expense.
create table public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  recurring_id uuid not null references public.recurring_expenses (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  due_on date not null,
  expense_id uuid references public.expenses (id) on delete set null,
  closed_at timestamptz, -- filled in or skipped
  created_at timestamptz not null default now(),
  unique (recurring_id, due_on)
);
comment on table public.recurring_bills is
  'A bill to fill in, made for a variable-amount recurring expense. Only the person who set up the rule sees it. Closed with complete_recurring_bill or skip_recurring_bill.';

-- The expense a rule made (for the "repeats" mark on expense rows).
alter table public.expenses
  add column recurring_id uuid references public.recurring_expenses (id) on delete set null;
comment on column public.expenses.recurring_id is
  'The recurring expense rule that made this expense, if any. Set by the database only.';

create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- The i-th date of a schedule (i = 0 is the start). Months and years count from the
-- start date, so the 31st becomes the last day of a shorter month and comes back.
create function private.recurring_date(p_start date, p_frequency text, p_index integer)
returns date language sql immutable set search_path = ''
as $$
  select case p_frequency
    when 'weekly' then p_start + 7 * p_index
    when 'biweekly' then p_start + 14 * p_index
    when 'monthly' then (p_start + make_interval(months => p_index))::date
    when 'yearly' then (p_start + make_interval(years => p_index))::date
  end;
$$;

-- Today in Toronto (Baantwise's users are in Canada).
create function private.toronto_today()
returns date language sql stable set search_path = ''
as $$
  select (now() at time zone 'America/Toronto')::date;
$$;

-- The first occurrence on or after a date (used so a rule never back-fills the past).
create function private.recurring_first_index(p_start date, p_frequency text, p_from date)
returns integer language plpgsql immutable set search_path = ''
as $$
declare
  i integer := 0;
begin
  if p_start >= p_from then
    return 0;
  end if;
  -- A quick jump close to the date, then step.
  i := greatest(0, case p_frequency
    when 'weekly' then (p_from - p_start) / 7
    when 'biweekly' then (p_from - p_start) / 14
    when 'monthly' then ((extract(year from p_from) - extract(year from p_start)) * 12
                         + extract(month from p_from) - extract(month from p_start))::integer - 1
    when 'yearly' then (extract(year from p_from) - extract(year from p_start))::integer - 1
  end);
  while private.recurring_date(p_start, p_frequency, i) < p_from loop
    i := i + 1;
  end loop;
  return i;
end;
$$;

-- Splits a total in proportion to whole-number weights, in the order given, with the
-- app's leftover-cent rule: everyone rounded down, then the leftover cents one at a time
-- to the biggest dropped fraction; ties to the payer, then whoever is listed first.
create function private.split_cents(p_total bigint, p_ids uuid[], p_weights numeric[], p_payer uuid)
returns table (member_id uuid, share_cents bigint)
language sql immutable set search_path = ''
as $$
  with w as (
    select ids.id, ids.ord, greatest(coalesce(p_weights[ids.ord], 0), 0) as weight
    from unnest(p_ids) with ordinality as ids (id, ord)
  ),
  total as (select sum(weight) as s from w),
  parts as (
    select w.id, w.ord,
           floor(p_total * w.weight / t.s)::bigint as down,
           (p_total * w.weight) - floor(p_total * w.weight / t.s) * t.s as dropped
    from w, total t
    where t.s > 0
  ),
  ranked as (
    select parts.*,
           row_number() over (order by dropped desc, (id = p_payer) desc, ord) as rank,
           p_total - sum(down) over () as leftover
    from parts
  )
  select id, down + case when rank <= leftover then 1 else 0 end
  from ranked
  order by ord;
$$;

-- Who the rule splits with right now, and their weights, in member order. People who
-- left or were removed are dropped; whole-group rules use everyone active now.
create function private.recurring_members(p_rule public.recurring_expenses)
returns table (member_id uuid, weight numeric, ord bigint)
language sql stable security definer set search_path = ''
as $$
  select m.id,
         case when p_rule.split -> 'members' is null or jsonb_typeof(p_rule.split -> 'members') = 'null'
              then 1
              else (select (e ->> 'value')::numeric from jsonb_array_elements(p_rule.split -> 'members') e
                    where e ->> 'member_id' = m.id::text)
              end,
         row_number() over (order by m.created_at, m.id)
  from public.group_members m
  where m.group_id = p_rule.group_id
    and m.removed_at is null
    and (
      p_rule.split -> 'members' is null or jsonb_typeof(p_rule.split -> 'members') = 'null'
      or exists (select 1 from jsonb_array_elements(p_rule.split -> 'members') e where e ->> 'member_id' = m.id::text)
    );
$$;

-- Whether the signed-in person can see a rule: everyone in the group for a group one;
-- for a private one, the person who set it up, the payer and the people in its split.
create function private.recurring_visible(p_group_id uuid, p_visibility text, p_created_by uuid,
                                          p_paid_by uuid, p_split jsonb)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_group_member(p_group_id)
    and (
      p_visibility = 'group'
      or p_created_by = (select auth.uid())
      or p_paid_by = private.my_member_id(p_group_id)
      or (p_split -> 'members' is not null and jsonb_typeof(p_split -> 'members') = 'array'
          and exists (select 1 from jsonb_array_elements(p_split -> 'members') e
                      where e ->> 'member_id' = private.my_member_id(p_group_id)::text))
    );
$$;

-- Checks a rule before it's saved, and works out its schedule.
create function private.check_recurring()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_method text := new.split ->> 'method';
  v_members jsonb := new.split -> 'members';
  v_total numeric := 0;
  v_seen uuid[] := '{}';
  v_id uuid;
  v_value numeric;
  m jsonb;
begin
  if tg_op = 'UPDATE' and (new.group_id <> old.group_id or new.created_by <> old.created_by) then
    raise exception 'A recurring expense can''t move to another group or owner' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
     and (new.description, new.category, new.paid_by, new.visibility, new.frequency, new.start_on,
          new.end_on, new.amount_kind, new.amount_cents, new.split)
         is not distinct from
         (old.description, old.category, old.paid_by, old.visibility, old.frequency, old.start_on,
          old.end_on, old.amount_kind, old.amount_cents, old.split) then
    -- Only paused or the schedule changed (pausing, resuming, or the job moving on).
    -- Resuming never back-fills the time it was paused.
    if old.paused and not new.paused then
      new.next_index := greatest(new.next_index,
        private.recurring_first_index(new.start_on, new.frequency, private.toronto_today()));
      new.next_on := private.recurring_date(new.start_on, new.frequency, new.next_index);
      if new.end_on is not null and new.next_on > new.end_on then
        new.next_on := null;
      end if;
    end if;
    return new;
  end if;
  if jsonb_typeof(new.split) <> 'object' or v_method not in ('equally', 'percent', 'shares', 'exact') then
    raise exception 'split.method must be equally, percent, shares or exact' using errcode = '22023';
  end if;
  if v_method = 'exact' and new.amount_kind <> 'fixed' then
    raise exception 'Exact amounts need an amount that''s the same every time' using errcode = '22023';
  end if;

  if v_members is null or jsonb_typeof(v_members) = 'null' then
    if v_method <> 'equally' then
      raise exception 'Only an equal split can be with everyone in the group' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) = 0 then
      raise exception 'Choose at least one person to split with' using errcode = '22023';
    end if;
    for m in select * from jsonb_array_elements(v_members) loop
      if jsonb_typeof(m) <> 'object' or jsonb_typeof(m -> 'value') <> 'number' then
        raise exception 'each split member needs a member_id and a numeric value' using errcode = '22023';
      end if;
      v_id := private.try_uuid(m ->> 'member_id');
      if v_id is null or v_id = any(v_seen) then
        raise exception 'each split member must be listed once' using errcode = '22023';
      end if;
      v_seen := v_seen || v_id;
      if not exists (select 1 from public.group_members gm
                     where gm.id = v_id and gm.group_id = new.group_id and gm.removed_at is null) then
        raise exception 'everyone in the split must be in this group' using errcode = '22023';
      end if;
      v_value := (m ->> 'value')::numeric;
      if (v_method = 'percent' and (v_value < 0 or v_value > 100 or v_value <> round(v_value, 2)))
         or (v_method = 'shares' and (v_value < 1 or v_value > 1000 or v_value <> floor(v_value)))
         or (v_method = 'exact' and (v_value < 0 or v_value <> floor(v_value)))
         or (v_method = 'equally' and v_value <> 1) then
        raise exception 'a split value is out of range' using errcode = '22023';
      end if;
      v_total := v_total + v_value;
    end loop;
    if v_method = 'percent' and v_total <> 100 then
      raise exception 'The percentages must add up to exactly 100' using errcode = '23514';
    end if;
    if v_method = 'exact' and v_total <> new.amount_cents then
      raise exception 'The amounts must add up to the total' using errcode = '23514';
    end if;
  end if;

  if not exists (select 1 from public.group_members gm
                 where gm.id = new.paid_by and gm.group_id = new.group_id and gm.removed_at is null) then
    raise exception 'The person who pays must be in this group' using errcode = '22023';
  end if;

  -- The schedule: never back-fills the past. Recomputed whenever the timing changes.
  if tg_op = 'INSERT' or new.start_on <> old.start_on or new.frequency <> old.frequency
     or new.end_on is distinct from old.end_on then
    new.next_index := private.recurring_first_index(new.start_on, new.frequency, private.toronto_today());
  end if;
  new.next_on := private.recurring_date(new.start_on, new.frequency, new.next_index);
  if new.end_on is not null and new.next_on > new.end_on then
    new.next_on := null;
  end if;
  return new;
end;
$$;

create trigger recurring_expenses_check
  before insert or update on public.recurring_expenses
  for each row execute function private.check_recurring();

-- ---------------------------------------------------------------------------
-- 3. Making the expenses (the scheduled job)
-- ---------------------------------------------------------------------------

-- Makes everything that's due, up to today (Toronto). Fixed amounts become expenses;
-- variable ones become bills to fill in. A rule pauses itself if its owner or payer
-- left the group, or nobody is left to split with. At most 24 per rule per run, so a
-- long-paused rule can't flood a group.
create function private.run_recurring()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  r public.recurring_expenses;
  v_today date := private.toronto_today();
  v_made integer := 0;
  v_count integer;
  v_ids uuid[];
  v_weights numeric[];
  v_expense uuid;
  v_method text;
  v_snapshot jsonb;
  v_all_listed boolean;
begin
  for r in
    select * from public.recurring_expenses
    where not paused and next_on is not null and next_on <= v_today
    order by next_on
    for update skip locked
  loop
    v_count := 0;
    while r.next_on is not null and r.next_on <= v_today and v_count < 24 loop
      -- Still in the group: the owner and the payer.
      if not exists (select 1 from public.group_members gm
                     where gm.group_id = r.group_id and gm.user_id = r.created_by and gm.removed_at is null)
         or not exists (select 1 from public.group_members gm
                        where gm.id = r.paid_by and gm.removed_at is null) then
        update public.recurring_expenses set paused = true where id = r.id;
        exit;
      end if;

      select array_agg(rm.member_id order by rm.ord), array_agg(rm.weight order by rm.ord)
        into v_ids, v_weights
        from private.recurring_members(r) rm;
      if v_ids is null then
        update public.recurring_expenses set paused = true where id = r.id;
        exit;
      end if;

      if r.amount_kind = 'fixed' then
        -- If everyone listed is still here, the expense remembers the split the same
        -- way the app would; otherwise it's saved as plain amounts.
        v_all_listed := r.split -> 'members' is null or jsonb_typeof(r.split -> 'members') = 'null'
          or jsonb_array_length(r.split -> 'members') = coalesce(array_length(v_ids, 1), 0);
        v_method := case when r.split ->> 'method' = 'equally' then 'equally'
                         when r.split ->> 'method' in ('percent', 'shares') and v_all_listed then r.split ->> 'method'
                         else 'exact' end;
        v_snapshot := case when v_method in ('percent', 'shares') then r.split -> 'members' else null end;

        insert into public.expenses (group_id, description, amount_cents, paid_by, spent_on, visibility,
                                     category, split_method, split_snapshot, created_by, recurring_id)
        values (r.group_id, r.description, r.amount_cents, r.paid_by, r.next_on, r.visibility,
                r.category, v_method, v_snapshot, r.created_by, r.id)
        returning id into v_expense;

        insert into public.expense_shares (expense_id, member_id, share_cents)
        select v_expense, s.member_id, s.share_cents
        from private.split_cents(r.amount_cents, v_ids,
               case when r.split ->> 'method' = 'percent' then (select array_agg(w * 100) from unnest(v_weights) w)
                    else v_weights end,
               r.paid_by) s;
      else
        insert into public.recurring_bills (recurring_id, group_id, due_on)
        values (r.id, r.group_id, r.next_on)
        on conflict (recurring_id, due_on) do nothing;
      end if;

      v_made := v_made + 1;
      v_count := v_count + 1;
      r.next_index := r.next_index + 1;
      r.next_on := private.recurring_date(r.start_on, r.frequency, r.next_index);
      if r.end_on is not null and r.next_on > r.end_on then
        r.next_on := null;
      end if;
    end loop;
    -- Only next_* change here, so the check trigger lets it through as it is.
    update public.recurring_expenses
       set next_index = r.next_index, next_on = r.next_on
     where id = r.id;
  end loop;
  return v_made;
end;
$$;
comment on function private.run_recurring() is
  'Makes the recurring expenses (and bills to fill in) that are due up to today in Toronto. Run hourly by pg_cron (job baantwise-recurring).';

-- ---------------------------------------------------------------------------
-- 4. What people can do (all with their own permissions)
-- ---------------------------------------------------------------------------

-- Add (p_id null) or change a recurring expense. Returns its id.
create function public.save_recurring(
  p_group_id uuid,
  p_description text,
  p_category text,
  p_paid_by uuid,
  p_visibility text,
  p_frequency text,
  p_start_on date,
  p_end_on date,
  p_amount_kind text,
  p_amount_cents bigint,
  p_split jsonb,
  p_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if p_id is null then
    insert into public.recurring_expenses (group_id, description, category, paid_by, visibility, frequency,
                                           start_on, end_on, amount_kind, amount_cents, split)
    values (p_group_id, btrim(p_description), coalesce(p_category, 'other'), p_paid_by, coalesce(p_visibility, 'group'),
            p_frequency, p_start_on, p_end_on, p_amount_kind,
            case when p_amount_kind = 'fixed' then p_amount_cents end, p_split)
    returning id into v_id;
  else
    update public.recurring_expenses
       set description = btrim(p_description),
           category = coalesce(p_category, category),
           paid_by = p_paid_by,
           visibility = coalesce(p_visibility, visibility),
           frequency = p_frequency,
           start_on = p_start_on,
           end_on = p_end_on,
           amount_kind = p_amount_kind,
           amount_cents = case when p_amount_kind = 'fixed' then p_amount_cents end,
           split = p_split
     where id = p_id and group_id = p_group_id;
    if not found then
      raise exception 'Only the person who set up this recurring expense can change it' using errcode = '42501';
    end if;
  end if;
  return v_id;
end;
$$;

-- Fill in a bill: links the expense the person just added (with save_expense) to it.
create function public.complete_recurring_bill(p_bill_id uuid, p_expense_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.recurring_bills b
     set expense_id = p_expense_id, closed_at = now()
    from public.recurring_expenses r
   where b.id = p_bill_id
     and r.id = b.recurring_id
     and r.created_by = (select auth.uid())
     and b.closed_at is null
     and exists (select 1 from public.expenses e
                 where e.id = p_expense_id and e.group_id = b.group_id
                   and e.created_by = (select auth.uid()) and e.deleted_at is null);
  if not found then
    raise exception 'That bill is already done, or isn''t yours' using errcode = '42501';
  end if;
  update public.expenses set recurring_id = (select recurring_id from public.recurring_bills where id = p_bill_id)
   where id = p_expense_id;
end;
$$;

-- Skip a bill (nothing to pay this time).
create function public.skip_recurring_bill(p_bill_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.recurring_bills b
     set closed_at = now()
    from public.recurring_expenses r
   where b.id = p_bill_id and r.id = b.recurring_id
     and r.created_by = (select auth.uid()) and b.closed_at is null;
  if not found then
    raise exception 'That bill is already done, or isn''t yours' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and grants
-- ---------------------------------------------------------------------------
alter table public.recurring_expenses enable row level security;
alter table public.recurring_bills enable row level security;

create policy "See group recurring expenses, and private ones you are part of"
  on public.recurring_expenses for select to authenticated
  using (private.recurring_visible(group_id, visibility, created_by, paid_by, split));
create policy "Members can set up recurring expenses as themselves"
  on public.recurring_expenses for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_group_member(group_id));
create policy "Only the person who set up a recurring expense can change it"
  on public.recurring_expenses for update to authenticated
  using (created_by = (select auth.uid()) and private.is_group_member(group_id))
  with check (created_by = (select auth.uid()) and private.is_group_member(group_id));
create policy "Only the person who set up a recurring expense can delete it"
  on public.recurring_expenses for delete to authenticated
  using (created_by = (select auth.uid()) and private.is_group_member(group_id));

create policy "See your own bills to fill in"
  on public.recurring_bills for select to authenticated
  using (exists (select 1 from public.recurring_expenses r
                 where r.id = recurring_id and r.created_by = (select auth.uid()))
         and private.is_group_member(group_id));

revoke all on table public.recurring_expenses, public.recurring_bills from anon, authenticated;
grant select, delete on table public.recurring_expenses to authenticated;
grant insert (group_id, description, category, paid_by, visibility, frequency, start_on, end_on,
              amount_kind, amount_cents, split),
      update (description, category, paid_by, visibility, frequency, start_on, end_on,
              amount_kind, amount_cents, split, paused)
  on table public.recurring_expenses to authenticated;
grant select on table public.recurring_bills to authenticated;

revoke execute on function
  private.recurring_date(date, text, integer),
  private.toronto_today(),
  private.recurring_first_index(date, text, date),
  private.split_cents(bigint, uuid[], numeric[], uuid),
  private.recurring_members(public.recurring_expenses),
  private.run_recurring()
from public, anon, authenticated;
revoke execute on function private.recurring_visible(uuid, text, uuid, uuid, jsonb) from public, anon;
grant execute on function private.recurring_visible(uuid, text, uuid, uuid, jsonb) to authenticated;
-- The check trigger runs as the person saving and needs these two.
grant execute on function private.recurring_date(date, text, integer), private.toronto_today(),
  private.recurring_first_index(date, text, date) to authenticated;
revoke execute on function private.check_recurring() from public;

revoke execute on function
  public.save_recurring(uuid, text, text, uuid, text, text, date, date, text, bigint, jsonb, uuid),
  public.complete_recurring_bill(uuid, uuid),
  public.skip_recurring_bill(uuid)
from public, anon;
grant execute on function
  public.save_recurring(uuid, text, text, uuid, text, text, date, date, text, bigint, jsonb, uuid),
  public.complete_recurring_bill(uuid, uuid),
  public.skip_recurring_bill(uuid)
to authenticated;

-- Not in the live-updates publication on purpose: a deleted rule's id would reach every
-- subscriber (see CLAUDE.md). The screens load rules when they open.

-- ---------------------------------------------------------------------------
-- 6. The schedule: every hour, at 7 minutes past.
-- ---------------------------------------------------------------------------
select cron.schedule('baantwise-recurring', '7 * * * *', 'select private.run_recurring()');

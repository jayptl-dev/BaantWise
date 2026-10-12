-- Baantwise, Phase 2: currency conversion (Bank of Canada rates).
--
-- In plain words:
-- 1. An expense paid in another currency (say US$84.50 on a trip) keeps what was
--    really paid: original_currency 'USD', original_amount_cents 8450 and fx_rate
--    1.3672 (Canadian dollars for 1 US dollar). fx_rate_date is the Bank of Canada
--    date the rate comes from; it is empty when the person typed their own rate
--    (for example cash bought at a booth).
-- 2. amount_cents and every share stay in Canadian cents, so balances, charts and
--    settling up work exactly as before. The database checks that amount_cents is
--    original_amount_cents x fx_rate rounded to the nearest cent (half a cent goes
--    up), so the two amounts can never disagree.
-- 3. The currency details are all empty (a normal CAD expense) or all filled in
--    (except fx_rate_date, which may be empty). The currency can't be the group's
--    own currency. Groups themselves stay in CAD for now.
-- 4. save_expense gets four optional parameters at the end. They always describe
--    the expense as it is saved: leaving them out makes it a plain CAD expense,
--    also when editing (that's how an expense is switched back to CAD).
-- 5. Privacy doesn't change: the details are part of the expense row, so they
--    follow the expense's rules (a private expense stays private, currency and all).

-- ---------------------------------------------------------------------------
-- 1. New columns and their rules
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column original_currency text,
  add column original_amount_cents bigint,
  add column fx_rate numeric,
  add column fx_rate_date date;

-- Postgres checks these in alphabetical order of name, so the simple rules come
-- first and "original x rate = amount" (the ..._times_rate_... name) comes last:
-- a zero rate is reported as a bad rate, not as a wrong total.
alter table public.expenses
  add constraint expenses_currency_details_all_or_none check (
    (original_currency is null and original_amount_cents is null
       and fx_rate is null and fx_rate_date is null)
    or (original_currency is not null and original_amount_cents is not null
       and fx_rate is not null)
  ),
  add constraint expenses_original_currency_is_a_code
    check (original_currency ~ '^[A-Z]{3}$'),
  add constraint expenses_original_amount_in_range
    check (original_amount_cents between 1 and 10000000000000),
  add constraint expenses_fx_rate_in_range
    check (fx_rate > 0 and fx_rate < 10000 and fx_rate = round(fx_rate, 10)),
  add constraint expenses_fx_rate_date_not_after_spent_on
    check (fx_rate_date <= spent_on),
  add constraint expenses_original_times_rate_equals_amount
    check (original_currency is null
           or amount_cents = round(original_amount_cents * fx_rate));

comment on column public.expenses.original_currency is
  'Currency the expense was really paid in (ISO code like USD). Empty = paid in the group''s currency. amount_cents and the shares are always in the group''s currency.';
comment on column public.expenses.original_amount_cents is
  'Amount paid in original_currency, in hundredths of that currency (US$84.50 = 8450; also for currencies without cents: 1,500 yen = 150000).';
comment on column public.expenses.fx_rate is
  'Group-currency units for 1 unit of original_currency (1.3672 = CA$1.3672 per US$1), at most 10 decimals. amount_cents = original_amount_cents x fx_rate, rounded half up.';
comment on column public.expenses.fx_rate_date is
  'Bank of Canada date the rate comes from (the latest published rate on or before spent_on). Empty with a rate = the person typed their own rate.';

-- The original currency can't be the group's own currency. The group is read
-- with the caller's own permissions: for someone outside the group nothing is
-- found and the normal privacy rules reject the change instead.
create function private.check_expense_currency()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.original_currency is not null and exists (
    select 1 from public.groups g
    where g.id = new.group_id
      and g.currency = new.original_currency
  ) then
    raise exception 'This expense is already in the group''s currency (%), so it doesn''t need converting', new.original_currency
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_expense_currency() from public;

create trigger expenses_check_currency
  before insert or update of original_currency, group_id on public.expenses
  for each row execute function private.check_expense_currency();

-- save_expense runs with the caller's own permissions, so people need these
-- column grants. Writing the columns directly is safe: the rules above apply to
-- every write, and only the person who added an expense can change it.
grant insert (original_currency, original_amount_cents, fx_rate, fx_rate_date),
      update (original_currency, original_amount_cents, fx_rate, fx_rate_date)
  on table public.expenses to authenticated;


-- ---------------------------------------------------------------------------
-- 2. save_expense with the currency details. Everything from the earlier steps
--    stays exactly as it was (p_visibility and p_category: null keeps the current
--    value on an edit; p_split 10th: sent on every save), plus four new parameters
--    at the end.
-- ---------------------------------------------------------------------------
drop function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb);

create function public.save_expense(
  p_group_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_visibility text default null,  -- null: 'group' for a new expense, unchanged on an edit
  p_spent_on date default null,
  p_expense_id uuid default null,
  p_category text default null,
  p_split jsonb default null,
  p_original_currency text default null,
  p_original_amount_cents bigint default null,
  p_fx_rate numeric default null,
  p_fx_rate_date date default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := p_expense_id;
  v_total bigint;
  v_split_method text := coalesce(p_split ->> 'method', 'exact');
  v_split_snapshot jsonb := case when coalesce(p_split ->> 'method', 'exact') in ('percent', 'shares')
                                 then p_split -> 'members' else null end;
begin
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Choose at least one person to split with' using errcode = '22023';
  end if;
  select coalesce(sum((s ->> 'share_cents')::bigint), 0) into v_total
  from jsonb_array_elements(p_shares) s;
  if v_total is distinct from p_amount_cents then
    raise exception 'The split (% cents) doesn''t add up to the total (% cents)', v_total, p_amount_cents
      using errcode = '23514';
  end if;

  -- Currency details come as a set: none (CAD) or currency + amount + rate.
  if (p_original_currency is not null or p_original_amount_cents is not null
      or p_fx_rate is not null or p_fx_rate_date is not null)
     and (p_original_currency is null or p_original_amount_cents is null or p_fx_rate is null) then
    raise exception 'A foreign amount needs its currency, its amount and the exchange rate'
      using errcode = '22023';
  end if;

  if p_expense_id is null then
    insert into public.expenses (group_id, description, amount_cents, paid_by, spent_on, visibility,
                                 category, split_method, split_snapshot,
                                 original_currency, original_amount_cents, fx_rate, fx_rate_date)
    values (p_group_id, btrim(p_description), p_amount_cents, p_paid_by,
            coalesce(p_spent_on, current_date), coalesce(p_visibility, 'group'),
            coalesce(p_category, 'other'), v_split_method, v_split_snapshot,
            p_original_currency, p_original_amount_cents, trim_scale(p_fx_rate), p_fx_rate_date)
    returning id into v_id;
  else
    -- The currency details are replaced every time, like the split:
    -- all four null turns a foreign expense back into a plain CAD expense.
    update public.expenses
       set description = btrim(p_description),
           amount_cents = p_amount_cents,
           paid_by = p_paid_by,
           spent_on = coalesce(p_spent_on, spent_on),
           visibility = coalesce(p_visibility, visibility),
           category = coalesce(p_category, category),
           split_method = v_split_method,
           split_snapshot = v_split_snapshot,
           original_currency = p_original_currency,
           original_amount_cents = p_original_amount_cents,
           fx_rate = trim_scale(p_fx_rate),
           fx_rate_date = p_fx_rate_date
     where id = p_expense_id
       and group_id = p_group_id
       and deleted_at is null;
    if not found then
      raise exception 'Only the person who added this expense can change it' using errcode = '42501';
    end if;
    delete from public.expense_shares where expense_id = p_expense_id;
  end if;

  insert into public.expense_shares (expense_id, member_id, share_cents)
  select v_id, (s ->> 'member_id')::uuid, (s ->> 'share_cents')::bigint
  from jsonb_array_elements(p_shares) s;

  return v_id;
end;
$$;
comment on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb, text, bigint, numeric, date) is
  'Add (p_expense_id null) or edit an expense and its split together. Shares must add up to the amount. Only the person who added an expense can edit it. Visibility and category left out: group and other for a new expense, unchanged on an edit. p_split remembers the split screen (send it on every save). Foreign expenses: pass p_original_currency, p_original_amount_cents and p_fx_rate (+ p_fx_rate_date for a Bank of Canada rate); amount_cents must equal round(original x rate). These four are replaced on every save: all null = a plain CAD expense.';
revoke execute on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb, text, bigint, numeric, date) from public, anon;
grant execute on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb, text, bigint, numeric, date) to authenticated;

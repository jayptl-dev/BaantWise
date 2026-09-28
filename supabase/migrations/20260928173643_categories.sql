-- Baantwise, Phase 2: categories. Every expense gets one category from
-- a fixed list (food, groceries, transport, housing, utilities,
-- entertainment, travel, shopping, health, other). Default: other.
--
-- Privacy fix (coordinator): p_visibility now defaults to null instead of 'group'.
-- A new expense still becomes 'group' when it is left out, but an edit that leaves it
-- out now keeps the expense's current visibility. Before, an edit that forgot it
-- silently made a private expense visible to the whole group.

alter table public.expenses
  add column category text not null default 'other'
    check (category in ('food', 'groceries', 'transport', 'housing',
                        'utilities', 'entertainment', 'travel', 'shopping',
                        'health', 'other'));
comment on column public.expenses.category is
  'One of: food, groceries, transport, housing, utilities, entertainment, travel, shopping, health, other. Used for charts and receipt scanning suggestions.';

-- Grant column permissions: authenticated users can set/change the category
-- when adding or editing an expense.
grant insert (category), update (category) on table public.expenses to authenticated;

-- Update save_expense to accept and store the category.
-- New expense: null means 'other'. Edit: null keeps the current value.
-- Drop the old 8-argument signature first (never leave two overloads).
drop function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid);

create function public.save_expense(
  p_group_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_visibility text default null,  -- null: 'group' for a new expense, unchanged on an edit
  p_spent_on date default null,
  p_expense_id uuid default null,
  p_category text default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := p_expense_id;
  v_total bigint;
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

  if p_expense_id is null then
    insert into public.expenses (group_id, description, amount_cents, paid_by, spent_on, visibility, category)
    values (p_group_id, btrim(p_description), p_amount_cents, p_paid_by,
            coalesce(p_spent_on, current_date), coalesce(p_visibility, 'group'),
            coalesce(p_category, 'other'))
    returning id into v_id;
  else
    update public.expenses
       set description = btrim(p_description),
           amount_cents = p_amount_cents,
           paid_by = p_paid_by,
           spent_on = coalesce(p_spent_on, spent_on),
           visibility = coalesce(p_visibility, visibility),
           category = coalesce(p_category, category)
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
comment on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text) is
  'Add (p_expense_id null) or edit an expense and its split together. Shares must add up to the amount. Only the person who added an expense can edit it. Visibility and category left out: group and other for a new expense, unchanged on an edit.';

-- Re-apply permissions: the function is now SECURITY INVOKER and must be callable.
revoke execute on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text) from public, anon;
grant execute on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text) to authenticated;

-- Baantwise: keep a scanned receipt's items with the expense, for "Split by item".
--
-- In plain words:
--   Until now the items from a scanned receipt only lived on the screen while adding the
--   expense, and were thrown away on Save. So when someone edited the expense later,
--   "Split by item" was gone and every item had to be redone by hand.
--   Now the items are kept with the expense: each item's plain name, the line as printed
--   on the receipt, its price, and who was ticked on it. Editing the expense opens
--   "Split by item" exactly as it was left.
--
--   Privacy: the items follow their expense's own rule. Whoever can see the expense can
--   see its items (a private expense's items stay private), and only the person who added
--   the expense can change them. They are removed together with the expense.
--   Prices are in the expense's own currency (the receipt's), like its Amount box.
--
--   One row per expense, holding the item list as JSON:
--   [{ "name": "Milk 2%, 4 L", "printed": "PC MLK 2% 4L", "amount_cents": 699,
--      "member_ids": ["<group_members.id>", ...] }, ...]
--   set_expense_items() is how the website saves them; it checks every item first.

create table public.expense_items (
  expense_id uuid primary key references public.expenses (id) on delete cascade,
  items jsonb not null
    check (jsonb_typeof(items) = 'array'
           and jsonb_array_length(items) between 1 and 60
           and pg_column_size(items) <= 65536),
  updated_at timestamptz not null default now()
);
comment on table public.expense_items is
  'The scanned receipt items of an expense, for "Split by item": name, printed line, price (in the expense''s own currency) and who was ticked. Follows the expense''s privacy; only whoever added the expense can change it. Save through set_expense_items().';

alter table public.expense_items enable row level security;

create policy "See the items of expenses you can see"
  on public.expense_items for select to authenticated
  using (private.can_see_expense(expense_id));
create policy "Only the person who added an expense can add its items"
  on public.expense_items for insert to authenticated
  with check (private.can_edit_expense(expense_id));
create policy "Only the person who added an expense can change its items"
  on public.expense_items for update to authenticated
  using (private.can_edit_expense(expense_id))
  with check (private.can_edit_expense(expense_id));
create policy "Only the person who added an expense can remove its items"
  on public.expense_items for delete to authenticated
  using (private.can_edit_expense(expense_id));

revoke all on table public.expense_items from public, anon;
grant select, insert, update, delete on table public.expense_items to authenticated;


-- Saves an expense's items, replacing what was there. An empty list (or null) removes
-- them. Runs with the caller's own permissions, so the rules above still apply; this
-- adds friendly checks on every item first.
create function public.set_expense_items(p_expense_id uuid, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_item jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_name text;
  v_printed text;
  v_amount bigint;
  v_members jsonb;
begin
  select e.group_id into v_group_id
  from public.expenses e
  where e.id = p_expense_id and e.deleted_at is null;
  if v_group_id is null or not private.can_edit_expense(p_expense_id) then
    raise exception 'Only the person who added this expense can change its items' using errcode = '42501';
  end if;

  if p_items is null or (jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) = 0) then
    delete from public.expense_items where expense_id = p_expense_id;
    return;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'A receipt can have at most 60 items' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_printed := nullif(btrim(coalesce(v_item ->> 'printed', '')), '');
    if v_name = '' or char_length(v_name) > 60 or char_length(coalesce(v_printed, '')) > 60 then
      raise exception 'Each item needs a name of up to 60 characters' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'amount_cents') <> 'number'
       or (v_item ->> 'amount_cents') !~ '^-?[0-9]+$' then
      raise exception 'Each item needs a price in whole cents' using errcode = '22023';
    end if;
    v_amount := (v_item ->> 'amount_cents')::bigint;
    if abs(v_amount) > 100000000 then
      raise exception 'An item price is too large' using errcode = '22023';
    end if;
    v_members := coalesce(v_item -> 'member_ids', '[]'::jsonb);
    if jsonb_typeof(v_members) <> 'array' then
      raise exception 'member_ids must be a list' using errcode = '22023';
    end if;
    -- Only people in this expense's group, each once.
    if exists (
      select 1 from jsonb_array_elements_text(v_members) m
      where private.try_uuid(m) is null
         or not exists (select 1 from public.group_members gm
                        where gm.id = private.try_uuid(m) and gm.group_id = v_group_id)
    ) then
      raise exception 'Items can only be shared with people in this group' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(distinct m), '[]'::jsonb) into v_members
    from jsonb_array_elements_text(v_members) m;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'printed', v_printed, 'amount_cents', v_amount, 'member_ids', v_members));
  end loop;

  insert into public.expense_items (expense_id, items, updated_at)
  values (p_expense_id, v_clean, now())
  on conflict (expense_id) do update set items = excluded.items, updated_at = excluded.updated_at;
end;
$$;
comment on function public.set_expense_items(uuid, jsonb) is
  'Save an expense''s receipt items for "Split by item" (replaces them; empty list or null removes them). Each item: name (1-60 chars), printed (optional, up to 60), amount_cents (whole cents, in the expense''s own currency; below 0 for a discount line), member_ids (people in the expense''s group). Only whoever added the expense.';
revoke execute on function public.set_expense_items(uuid, jsonb) from public, anon;
grant execute on function public.set_expense_items(uuid, jsonb) to authenticated;

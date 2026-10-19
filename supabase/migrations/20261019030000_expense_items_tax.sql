-- Baantwise: tax only on taxed items, for "Split by item".
--
-- In plain words:
--   Grocery receipts mark which items are taxed (H, A, GP...). In Ontario basic food has
--   no HST, but pop, snacks and household things do. The app now shares the receipt's tax
--   only among the people on taxed items. To keep that right when the expense is edited
--   later, two small things are saved with the items:
--     taxed      on each item: true or false (left out when the receipt has no tax marks)
--     tax_cents  on the expense's items row: the receipt's tax
--   set_expense_items() gets a third, optional input for the tax. The old function is
--   dropped first, and the new one has a default, so the website keeps working while
--   this change and the new website go live in either order.
--   The table's privacy rules and who can save stay exactly the same.

alter table public.expense_items
  add column tax_cents bigint check (tax_cents between 0 and 100000000);
comment on column public.expense_items.tax_cents is
  'The receipt''s tax (in the expense''s own currency), so "Split by item" can share it only over the taxed items. null when unknown.';

drop function public.set_expense_items(uuid, jsonb);

create function public.set_expense_items(p_expense_id uuid, p_items jsonb, p_tax_cents bigint default null)
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
  v_quantity numeric;
  v_part jsonb;
  v_entry jsonb;
begin
  select e.group_id into v_group_id
  from public.expenses e
  where e.id = p_expense_id and e.deleted_at is null;
  if v_group_id is null or not private.can_edit_expense(p_expense_id) then
    raise exception 'Only the person who added this expense can change its items' using errcode = '42501';
  end if;

  if p_tax_cents is not null and (p_tax_cents < 0 or p_tax_cents > 100000000) then
    raise exception 'The receipt''s tax must be between 0 and 1,000,000.00' using errcode = '22023';
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

    v_entry := jsonb_build_object(
      'name', v_name, 'printed', v_printed, 'amount_cents', v_amount, 'member_ids', v_members);

    -- How many are on the receipt line (optional; a weight like 0.535 is fine).
    if v_item ? 'quantity' and jsonb_typeof(v_item -> 'quantity') <> 'null' then
      if jsonb_typeof(v_item -> 'quantity') <> 'number' then
        raise exception 'An item count must be a number' using errcode = '22023';
      end if;
      v_quantity := (v_item ->> 'quantity')::numeric;
      if v_quantity <= 0 or v_quantity > 9999 then
        raise exception 'An item count must be above 0 and at most 9999' using errcode = '22023';
      end if;
      v_entry := v_entry || jsonb_build_object('quantity', v_quantity);
    end if;

    -- One part of a line broken into parts (optional): which line, and how many.
    if v_item ? 'part' and jsonb_typeof(v_item -> 'part') <> 'null' then
      v_part := v_item -> 'part';
      if jsonb_typeof(v_part) <> 'object'
         or jsonb_typeof(v_part -> 'line') <> 'number' or (v_part ->> 'line') !~ '^[0-9]+$'
         or jsonb_typeof(v_part -> 'count') <> 'number' or (v_part ->> 'count') !~ '^[0-9]+$'
         or (v_part ->> 'line')::int > 59
         or (v_part ->> 'count')::int not between 1 and 99 then
        raise exception 'Each part of a broken line needs a line number and a count from 1 to 99' using errcode = '22023';
      end if;
      v_entry := v_entry || jsonb_build_object('part', jsonb_build_object(
        'line', (v_part ->> 'line')::int, 'count', (v_part ->> 'count')::int));
    end if;

    -- Taxed or not, when the receipt marks taxed items one by one (optional).
    if v_item ? 'taxed' and jsonb_typeof(v_item -> 'taxed') <> 'null' then
      if jsonb_typeof(v_item -> 'taxed') <> 'boolean' then
        raise exception 'taxed must be true or false' using errcode = '22023';
      end if;
      v_entry := v_entry || jsonb_build_object('taxed', (v_item ->> 'taxed')::boolean);
    end if;

    v_clean := v_clean || jsonb_build_array(v_entry);
  end loop;

  insert into public.expense_items (expense_id, items, tax_cents, updated_at)
  values (p_expense_id, v_clean, p_tax_cents, now())
  on conflict (expense_id) do update
    set items = excluded.items, tax_cents = excluded.tax_cents, updated_at = excluded.updated_at;
end;
$$;
comment on function public.set_expense_items(uuid, jsonb, bigint) is
  'Save an expense''s receipt items for "Split by item" (replaces them; empty list or null removes them). Each item: name (1-60 chars), printed (optional, up to 60), amount_cents (whole cents, in the expense''s own currency; below 0 for a discount line), member_ids (people in the expense''s group), quantity (optional), part (optional, {line, count}) and taxed (optional, true/false when the receipt marks taxed items). p_tax_cents: the receipt''s tax, so the tax can be shared only over taxed items when editing. Only whoever added the expense.';
revoke execute on function public.set_expense_items(uuid, jsonb, bigint) from public, anon;
grant execute on function public.set_expense_items(uuid, jsonb, bigint) to authenticated;

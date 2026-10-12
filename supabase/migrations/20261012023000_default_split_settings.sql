-- Baantwise, Phase 2: default split settings.
--
-- In plain words:
--   1. "By percent" and "By shares" are converted to exact cents in the app,
--      then saved through save_expense exactly like "Equally" and "Exact
--      amounts" already are.
--   2. A group can have a default split (groups.default_split), so new expenses can
--      be pre-filled. Only admins can change it (same rule as renaming the group),
--      and the database checks its shape itself, because a signed-in user could write
--      that column directly. null still means "split equally among everyone", so old
--      groups keep working unchanged.
--   3. Expenses remember which split screen made them (split_method), and, for
--      "By percent"/"By shares", the numbers the person typed (split_snapshot), so
--      Edit reopens the same way instead of always showing raw amounts.
--   4. save_expense keeps every earlier parameter in place (including p_category)
--      and gains one more at the end: p_split. p_visibility still defaults to null
--      (left out on an edit = the expense keeps its visibility).
--
-- The two checking functions run with the caller's own permissions (not as the
-- owner), so they can only look up members of groups the caller is in: someone
-- outside a group can't use them to test whether a member id belongs to it.

-- ---------------------------------------------------------------------------
-- 1. groups.default_split
-- ---------------------------------------------------------------------------
alter table public.groups add column default_split jsonb;
comment on column public.groups.default_split is
  'Pre-fills the split on new expenses. null = split equally among everyone (the old behaviour). Otherwise {"method": "percent" | "shares", "members": [{"member_id": "...", "value": ...}]}: percent values are 0-100 with at most 2 decimals and must add up to exactly 100; share values are whole numbers from 1 to 1000. Members left out simply are not covered by the default. Checked by the groups_check_default_split trigger. Admins only (same rule as renaming the group): if a listed member is later removed or leaves, or someone new joins, this is not rewritten automatically; the app compares it against the current member list and shows "Default split needs updating" when they no longer match.';

-- Validates the shape above. A CHECK constraint cannot see other rows, so this is a
-- trigger instead: it looks up public.group_members to confirm every member_id is
-- really in this group and still active.
create function private.check_group_default_split()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_method text;
  v_members jsonb;
  v_seen uuid[] := '{}';
  v_member_id uuid;
  v_value numeric;
  v_percent_total numeric := 0;
  m jsonb;
begin
  if new.default_split is null then
    return new; -- split equally among everyone: always fine
  end if;

  if jsonb_typeof(new.default_split) <> 'object'
     or not (new.default_split ?& array['method', 'members'])
     or (select count(*) from jsonb_object_keys(new.default_split)) <> 2
  then
    raise exception 'default_split must be an object with exactly "method" and "members"' using errcode = '22023';
  end if;

  v_method := new.default_split ->> 'method';
  if v_method not in ('percent', 'shares') then
    raise exception 'default_split method must be "percent" or "shares"' using errcode = '22023';
  end if;

  v_members := new.default_split -> 'members';
  if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) = 0 then
    raise exception 'default_split members must be a non-empty array' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(v_members) loop
    if jsonb_typeof(m) <> 'object'
       or not (m ?& array['member_id', 'value'])
       or (select count(*) from jsonb_object_keys(m)) <> 2
       or jsonb_typeof(m -> 'value') <> 'number'
    then
      raise exception 'each default_split member must have exactly "member_id" and a numeric "value"' using errcode = '22023';
    end if;

    begin
      v_member_id := (m ->> 'member_id')::uuid;
    exception when others then
      raise exception 'default_split member_id must be a uuid' using errcode = '22023';
    end;

    if v_member_id = any(v_seen) then
      raise exception 'default_split lists the same member twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_member_id;

    if not exists (
      select 1 from public.group_members gm
      where gm.id = v_member_id and gm.group_id = new.id and gm.removed_at is null
    ) then
      raise exception 'default_split member_id must be an active member of this group' using errcode = '22023';
    end if;

    v_value := (m ->> 'value')::numeric;
    if v_method = 'percent' then
      if v_value < 0 or v_value > 100 or v_value <> round(v_value, 2) then
        raise exception 'default_split percent values must be between 0 and 100 with at most 2 decimals' using errcode = '22023';
      end if;
      v_percent_total := v_percent_total + v_value;
    else -- shares
      if v_value < 1 or v_value > 1000 or v_value <> floor(v_value) then
        raise exception 'default_split share values must be whole numbers from 1 to 1000' using errcode = '22023';
      end if;
    end if;
  end loop;

  if v_method = 'percent' and round(v_percent_total, 2) <> 100 then
    raise exception 'default_split percentages must add up to exactly 100' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke execute on function private.check_group_default_split() from public;

create trigger groups_check_default_split
  before insert or update of default_split on public.groups
  for each row execute function private.check_group_default_split();

-- Only admins may change it: reuse the existing rename rule (same trust level -
-- an admin who can already rename or delete the group can also set its default
-- split) rather than inventing a second policy. The grant below is what actually
-- lets a member's update statement mention this column; the renamed policy is what
-- then limits which rows (i.e. only rows of groups they admin) that update affects.
alter policy "Admins can rename a group" on public.groups
  rename to "Admins can rename a group or change its default split";
grant update (default_split) on table public.groups to authenticated;

-- ---------------------------------------------------------------------------
-- 2. expenses.split_method / expenses.split_snapshot
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column split_method text not null default 'exact'
    check (split_method in ('equally', 'exact', 'percent', 'shares')),
  add column split_snapshot jsonb;
comment on column public.expenses.split_method is
  'Which split screen made this expense, so Edit reopens the same way: equally, exact (raw amounts), percent or shares. Existing rows default to exact, which always shows correctly since it is just the amounts already saved.';
comment on column public.expenses.split_snapshot is
  'For split_method percent/shares only, else null: the percent or share number the person actually typed for each member, e.g. [{"member_id": "...", "value": 33.33}]. Needed because those numbers cannot always be recovered from the saved cents (rounding). Equally/exact need no extra memory: equally is just everyone in expense_shares, exact is just their cents. Checked by the expenses_check_split_snapshot trigger.';

create function private.check_expense_split_snapshot()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_seen uuid[] := '{}';
  v_member_id uuid;
  v_value numeric;
  v_percent_total numeric := 0;
  m jsonb;
begin
  if new.split_method in ('equally', 'exact') then
    if new.split_snapshot is not null then
      raise exception 'split_snapshot must be null when split_method is equally or exact' using errcode = '22023';
    end if;
    return new;
  end if;

  -- split_method is percent or shares
  if new.split_snapshot is null
     or jsonb_typeof(new.split_snapshot) <> 'array'
     or jsonb_array_length(new.split_snapshot) = 0
  then
    raise exception 'split_snapshot must be a non-empty array when split_method is percent or shares' using errcode = '22023';
  end if;

  for m in select * from jsonb_array_elements(new.split_snapshot) loop
    if jsonb_typeof(m) <> 'object'
       or not (m ?& array['member_id', 'value'])
       or (select count(*) from jsonb_object_keys(m)) <> 2
       or jsonb_typeof(m -> 'value') <> 'number'
    then
      raise exception 'each split_snapshot entry must have exactly "member_id" and a numeric "value"' using errcode = '22023';
    end if;

    begin
      v_member_id := (m ->> 'member_id')::uuid;
    exception when others then
      raise exception 'split_snapshot member_id must be a uuid' using errcode = '22023';
    end;

    if v_member_id = any(v_seen) then
      raise exception 'split_snapshot lists the same member twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_member_id;

    -- Checked against this expense's own group_id (not private.member_in_expense_group:
    -- on insert the expense row does not exist to join against yet). Runs with the
    -- caller's permissions: members of a group can see all of its member rows.
    if not exists (
      select 1 from public.group_members gm
      where gm.id = v_member_id and gm.group_id = new.group_id
    ) then
      raise exception 'split_snapshot member_id must belong to this expense''s group' using errcode = '22023';
    end if;

    v_value := (m ->> 'value')::numeric;
    if new.split_method = 'percent' then
      if v_value < 0 or v_value > 100 or v_value <> round(v_value, 2) then
        raise exception 'split_snapshot percent values must be between 0 and 100 with at most 2 decimals' using errcode = '22023';
      end if;
      v_percent_total := v_percent_total + v_value;
    else -- shares
      if v_value < 1 or v_value > 1000 or v_value <> floor(v_value) then
        raise exception 'split_snapshot share values must be whole numbers from 1 to 1000' using errcode = '22023';
      end if;
    end if;
  end loop;

  if new.split_method = 'percent' and round(v_percent_total, 2) <> 100 then
    raise exception 'split_snapshot percentages must add up to exactly 100' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke execute on function private.check_expense_split_snapshot() from public;

create trigger expenses_check_split_snapshot
  before insert or update of split_method, split_snapshot on public.expenses
  for each row execute function private.check_expense_split_snapshot();

grant insert (split_method, split_snapshot), update (split_method, split_snapshot)
  on table public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- 3. save_expense gains p_split (remembers the split method + typed values).
--    Same as the categories version (p_category stays 9th, same behaviour),
--    plus the new 10th parameter and passing it through to split_method /
--    split_snapshot. On an edit, a missing p_split resets to 'exact' (never
--    keeps stale percent/shares numbers), so the app sends p_split on every save.
-- ---------------------------------------------------------------------------
drop function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text);

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
  p_split jsonb default null
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

  if p_expense_id is null then
    insert into public.expenses (group_id, description, amount_cents, paid_by, spent_on, visibility,
                                 category, split_method, split_snapshot)
    values (p_group_id, btrim(p_description), p_amount_cents, p_paid_by,
            coalesce(p_spent_on, current_date), coalesce(p_visibility, 'group'),
            coalesce(p_category, 'other'), v_split_method, v_split_snapshot)
    returning id into v_id;
  else
    update public.expenses
       set description = btrim(p_description),
           amount_cents = p_amount_cents,
           paid_by = p_paid_by,
           spent_on = coalesce(p_spent_on, spent_on),
           visibility = coalesce(p_visibility, visibility),
           category = coalesce(p_category, category),
           split_method = v_split_method,
           split_snapshot = v_split_snapshot
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
comment on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb) is
  'Add (p_expense_id null) or edit an expense and its split together. Shares must add up to the amount. Only the person who added an expense can edit it. Visibility and category left out: group and other for a new expense, unchanged on an edit. p_split remembers which split screen was used, so Edit can reopen the same way: null or {"method":"exact"} or {"method":"equally"} need nothing else; {"method":"percent"|"shares","members":[{"member_id":...,"value":...}]} also remembers the typed percent/share numbers. Send p_split on every save.';

revoke execute on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb) from public, anon;
grant execute on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid, text, jsonb) to authenticated;

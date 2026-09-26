-- Baantwise, Phase 1 step 6: deleting expenses safely, and live updates for expenses.
--
-- 1. Deleting an expense now marks it deleted (deleted_at) instead of erasing it.
--    The app hides it for everyone. The row stays, so live updates never announce
--    a private expense to people who couldn't see it: Supabase Realtime applies the
--    privacy rules to inserts and updates, but not to real deletes. A deleted row
--    keeps the same privacy rules (only the same people can see it), and the app
--    always filters with "deleted_at is null".
-- 2. Live updates for expenses. expense_shares is deliberately NOT published:
--    editing an expense replaces its shares with real deletes, which would announce
--    member ids to everyone. save_expense always updates the expense row, so the
--    app reloads the shares whenever it gets an expense event.

alter table public.expenses add column deleted_at timestamptz;
comment on column public.expenses.deleted_at is
  'Set when the person who added the expense deletes it. The app hides these rows; they are never erased, so live updates stay private.';

-- No more real deletes by people: use delete_expense() instead.
drop policy "Only the person who added an expense can delete it" on public.expenses;
revoke delete on table public.expenses from authenticated;
grant update (deleted_at) on table public.expenses to authenticated;

-- Editing refuses deleted expenses (otherwise identical to step 4's version).
create or replace function public.save_expense(
  p_group_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_paid_by uuid,
  p_shares jsonb,
  p_visibility text default 'group',
  p_spent_on date default null,
  p_expense_id uuid default null
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
    insert into public.expenses (group_id, description, amount_cents, paid_by, spent_on, visibility)
    values (p_group_id, btrim(p_description), p_amount_cents, p_paid_by,
            coalesce(p_spent_on, current_date), coalesce(p_visibility, 'group'))
    returning id into v_id;
  else
    update public.expenses
       set description = btrim(p_description),
           amount_cents = p_amount_cents,
           paid_by = p_paid_by,
           spent_on = coalesce(p_spent_on, spent_on),
           visibility = coalesce(p_visibility, visibility)
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

-- Delete an expense (marks it deleted). Runs with the caller's own permissions,
-- so only the person who added it can do this.
create function public.delete_expense(p_expense_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  update public.expenses
     set deleted_at = now()
   where id = p_expense_id
     and deleted_at is null;
  if not found then
    raise exception 'Only the person who added this expense can delete it' using errcode = '42501';
  end if;
end;
$$;
comment on function public.delete_expense(uuid) is
  'Delete an expense you added. It is marked deleted (hidden by the app), never erased.';
revoke execute on function public.delete_expense(uuid) from public, anon;
grant execute on function public.delete_expense(uuid) to authenticated;

-- Live updates for expenses (the privacy rules decide who receives each event).
alter publication supabase_realtime add table public.expenses;
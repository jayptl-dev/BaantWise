-- Baantwise, Phase 1 step 7: balances and settling up.
--
-- 1. Optional payment details on profiles, so friends can pay you back: an Interac
--    e-Transfer email or phone, and a PayPal.Me username. Profiles are only visible
--    to yourself and to people you share a group with (step 4 rule), so these are too.
--    Baantwise never moves money.
-- 2. Payments (settlements) now work like expenses: undoing a payment marks it
--    deleted (deleted_at) instead of erasing it, only the person who recorded it can
--    undo it, and payments get live updates. The privacy rules stay the same.

alter table public.profiles
  add column interac_contact text
    check (interac_contact is null or char_length(btrim(interac_contact)) between 3 and 100),
  add column paypal_me text
    check (paypal_me is null or paypal_me ~ '^[A-Za-z0-9]{1,20}$');
comment on column public.profiles.interac_contact is
  'Optional Interac e-Transfer email or phone, shown to people in your groups so they can pay you back.';
comment on column public.profiles.paypal_me is
  'Optional PayPal.Me username (paypal.me/<name>), shown to people in your groups.';
grant update (interac_contact, paypal_me) on table public.profiles to authenticated;

alter table public.settlements add column deleted_at timestamptz;
comment on column public.settlements.deleted_at is
  'Set when the person who recorded the payment undoes it. The app hides these rows; they are never erased, so live updates stay private.';

-- No more real deletes by people: use delete_settlement() instead.
drop policy "Only the person who recorded a payment can delete it" on public.settlements;
revoke delete on table public.settlements from authenticated;
grant update (deleted_at) on table public.settlements to authenticated;

-- Undo a payment (marks it deleted). Runs with the caller's own permissions,
-- so only the person who recorded it can do this.
create function public.delete_settlement(p_settlement_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  update public.settlements
     set deleted_at = now()
   where id = p_settlement_id
     and deleted_at is null;
  if not found then
    raise exception 'Only the person who recorded this payment can undo it' using errcode = '42501';
  end if;
end;
$$;
comment on function public.delete_settlement(uuid) is
  'Undo a payment you recorded. It is marked deleted (hidden by the app), never erased.';
revoke execute on function public.delete_settlement(uuid) from public, anon;
grant execute on function public.delete_settlement(uuid) to authenticated;

-- Live updates for payments (the privacy rules decide who receives each event).
alter publication supabase_realtime add table public.settlements;
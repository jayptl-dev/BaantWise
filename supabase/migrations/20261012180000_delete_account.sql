-- Baantwise: "Delete my account" (Profile).
--
-- In plain words:
--   The delete-account Edge Function first calls prepare_account_deletion() as the
--   person, then deletes their sign-in with the admin key. Deleting the sign-in already
--   erases their profile (name, picture, payment details), forwarded bills, recurring
--   expenses they set up, and their small records (foreign keys "on delete cascade").
--   Their member rows stay with their name and no account, like a guest, so everyone
--   else's balances stay right ("on delete set null").
--   This function takes care of the groups first, so none is left without an admin:
--   - a group where nobody else has an account is deleted (nobody could open it again);
--   - a group where they're the only admin gets a new admin: the longest-standing
--     other member with an account;
--   - and their own member rows stop being admin.

create function public.prepare_account_deletion()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  for r in
    select m.id as member_id, m.group_id, m.is_admin
      from public.group_members m
     where m.user_id = v_uid and m.removed_at is null
       for update
  loop
    if not exists (
      select 1 from public.group_members o
       where o.group_id = r.group_id and o.removed_at is null
         and o.user_id is not null and o.user_id <> v_uid
    ) then
      delete from public.groups where id = r.group_id;
    elsif r.is_admin and not exists (
      select 1 from public.group_members o
       where o.group_id = r.group_id and o.removed_at is null and o.is_admin
         and o.user_id is not null and o.user_id <> v_uid
    ) then
      update public.group_members set is_admin = true
       where id = (select o.id from public.group_members o
                    where o.group_id = r.group_id and o.removed_at is null
                      and o.user_id is not null and o.user_id <> v_uid
                    order by o.created_at, o.id
                    limit 1);
    end if;
  end loop;
  update public.group_members set is_admin = false where user_id = v_uid and is_admin;
end;
$$;
comment on function public.prepare_account_deletion() is
  'delete-account Edge Function only, as the person: hands over admin and deletes groups nobody else could open, just before their sign-in is deleted.';
revoke execute on function public.prepare_account_deletion() from public, anon;
grant execute on function public.prepare_account_deletion() to authenticated;

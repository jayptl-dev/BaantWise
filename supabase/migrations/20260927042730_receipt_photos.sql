-- Baantwise, Phase 2 step 1: receipt photos.
--
-- One photo per expense, stored in a private bucket called 'receipts'.
-- The path is always '<expense id>/<random uuid>.jpg' (exactly one folder,
-- named after the expense it belongs to). A photo follows its expense's own
-- privacy rule (private.expense_visible) and can only be added, replaced or
-- removed by whoever added the expense (private.can_edit_expense) -- the
-- same two rules already used for the expense itself, not a new rule.
--
-- Other people only ever see the ONE photo the expense points to
-- (expenses.receipt_path), and only while the expense is not deleted. Files
-- that were replaced, never linked, or belong to a deleted expense are
-- visible only to the person who added the expense, so they can clean up.
--
-- A folder name is never cast to uuid directly inside a policy: Postgres does
-- not promise to check "bucket_id = 'receipts'" before the folder-name check,
-- so a bad cast could error out on some *other* bucket's object that happens
-- to have an odd name. private.try_uuid() below always returns null instead
-- of raising, so every check here is safe no matter what it is compared
-- against or which bucket the row is actually in.
--
-- One Postgres subtlety that shapes the policies below: an UPDATE or DELETE
-- also has to pass a SELECT policy on the row it is touching, not just its
-- own USING clause (this is why "replace" is select+insert+update and
-- "remove" is select+delete). So the person who added an expense keeps
-- SELECT on the files in its folder even after the expense is soft deleted --
-- otherwise they could never remove them. A file can only be removed through
-- the Storage API (deleting the table row alone would leave the file behind),
-- and the Storage API runs as the signed-in person, so this is the only way.
--
-- Safety net against a runaway upload loop or someone filling the free 1 GB
-- of storage: a person can upload at most 50 receipt photos in 24 hours.

-- ---------------------------------------------------------------------------
-- 1. The bucket. Private (not public); real photos end up well under 500 KB
--    (the app re-encodes and shrinks them before upload), so 1 MB is a
--    ceiling, not the target size. JPEG only, because the app always
--    re-encodes to JPEG (this also strips EXIF/location data).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg']);

-- ---------------------------------------------------------------------------
-- 2. The expense remembers its photo.
-- ---------------------------------------------------------------------------
alter table public.expenses add column receipt_path text;
comment on column public.expenses.receipt_path is
  'Path of the expense''s receipt photo in the ''receipts'' storage bucket (<expense id>/<uuid>.jpg). Null = no photo. Change only through set_expense_receipt.';

-- Defence in depth: users can update this column directly (see the grant
-- below), so even a direct update must stay inside the expense's own folder,
-- written exactly as '<expense id>/<lowercase uuid>.jpg'. A plain pattern (no
-- helper function) so that every role that writes expenses, including admin
-- tools, can always evaluate it.
alter table public.expenses add constraint expenses_receipt_path_own_folder
  check (receipt_path is null
         or receipt_path ~ ('^' || id::text
            || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'));

-- save_expense does not write this column (a photo is only ever added after
-- its expense already exists), but set_expense_receipt runs with the caller's
-- own permissions, so the usual column-level grant is still needed.
grant update (receipt_path) on table public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers.
-- ---------------------------------------------------------------------------

-- Parse text as a uuid, or return null for anything that isn't one. Never
-- raises, so it is always safe to use inside a policy, regardless of what row
-- or bucket it ends up being evaluated against.
create function private.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
comment on function private.try_uuid(text) is
  'text cast to uuid, or null if it is not one. Never raises.';

-- The expense id a receipt path belongs to, but only for a path shaped
-- exactly '<uuid>/<uuid>.jpg' (one folder, one file, both proper uuids).
-- Anything else -- two folders, no folder, a non-uuid folder or file name,
-- another bucket's unrelated file -- returns null, never an error.
create function private.receipt_path_expense_id(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select private.try_uuid(f[1])
  from (select storage.foldername(p_name) as f) s
  where array_length(f, 1) = 1
    and storage.filename(p_name) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jpg$';
$$;
comment on function private.receipt_path_expense_id(text) is
  'The expense id a receipt photo''s storage path belongs to, only when the path is shaped like <expense id>/<uuid>.jpg; null otherwise. Never raises.';

-- Whether the signed-in user may view this receipt file: it must be the photo
-- its expense currently points to (receipt_path), the expense must not be
-- deleted, and the user must be able to see the expense (the same rule as
-- private.can_see_expense). Replaced or never-linked files are not viewable.
create function private.can_view_receipt(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = private.receipt_path_expense_id(p_name)
      and e.receipt_path = p_name
      and e.deleted_at is null
      and private.expense_visible(e.group_id, e.visibility, e.created_by, e.paid_by, e.id)
  );
$$;
comment on function private.can_view_receipt(text) is
  'Whether the signed-in user can view this receipt file: it is the expense''s current photo, the expense is not deleted, and they can see the expense.';

-- Whether the signed-in user may upload a new photo into this expense's folder:
-- they added it, they are still in the group, it is not deleted, and they
-- uploaded fewer than 50 receipt photos in the last 24 hours. The count is only
-- a safety net: if the Storage table can't be read here for any reason, uploads
-- are not blocked.
create function private.can_add_receipt(p_expense_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_recent bigint;
begin
  if not exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and e.deleted_at is null
      and e.created_by = (select auth.uid())
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
comment on function private.can_add_receipt(uuid) is
  'Whether the signed-in user may upload a receipt photo for this expense: they added it, are still in the group, it is not deleted, and they uploaded fewer than 50 receipt photos in the last 24 hours.';

revoke execute on function
  private.try_uuid(text),
  private.receipt_path_expense_id(text),
  private.can_view_receipt(text),
  private.can_add_receipt(uuid)
from public;
grant execute on function
  private.try_uuid(text),
  private.receipt_path_expense_id(text),
  private.can_view_receipt(text),
  private.can_add_receipt(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Link the photo to its expense.
-- ---------------------------------------------------------------------------

-- The one function that sets or clears receipt_path. SECURITY INVOKER, so
-- the update below still goes through the expenses RLS policy ("only the
-- person who added an expense can change it") -- that is what actually
-- limits this to the adder; the check here is only about the *path*.
create function public.set_expense_receipt(p_expense_id uuid, p_path text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_path is not null and p_path !~ ('^' || p_expense_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'That photo is not in this expense''s own folder' using errcode = '22023';
  end if;

  update public.expenses
     set receipt_path = p_path
   where id = p_expense_id
     and deleted_at is null;

  if not found then
    raise exception 'Only the person who added this expense can change its receipt photo' using errcode = '42501';
  end if;
end;
$$;
comment on function public.set_expense_receipt(uuid, text) is
  'Set (or, with p_path null, remove) an expense''s receipt photo path. Only the person who added the expense can call this; the path must be <expense id>/<uuid>.jpg.';

revoke execute on function public.set_expense_receipt(uuid, text) from public, anon;
grant execute on function public.set_expense_receipt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Storage policies. Every one starts with bucket_id = 'receipts', but
--    that check is combined with the folder-parsing helper above (never a
--    raw ::uuid cast), so the order Postgres actually evaluates them in
--    cannot matter and cannot raise for some other bucket's object.
-- ---------------------------------------------------------------------------

-- Everyone who can see the expense: only its current photo. The adder: every
-- file in the folder (needed to replace, clean up and remove, also after the
-- expense is deleted).
create policy "See a receipt if you can see its expense"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      private.can_view_receipt(name)
      or private.can_edit_expense(private.receipt_path_expense_id(name))
    )
  );

create policy "Upload a receipt for an expense you can edit"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and private.can_add_receipt(private.receipt_path_expense_id(name))
  );

-- Covers both a same-path upsert and a rename: the WITH CHECK re-runs the
-- same test on the new row, so moving a photo into another expense's
-- folder this way is blocked too.
create policy "Replace a receipt for an expense you can edit"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'receipts'
    and private.can_edit_expense(private.receipt_path_expense_id(name))
  )
  with check (
    bucket_id = 'receipts'
    and private.can_edit_expense(private.receipt_path_expense_id(name))
  );

-- No deleted_at check here (can_edit_expense never has one): removing a
-- photo must still work after its expense is soft-deleted, so the app (or a
-- future cleanup job) can clear out the file.
create policy "Remove a receipt for an expense you can edit"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and private.can_edit_expense(private.receipt_path_expense_id(name))
  );

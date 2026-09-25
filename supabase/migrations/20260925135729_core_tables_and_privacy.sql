-- Baantwise, Phase 1 step 4: core tables and privacy rules.
--
-- In plain words:
--   profiles        one row per person who signs in (name + photo, never email)
--   groups          a group like "Cabin trip", with its currency and secret invite link
--   group_members   who is in each group: people with an account, or guests (just a name)
--   expenses        what, who paid, how much, when, and who can see it
--   expense_shares  each person's part of an expense, in cents (must add up to the total)
--   settlements     "Priya paid Jay $20" records. Baantwise never moves real money.
--
-- Row Level Security (RLS) checks the privacy rules on every request:
--   1. You only see groups you are a member of.
--   2. "group" expenses and payments are seen by every member.
--   3. "participants" expenses are seen only by the payer, the people splitting it,
--      and whoever added it (payments: payer, receiver, whoever recorded it).
--   4. Only the person who added an expense or payment can edit or delete it,
--      which includes changing who can see it.
--   5. Someone removed from a group (or who left) loses access straight away.
-- Admins manage a group (rename, remove members, reset the link, make admins,
-- delete it) but never see anyone else's private expenses.

-- ---------------------------------------------------------------------------
-- 1. Private schema for helper functions (not reachable through the website API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text check (char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now()
);
comment on table public.profiles is
  'One row per person who signs in: name and photo from Google. Email is deliberately not stored here, so group members never see each other''s email address.';

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  invite_token uuid not null unique default gen_random_uuid(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index groups_created_by_idx on public.groups (created_by);
comment on column public.groups.invite_token is
  'Secret part of the join link (baantwise.com/join/<token>). Admins can reset it; removing a member resets it automatically.';

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  is_admin boolean not null default false,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, user_id),
  unique (group_id, id),
  check (not (is_admin and removed_at is not null))
);
create index group_members_user_id_idx on public.group_members (user_id);
comment on table public.group_members is
  'Who is in each group. user_id is null for guests (a name only, no account). removed_at is set when someone leaves or is removed: they lose access, but their name stays on old expenses.';

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 100000000),
  paid_by uuid not null,
  spent_on date not null default current_date,
  visibility text not null default 'group' check (visibility in ('group', 'participants')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The payer must be a member of the same group. Checked when the change is
  -- saved (deferred), so deleting a whole group can remove everything in one go.
  foreign key (group_id, paid_by) references public.group_members (group_id, id)
    deferrable initially deferred
);
create index expenses_group_paid_by_idx on public.expenses (group_id, paid_by);
create index expenses_created_by_idx on public.expenses (created_by);
comment on column public.expenses.amount_cents is 'Total in cents: $12.34 is stored as 1234.';
comment on column public.expenses.visibility is
  '''group'' = everyone in the group can see it. ''participants'' = only the payer, the people splitting it, and whoever added it.';

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.group_members (id) deferrable initially deferred,
  share_cents bigint not null check (share_cents between 0 and 100000000),
  primary key (expense_id, member_id)
);
create index expense_shares_member_id_idx on public.expense_shares (member_id);
comment on table public.expense_shares is
  'Each person''s part of an expense, in cents. The shares of an expense must add up exactly to its amount; this is checked when the change is saved.';

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_member uuid not null,
  to_member uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000),
  visibility text not null default 'group' check (visibility in ('group', 'participants')),
  paid_on date not null default current_date,
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_member <> to_member),
  foreign key (group_id, from_member) references public.group_members (group_id, id)
    deferrable initially deferred,
  foreign key (group_id, to_member) references public.group_members (group_id, id)
    deferrable initially deferred
);
create index settlements_group_from_idx on public.settlements (group_id, from_member);
create index settlements_group_to_idx on public.settlements (group_id, to_member);
create index settlements_created_by_idx on public.settlements (created_by);
comment on table public.settlements is
  'Payments people mark as paid ("Priya paid Jay $20"). Only a record: Baantwise never moves money. ''participants'' visibility = only the payer, the receiver, and whoever recorded it.';

-- ---------------------------------------------------------------------------
-- 3. Helper functions used by the privacy rules.
--    SECURITY DEFINER lets them look up memberships without tripping over the
--    privacy rules themselves; the empty search_path stops name tricks.
-- ---------------------------------------------------------------------------
create function private.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  );
$$;

create function private.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.removed_at is null
      and m.is_admin
  );
$$;

create function private.my_member_id(p_group_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.id from public.group_members m
  where m.group_id = p_group_id
    and m.user_id = (select auth.uid())
    and m.removed_at is null;
$$;

create function private.is_expense_sharer(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.expense_shares s
    join public.group_members m on m.id = s.member_id
    where s.expense_id = p_expense_id
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  );
$$;

-- The core "who can see this expense?" rule. It takes the row's own values, so
-- it also works for a brand-new expense that is still being saved.
create function private.expense_visible(
  p_group_id uuid, p_visibility text, p_created_by uuid, p_paid_by uuid, p_expense_id uuid
) returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_group_member(p_group_id)
    and (
      p_visibility = 'group'
      or p_created_by = (select auth.uid())
      or p_paid_by = private.my_member_id(p_group_id)
      or private.is_expense_sharer(p_expense_id)
    );
$$;

create function private.can_see_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and private.expense_visible(e.group_id, e.visibility, e.created_by, e.paid_by, e.id)
  );
$$;

create function private.can_edit_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and e.created_by = (select auth.uid())
      and private.is_group_member(e.group_id)
  );
$$;

create function private.member_in_expense_group(p_member_id uuid, p_expense_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    join public.group_members m on m.group_id = e.group_id
    where e.id = p_expense_id
      and m.id = p_member_id
  );
$$;

create function private.settlement_visible(
  p_group_id uuid, p_visibility text, p_created_by uuid, p_from uuid, p_to uuid
) returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_group_member(p_group_id)
    and (
      p_visibility = 'group'
      or p_created_by = (select auth.uid())
      or private.my_member_id(p_group_id) in (p_from, p_to)
    );
$$;

create function private.shares_a_group_with(p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and mine.removed_at is null
      and theirs.user_id = p_user_id
      and theirs.removed_at is null
  );
$$;

create function private.my_display_name()
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.display_name from public.profiles p where p.id = (select auth.uid())),
    'Friend'
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Automatic actions (triggers)
-- ---------------------------------------------------------------------------

-- 4a. Create a profile the first time someone signs in with Google.
create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_avatar text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      'Friend'), 80),
    case when char_length(v_avatar) <= 2048 then v_avatar end
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never block a sign-in because of the profile; the app falls back to "Friend".
  raise warning 'Baantwise: could not create a profile for user %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Profiles for people who already signed in before this migration.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    'Friend'), 80),
  case
    when char_length(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')) <= 2048
    then coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  end
from auth.users u
on conflict (id) do nothing;

-- 4b. Keep expenses.updated_at current.
create function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function private.set_updated_at();

-- 4c. The split must add up to the total. Checked when the change is saved
--     (deferred), so an expense and its shares can be saved together.
create function private.check_expense_total()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_expense_id uuid;
  v_amount bigint;
  v_sum bigint;
  v_count integer;
begin
  if tg_table_name = 'expenses' then
    v_expense_id := new.id;
  elsif tg_op = 'DELETE' then
    v_expense_id := old.expense_id;
  else
    v_expense_id := new.expense_id;
  end if;

  select e.amount_cents into v_amount from public.expenses e where e.id = v_expense_id;
  if not found then
    return null; -- the expense itself was deleted, so there is nothing to check
  end if;

  select coalesce(sum(s.share_cents), 0), count(*) into v_sum, v_count
  from public.expense_shares s
  where s.expense_id = v_expense_id;

  if v_count = 0 or v_sum <> v_amount then
    raise exception 'The split must add up to the total (split: % cents, total: % cents)', v_sum, v_amount
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger expenses_check_total
  after insert or update of amount_cents on public.expenses
  deferrable initially deferred
  for each row execute function private.check_expense_total();

create constraint trigger expense_shares_check_total
  after insert or update or delete on public.expense_shares
  deferrable initially deferred
  for each row execute function private.check_expense_total();

-- ---------------------------------------------------------------------------
-- 5. Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;

-- profiles
create policy "See yourself and people you share a group with"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_a_group_with(id));
create policy "Change only your own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- groups (created only through create_group below)
create policy "See groups you are in"
  on public.groups for select to authenticated
  using (private.is_group_member(id));
create policy "Admins can rename a group"
  on public.groups for update to authenticated
  using (private.is_group_admin(id))
  with check (private.is_group_admin(id));
create policy "Admins can delete a group"
  on public.groups for delete to authenticated
  using (private.is_group_admin(id));

-- group_members (people join through join_group; members can add guests)
create policy "See the members of your groups"
  on public.group_members for select to authenticated
  using (private.is_group_member(group_id));
create policy "Members can add guests"
  on public.group_members for insert to authenticated
  with check (
    private.is_group_member(group_id)
    and user_id is null and not is_admin and removed_at is null
  );
create policy "Rename yourself or a guest; admins can rename anyone"
  on public.group_members for update to authenticated
  using (
    private.is_group_member(group_id)
    and (user_id is null or user_id = (select auth.uid()) or private.is_group_admin(group_id))
  )
  with check (
    private.is_group_member(group_id)
    and (user_id is null or user_id = (select auth.uid()) or private.is_group_admin(group_id))
  );

-- expenses
create policy "See group expenses, and private ones you are part of"
  on public.expenses for select to authenticated
  using (private.expense_visible(group_id, visibility, created_by, paid_by, id));
create policy "Members can add expenses as themselves"
  on public.expenses for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_group_member(group_id));
create policy "Only the person who added an expense can change it"
  on public.expenses for update to authenticated
  using (created_by = (select auth.uid()) and private.is_group_member(group_id))
  with check (created_by = (select auth.uid()) and private.is_group_member(group_id));
create policy "Only the person who added an expense can delete it"
  on public.expenses for delete to authenticated
  using (created_by = (select auth.uid()) and private.is_group_member(group_id));

-- expense_shares
create policy "See the split of expenses you can see"
  on public.expense_shares for select to authenticated
  using (private.can_see_expense(expense_id));
create policy "Only the person who added an expense can split it"
  on public.expense_shares for insert to authenticated
  with check (
    private.can_edit_expense(expense_id)
    and private.member_in_expense_group(member_id, expense_id)
  );
create policy "Only the person who added an expense can change the split"
  on public.expense_shares for update to authenticated
  using (private.can_edit_expense(expense_id))
  with check (private.can_edit_expense(expense_id));
create policy "Only the person who added an expense can remove a share"
  on public.expense_shares for delete to authenticated
  using (private.can_edit_expense(expense_id));

-- settlements
create policy "See group payments, and private ones you are part of"
  on public.settlements for select to authenticated
  using (private.settlement_visible(group_id, visibility, created_by, from_member, to_member));
create policy "Members can record payments"
  on public.settlements for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_group_member(group_id));
create policy "Only the person who recorded a payment can change it"
  on public.settlements for update to authenticated
  using (created_by = (select auth.uid()) and private.is_group_member(group_id))
  with check (created_by = (select auth.uid()) and private.is_group_member(group_id));
create policy "Only the person who recorded a payment can delete it"
  on public.settlements for delete to authenticated
  using (created_by = (select auth.uid()) and private.is_group_member(group_id));

-- ---------------------------------------------------------------------------
-- 6. Table permissions. Signed-out visitors get nothing. Signed-in people can
--    only write the columns listed, so nobody can make themselves an admin,
--    move an expense to another group, or pretend someone else added it.
-- ---------------------------------------------------------------------------
revoke all on table
  public.profiles, public.groups, public.group_members,
  public.expenses, public.expense_shares, public.settlements
from anon, authenticated;

grant select on table
  public.profiles, public.groups, public.group_members,
  public.expenses, public.expense_shares, public.settlements
to authenticated;

grant update (display_name) on table public.profiles to authenticated;
grant update (name), delete on table public.groups to authenticated;
grant insert (group_id, display_name), update (display_name) on table public.group_members to authenticated;
grant insert (group_id, description, amount_cents, paid_by, spent_on, visibility),
      update (description, amount_cents, paid_by, spent_on, visibility),
      delete
  on table public.expenses to authenticated;
grant insert (expense_id, member_id, share_cents), update (share_cents), delete
  on table public.expense_shares to authenticated;
grant insert (group_id, from_member, to_member, amount_cents, visibility, paid_on, note),
      update (from_member, to_member, amount_cents, visibility, paid_on, note),
      delete
  on table public.settlements to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Actions the app calls with supabase.rpc('name', {...})
-- ---------------------------------------------------------------------------

-- Create a group. The creator becomes its first admin.
create function public.create_group(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Give the group a name' using errcode = '22023';
  end if;
  insert into public.groups (name, created_by)
  values (btrim(p_name), v_uid)
  returning id into v_group_id;
  insert into public.group_members (group_id, user_id, display_name, is_admin)
  values (v_group_id, v_uid, private.my_display_name(), true);
  return v_group_id;
end;
$$;
comment on function public.create_group(text) is 'Create a group; the creator becomes its first admin. Returns the new group id.';

-- What an invite link points to, shown before joining. Needs sign-in.
-- Returns no rows if the link is not valid.
create function public.get_invite(p_token uuid)
returns table (group_id uuid, group_name text, member_count integer, already_member boolean)
language sql stable security definer set search_path = ''
as $$
  select
    g.id,
    g.name,
    (select count(*)::integer from public.group_members m
      where m.group_id = g.id and m.removed_at is null),
    private.is_group_member(g.id)
  from public.groups g
  where g.invite_token = p_token
    and (select auth.uid()) is not null;
$$;
comment on function public.get_invite(uuid) is 'Group name and member count for an invite link (no member names). No rows = link not valid.';

-- Join a group with its invite link. Safe to call twice.
create function public.join_group(p_token uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select g.id into v_group_id from public.groups g where g.invite_token = p_token;
  if v_group_id is null then
    raise exception 'This invite link doesn''t work any more. Ask someone in the group for a new one.'
      using errcode = 'P0002';
  end if;
  insert into public.group_members (group_id, user_id, display_name)
  values (v_group_id, v_uid, private.my_display_name())
  on conflict (group_id, user_id) do update set removed_at = null;
  return v_group_id;
end;
$$;
comment on function public.join_group(uuid) is 'Join the group behind an invite link (or come back after leaving). Returns the group id.';

-- Admins: make a new invite link. The old one stops working.
create function public.reset_invite_link(p_group_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
begin
  if not private.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can do this' using errcode = '42501';
  end if;
  update public.groups
     set invite_token = gen_random_uuid()
   where id = p_group_id
  returning invite_token into v_token;
  return v_token;
end;
$$;
comment on function public.reset_invite_link(uuid) is 'Admins only: replace the invite link. Returns the new token.';

-- Admins: make someone an admin, or take admin away. A group always keeps at least one admin.
create function public.set_member_admin(p_member_id uuid, p_make_admin boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_user_id uuid;
  v_removed_at timestamptz;
begin
  select m.group_id into v_group_id from public.group_members m where m.id = p_member_id;
  if v_group_id is null then
    raise exception 'Only a group admin can do this' using errcode = '42501';
  end if;
  -- Lock the group so two admins can't take admin away from each other at the same moment.
  perform 1 from public.groups g where g.id = v_group_id for update;
  if not private.is_group_admin(v_group_id) then
    raise exception 'Only a group admin can do this' using errcode = '42501';
  end if;
  select m.user_id, m.removed_at into v_user_id, v_removed_at
  from public.group_members m where m.id = p_member_id;

  if coalesce(p_make_admin, false) then
    if v_user_id is null or v_removed_at is not null then
      raise exception 'Only people who joined with their own account can be admins' using errcode = '22023';
    end if;
  elsif not exists (
    select 1 from public.group_members m
    where m.group_id = v_group_id and m.is_admin and m.removed_at is null and m.id <> p_member_id
  ) then
    raise exception 'A group needs at least one admin' using errcode = '22023';
  end if;

  update public.group_members set is_admin = coalesce(p_make_admin, false) where id = p_member_id;
end;
$$;
comment on function public.set_member_admin(uuid, boolean) is 'Admins only: give or take away admin. Guests cannot be admins; a group always keeps one admin.';

-- Admins: remove someone. They lose access straight away; their name stays on
-- old expenses. If they had an account, the invite link is reset so the old
-- link can't be used to come back.
create function public.remove_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_user_id uuid;
begin
  select m.group_id, m.user_id into v_group_id, v_user_id
  from public.group_members m
  where m.id = p_member_id and m.removed_at is null;
  if v_group_id is null then
    raise exception 'Only a group admin can do this' using errcode = '42501';
  end if;
  perform 1 from public.groups g where g.id = v_group_id for update;
  if not private.is_group_admin(v_group_id) then
    raise exception 'Only a group admin can do this' using errcode = '42501';
  end if;
  if v_user_id = (select auth.uid()) then
    raise exception 'To remove yourself, use Leave group' using errcode = '22023';
  end if;
  update public.group_members set removed_at = now(), is_admin = false where id = p_member_id;
  if v_user_id is not null then
    update public.groups set invite_token = gen_random_uuid() where id = v_group_id;
  end if;
end;
$$;
comment on function public.remove_member(uuid) is 'Admins only: remove a member or guest. Resets the invite link if they had an account.';

-- Leave a group. The last admin has to make someone else an admin (or delete the group) first.
create function public.leave_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  if private.my_member_id(p_group_id) is null then
    raise exception 'You''re not in this group' using errcode = 'P0002';
  end if;
  perform 1 from public.groups g where g.id = p_group_id for update;
  v_member_id := private.my_member_id(p_group_id);
  if v_member_id is null then
    raise exception 'You''re not in this group' using errcode = 'P0002';
  end if;
  if private.is_group_admin(p_group_id) and not exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.is_admin and m.removed_at is null and m.id <> v_member_id
  ) then
    raise exception 'You''re the only admin. Make someone else an admin first, or delete the group.'
      using errcode = '22023';
  end if;
  update public.group_members set removed_at = now(), is_admin = false where id = v_member_id;
end;
$$;
comment on function public.leave_group(uuid) is 'Leave a group yourself. The last admin must hand over admin or delete the group first.';

-- Add or edit an expense and its split in one go (all or nothing).
-- p_shares looks like: [{"member_id": "<uuid>", "share_cents": 334}, ...]
-- Runs with the caller's own permissions, so every privacy rule above applies.
create function public.save_expense(
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
       and group_id = p_group_id;
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
comment on function public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid) is
  'Add (p_expense_id null) or edit an expense and its split together. Shares must add up to the amount. Only the person who added an expense can edit it.';

-- ---------------------------------------------------------------------------
-- 8. Who may run which function
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public;
grant execute on function
  private.is_group_member(uuid),
  private.is_group_admin(uuid),
  private.my_member_id(uuid),
  private.is_expense_sharer(uuid),
  private.expense_visible(uuid, text, uuid, uuid, uuid),
  private.can_see_expense(uuid),
  private.can_edit_expense(uuid),
  private.member_in_expense_group(uuid, uuid),
  private.settlement_visible(uuid, text, uuid, uuid, uuid),
  private.shares_a_group_with(uuid)
to authenticated;

revoke execute on function
  public.create_group(text),
  public.get_invite(uuid),
  public.join_group(uuid),
  public.reset_invite_link(uuid),
  public.set_member_admin(uuid, boolean),
  public.remove_member(uuid),
  public.leave_group(uuid),
  public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid)
from public, anon;
grant execute on function
  public.create_group(text),
  public.get_invite(uuid),
  public.join_group(uuid),
  public.reset_invite_link(uuid),
  public.set_member_admin(uuid, boolean),
  public.remove_member(uuid),
  public.leave_group(uuid),
  public.save_expense(uuid, text, bigint, uuid, jsonb, text, date, uuid)
to authenticated;

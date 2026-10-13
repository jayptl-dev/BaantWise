-- Friends: split expenses with one person, outside any group.
--
-- A friendship is a private two-person group (groups.is_direct), so expenses,
-- payments, balances, settle up, reminders and recurring all work exactly as in
-- groups. Both people are admins. Someone becomes a friend in one of three ways:
--   - add_friend_from_member: someone you already share a group with
--   - add_friend_by_username: an optional username they chose (profiles.username)
--   - my_friend_link: your personal friend link (/join/<token>); whoever opens it
--     becomes your friend. One link at a time; once used, a new one is made.
-- Friend lists never show up as groups. Removing a friend is leaving that space;
-- when nobody with an account is left, it is deleted.

-- 1. Optional usernames: lowercase letters, numbers, dots and underscores, 3 to 20.
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_check
  check (username is null or username ~ '^[a-z0-9][a-z0-9_.]{2,19}$');
create unique index profiles_username_key on public.profiles (username);
comment on column public.profiles.username is
  'Optional. Lets people add you as a friend by typing it. Lowercase; unique.';
grant update (username) on table public.profiles to authenticated;

-- 2. Friendships are two-person groups.
alter table public.groups add column is_direct boolean not null default false;
comment on column public.groups.is_direct is
  'A friendship: a private space for two people (see 20261013010000_friends.sql).';

-- The friendship between me and p_other: made, or found and reopened for me.
create or replace function private.start_friendship(p_other uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  if p_other is null or not exists (select 1 from auth.users u where u.id = p_other) then
    raise exception 'We couldn''t find that person' using errcode = 'P0002';
  end if;
  if p_other = v_uid then
    raise exception 'That''s you!' using errcode = '22023';
  end if;

  select g.id into v_group
    from public.groups g
    join public.group_members a on a.group_id = g.id and a.user_id = v_uid
    join public.group_members b on b.group_id = g.id and b.user_id = p_other
   where g.is_direct
   limit 1;
  if v_group is not null then
    -- Friends already: reopen it for me if I'd removed it.
    update public.group_members set removed_at = null, is_admin = true
     where group_id = v_group and user_id = v_uid and removed_at is not null;
    return v_group;
  end if;

  -- Keep spam out: at most 30 new friends a day.
  if (select count(*) from public.groups g
       where g.is_direct and g.created_by = v_uid and g.created_at > now() - interval '1 day') >= 30 then
    raise exception 'That''s a lot of new friends for one day. Try again tomorrow.' using errcode = '54000';
  end if;

  insert into public.groups (name, created_by, is_direct)
  values ('Friends', v_uid, true)
  returning id into v_group;
  insert into public.group_members (group_id, user_id, display_name, is_admin)
  values (v_group, v_uid, private.my_display_name(), true),
         (v_group, p_other,
          coalesce((select p.display_name from public.profiles p where p.id = p_other), 'Friend'),
          true);
  return v_group;
end;
$$;

-- Someone from one of my groups.
create or replace function public.add_friend_from_member(p_member_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_other uuid;
begin
  select m.user_id into v_other
    from public.group_members m
   where m.id = p_member_id and private.is_group_member(m.group_id);
  if v_other is null then
    raise exception 'That person doesn''t have an account yet. Send them your friend link instead.'
      using errcode = 'P0002';
  end if;
  return private.start_friendship(v_other);
end;
$$;

-- Someone's username (with or without the @).
create or replace function public.add_friend_by_username(p_username text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_other uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select p.id into v_other from public.profiles p
   where p.username = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if v_other is null then
    raise exception 'Nobody has that username. Check the spelling, or send your friend link.'
      using errcode = 'P0002';
  end if;
  return private.start_friendship(v_other);
end;
$$;

-- My friend link's token: the unused one, or a new one.
create or replace function public.my_friend_link()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token uuid;
  v_group uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select g.invite_token into v_token
    from public.groups g
   where g.is_direct and g.created_by = v_uid
     and (select count(*) from public.group_members m where m.group_id = g.id) = 1
     and exists (select 1 from public.group_members m
                  where m.group_id = g.id and m.user_id = v_uid and m.removed_at is null)
   order by g.created_at desc
   limit 1;
  if v_token is not null then
    return v_token;
  end if;
  insert into public.groups (name, created_by, is_direct)
  values ('Friends', v_uid, true)
  returning id, invite_token into v_group, v_token;
  insert into public.group_members (group_id, user_id, display_name, is_admin)
  values (v_group, v_uid, private.my_display_name(), true);
  return v_token;
end;
$$;

-- Invites: a friend link shows whose it is; samples and used friend links show nothing.
drop function public.get_invite(uuid);
create function public.get_invite(p_token uuid)
returns table (group_id uuid, group_name text, member_count integer, already_member boolean, is_direct boolean)
language sql stable security definer set search_path = ''
as $$
  select
    g.id,
    case when g.is_direct
         then coalesce((select m.display_name from public.group_members m
                         where m.group_id = g.id and m.user_id = g.created_by), 'Someone')
         else g.name end,
    (select count(*)::integer from public.group_members m
      where m.group_id = g.id and m.removed_at is null),
    private.is_group_member(g.id),
    g.is_direct
  from public.groups g
  where g.invite_token = p_token
    and not g.is_sample
    and (not g.is_direct
         or private.is_group_member(g.id)
         or (select count(*) from public.group_members m where m.group_id = g.id) = 1)
    and (select auth.uid()) is not null;
$$;
revoke all on function public.get_invite(uuid) from public, anon;
grant execute on function public.get_invite(uuid) to authenticated;

create or replace function public.join_group(p_token uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group record;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;
  select g.id, g.is_direct, g.created_by into v_group
    from public.groups g
   where g.invite_token = p_token and not g.is_sample;
  if v_group.id is null then
    raise exception 'This invite link doesn''t work any more. Ask someone in the group for a new one.'
      using errcode = 'P0002';
  end if;

  if v_group.is_direct then
    if v_group.created_by = v_uid then
      raise exception 'That''s your own friend link. Send it to a friend!' using errcode = '22023';
    end if;
    if (select count(*) from public.group_members m where m.group_id = v_group.id) <> 1 then
      raise exception 'This friend link was already used. Ask your friend for a new one.' using errcode = 'P0002';
    end if;
    -- Already friends: open that instead; the unused link stays for someone else.
    if exists (select 1 from public.groups g
                 join public.group_members a on a.group_id = g.id and a.user_id = v_uid
                 join public.group_members b on b.group_id = g.id and b.user_id = v_group.created_by
                where g.is_direct) then
      return (select g.id from public.groups g
                join public.group_members a on a.group_id = g.id and a.user_id = v_uid
                join public.group_members b on b.group_id = g.id and b.user_id = v_group.created_by
               where g.is_direct limit 1);
    end if;
    insert into public.group_members (group_id, user_id, display_name, is_admin)
    values (v_group.id, v_uid, private.my_display_name(), true);
    return v_group.id;
  end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (v_group.id, v_uid, private.my_display_name())
  on conflict (group_id, user_id) do update set removed_at = null;
  return v_group.id;
end;
$$;

-- Removing a friend = leaving the friendship. Nobody with an account left → delete it.
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id uuid;
  v_direct boolean;
begin
  if private.my_member_id(p_group_id) is null then
    raise exception 'You''re not in this group' using errcode = 'P0002';
  end if;
  select g.is_direct into v_direct from public.groups g where g.id = p_group_id for update;
  v_member_id := private.my_member_id(p_group_id);
  if v_member_id is null then
    raise exception 'You''re not in this group' using errcode = 'P0002';
  end if;
  if not v_direct and private.is_group_admin(p_group_id) and not exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.is_admin and m.removed_at is null and m.id <> v_member_id
  ) then
    raise exception 'You''re the only admin. Make someone else an admin first, or delete the group.'
      using errcode = '22023';
  end if;
  update public.group_members set removed_at = now(), is_admin = false where id = v_member_id;
  if v_direct and not exists (
    select 1 from public.group_members m
     where m.group_id = p_group_id and m.removed_at is null and m.user_id is not null
  ) then
    delete from public.groups where id = p_group_id;
  end if;
end;
$$;

-- Friendships don't take guests or other people.
create or replace function private.check_direct_members()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.groups g where g.id = new.group_id and g.is_direct)
     and (new.user_id is null
          or (select count(*) from public.group_members m
               where m.group_id = new.group_id and m.id <> new.id) >= 2) then
    raise exception 'A friendship is just the two of you. Make a group to add more people.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger group_members_direct_limit
  before insert on public.group_members
  for each row execute function private.check_direct_members();

revoke all on function public.add_friend_from_member(uuid) from public, anon;
revoke all on function public.add_friend_by_username(text) from public, anon;
revoke all on function public.my_friend_link() from public, anon;
grant execute on function public.add_friend_from_member(uuid) to authenticated;
grant execute on function public.add_friend_by_username(text) to authenticated;
grant execute on function public.my_friend_link() to authenticated;
revoke all on function private.start_friendship(uuid) from public, anon, authenticated;

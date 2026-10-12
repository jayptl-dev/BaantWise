-- Baantwise, Phase 2: receipt scanning (a monthly scan counter per person).
--
-- In plain words:
--   Scanning a receipt sends the photo to Google Gemini, which costs a little money per
--   scan. To keep that cost small and predictable, each person gets 100 scans per calendar
--   month (months follow Toronto time). The scan-receipt Edge Function claims one scan by
--   calling claim_receipt_scan() with the person's own sign-in, before it calls Gemini.
--   The counter keeps only three things: who, which month, and how many scans. Never the
--   photo, the receipt text or any amounts. It lives in the private schema, so the website
--   API can't read or change it; claim_receipt_scan() is the only way to add to it, and it
--   only ever touches the caller's own count. Earlier months are forgotten automatically.
--   The counter is not part of live updates (Realtime).

create table private.receipt_scan_counts (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  scans integer not null default 0 check (scans between 0 and 1000),
  primary key (user_id, month)
);
comment on table private.receipt_scan_counts is
  'How many receipts each person scanned this month (limit: 100). Only user id, month and count: never the photo, receipt text or amounts. Changed only by public.claim_receipt_scan().';
comment on column private.receipt_scan_counts.user_id is 'The person who scanned (auth user id). Deleted with their account.';
comment on column private.receipt_scan_counts.month is 'First day of the month the scans belong to (Toronto time).';
comment on column private.receipt_scan_counts.scans is 'Scans claimed this month, including ones where the photo could not be read.';

-- Nobody reaches the table directly. RLS with no policies is a second lock in case a
-- grant is ever added by mistake; claim_receipt_scan() runs as the owner and skips it.
alter table private.receipt_scan_counts enable row level security;
revoke all on table private.receipt_scan_counts from public, anon, authenticated;

-- The scan month for a moment in time: the first day of that month in Toronto time.
create function private.scan_month(p_at timestamptz)
returns date language sql stable set search_path = ''
as $$
  select date_trunc('month', p_at at time zone 'America/Toronto')::date;
$$;
comment on function private.scan_month(timestamptz) is
  'First day of the scan month (Toronto time) for a moment in time. Used by claim_receipt_scan.';
revoke execute on function private.scan_month(timestamptz) from public, anon, authenticated;

-- Claim one scan for the signed-in person. Called only by the scan-receipt Edge Function,
-- with the person's own sign-in (never an admin key). One statement adds to the count and
-- checks the limit, so two scans at the same moment can't both slip past it.
-- Returns one row: allowed = false means this month's limit is reached (nothing is added).
create function public.claim_receipt_scan()
returns table (allowed boolean, scans_used integer, scans_limit integer, resets_on date)
language plpgsql security definer set search_path = ''
as $$
declare
  c_limit constant integer := 100;
  v_uid uuid := (select auth.uid());
  v_month date := private.scan_month(now());
  v_used integer;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;

  -- Only this month matters: forget this person's earlier months.
  delete from private.receipt_scan_counts c
   where c.user_id = v_uid and c.month < v_month;

  insert into private.receipt_scan_counts as c (user_id, month, scans)
  values (v_uid, v_month, 1)
  on conflict (user_id, month) do update
    set scans = c.scans + 1
    where c.scans < c_limit
  returning c.scans into v_used;

  if v_used is null then
    -- The limit is reached: the row was left unchanged.
    select c.scans into v_used
      from private.receipt_scan_counts c
     where c.user_id = v_uid and c.month = v_month;
    return query select false, v_used, c_limit, (v_month + interval '1 month')::date;
    return;
  end if;

  return query select true, v_used, c_limit, (v_month + interval '1 month')::date;
end;
$$;
comment on function public.claim_receipt_scan() is
  'Scan-receipt Edge Function only: use one of the caller''s 100 receipt scans for this month (Toronto time). Returns allowed = false (and adds nothing) when the limit is reached.';
revoke execute on function public.claim_receipt_scan() from public, anon;
grant execute on function public.claim_receipt_scan() to authenticated;

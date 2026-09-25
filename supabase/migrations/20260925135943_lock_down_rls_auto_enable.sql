-- Supabase created public.rls_auto_enable() when the project was made. It runs
-- automatically (as an event trigger) to switch on Row Level Security for every
-- new table in the public schema. That's a good safety net, and it keeps working
-- after this change. Nobody needs to call it through the website API, so signed-out
-- and signed-in visitors lose permission to call it directly
-- (Supabase security advisor lints 0028/0029).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
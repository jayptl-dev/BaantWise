-- Live updates (Supabase Realtime, postgres_changes) for the Groups screens.
-- Open screens are told when a group is renamed or its members change
-- (someone joins, leaves, is removed, becomes or stops being an admin).
-- The privacy rules (Row Level Security) decide who receives inserts and updates.
-- Deletes are NOT filtered by the privacy rules: every subscriber receives the
-- deleted row's primary key. Groups and members only disappear when a whole group
-- is deleted, so that's acceptable here. Never hard-delete private data (such as
-- private expenses) from a table in this publication; mark it deleted instead.
alter publication supabase_realtime add table public.groups, public.group_members;
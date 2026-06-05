-- SuaraUsaha Supabase RLS hardening
--
-- Current auth model:
-- - The frontend talks to the Express backend.
-- - The backend uses Better Auth sessions and direct Postgres access.
-- - The frontend should not read or write app tables through Supabase Data API.
--
-- This script enables RLS on every table in the public schema and removes
-- Data API table privileges from Supabase's public API roles. Do not add
-- generic auth.uid() policies unless the app later adopts Supabase Auth for
-- direct frontend database access.

do $$
declare
  table_record record;
begin
  for table_record in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'alter table %I.%I enable row level security',
      table_record.schemaname,
      table_record.tablename
    );

    execute format(
      'revoke all on table %I.%I from anon, authenticated',
      table_record.schemaname,
      table_record.tablename
    );
  end loop;
end $$;

-- Keep future tables locked down by default for Supabase Data API roles.
alter default privileges in schema public
revoke all on tables from anon, authenticated;

-- Verification: every public table should have rowsecurity = true.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Verification: anon/authenticated should have no direct table privileges.
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- The site's own database role (2026-11-02, rewritten for Postgres in DB-1), so it doesn't connect as the admin.
-- It owns schema "onlycars" and nothing else: it creates and updates its own tables at startup (Database:MigrateOnStartup),
-- and has no grants on Supabase's other schemas (auth, storage, ...), nor can it create objects in public (Postgres 15 and later).
--
-- Run once, signed in as the admin, on the target database. All or nothing: a failure leaves no role and no schema behind.
-- The role can't sign in until step 2. No password belongs in this file, so a forgotten step fails instead of leaving a known password.

-- Step 1: this script.
BEGIN;
CREATE ROLE onlycars_app LOGIN;
-- A non-superuser admin, such as Supabase's postgres, must be able to SET ROLE to the owner it names in CREATE SCHEMA.
GRANT onlycars_app TO CURRENT_USER;
CREATE SCHEMA onlycars AUTHORIZATION onlycars_app;
REVOKE ALL ON SCHEMA onlycars FROM PUBLIC;
COMMIT;

-- Step 2: run by hand with a new long random password, which is never committed:
--   ALTER ROLE onlycars_app PASSWORD '<the password>';
-- Then set ConnectionStrings__Default to a string with this username and password, and SSL Mode=Require.

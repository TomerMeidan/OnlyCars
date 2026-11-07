-- The site's own database role (2026-11-02, rewritten for Postgres in DB-1), so it doesn't connect as the admin.
-- It owns schema "onlycars" and nothing else: it creates and updates its own tables at startup (Database:MigrateOnStartup),
-- and has no grants on Supabase's other schemas (auth, storage, ...), nor can it create objects in public (Postgres 15 and later).
--
-- Run once, signed in as the admin, on the target database. Replace the password first with a new long random one, and never commit it.
-- Then set ConnectionStrings__Default to a string with this username and password.

CREATE ROLE onlycars_app LOGIN PASSWORD 'REPLACE-WITH-A-LONG-RANDOM-PASSWORD';
CREATE SCHEMA onlycars AUTHORIZATION onlycars_app;
REVOKE ALL ON SCHEMA onlycars FROM PUBLIC;

-- The nightly backup's own database role (2026-11-08): it can read schema "onlycars" and nothing else,
-- so a leaked backup secret can't change data. Used by .github/workflows/backup.yml.
--
-- Run once, signed in as the admin, after app-db-user.sql. All or nothing.
-- No password belongs in this file: set it in a separate step, as with app-db-user.sql.

BEGIN;
CREATE ROLE onlycars_backup LOGIN;
GRANT USAGE ON SCHEMA onlycars TO onlycars_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA onlycars TO onlycars_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA onlycars TO onlycars_backup;
-- Tables and sequences the app creates later (its migrations run as onlycars_app) are readable too.
ALTER DEFAULT PRIVILEGES FOR ROLE onlycars_app IN SCHEMA onlycars GRANT SELECT ON TABLES TO onlycars_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE onlycars_app IN SCHEMA onlycars GRANT SELECT ON SEQUENCES TO onlycars_backup;
COMMIT;

-- Then, by hand, with a new long random alphanumeric password that is never committed:
--   ALTER ROLE onlycars_backup PASSWORD '<the password>';

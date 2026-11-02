-- The site's own database login (2026-11-02), so it no longer connects as the server admin.
-- The admin can change the firewall, logins and every database on the server; this user can only work inside "onlycars".
-- It keeps db_ddladmin because the app creates and updates its own tables at startup (Database:MigrateOnStartup).
--
-- Run once, signed in as the admin, ON THE "onlycars" DATABASE (not master): Azure Portal > SQL database "onlycars" >
-- Query editor. Replace the password first with a new long random one, and never commit it.
-- Then in Render set ConnectionStrings__Default to the same string with User ID=onlycars_app and that password.

CREATE USER onlycars_app WITH PASSWORD = 'REPLACE-WITH-A-LONG-RANDOM-PASSWORD';
ALTER ROLE db_datareader ADD MEMBER onlycars_app;
ALTER ROLE db_datawriter ADD MEMBER onlycars_app;
ALTER ROLE db_ddladmin ADD MEMBER onlycars_app;

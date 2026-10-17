-- L72 (LOW-4): one-off cleanup of the test users that browser tests, scripts and agents created on the LOCAL dev database.
-- Not part of the app and not a migration. Deleting a user cascades to all of their data in the database.
-- Stored files are NOT deleted: R2 keeps each deleted user's objects under users/{id}/ (car photo, receipts) until an orphan
-- sweep exists. The dry run lists the target user ids; keep that list if those prefixes should be removed from the bucket by hand.
--
-- Only machine-generated emails match: one tight LIKE per prefix and domain (the rules below), and the local part may hold
-- only a-z, 0-9, '+' and '-'. The self-check refuses to run if any rule matches the owner's accounts or a near miss.
--
-- Dry run (lists the users it would delete, with a count per rule; changes nothing):
--   sqlcmd -S "(localdb)\mssqllocaldb" -d OnlyCars -E -b -i scripts/cleanup-test-users.sql -v DryRun=1
-- Delete for real (the owner decides):
--   sqlcmd -S "(localdb)\mssqllocaldb" -d OnlyCars -E -b -i scripts/cleanup-test-users.sql -v DryRun=0
-- Without -v DryRun=... sqlcmd stops with "'DryRun' scripting variable not defined".

:on error exit
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF CONVERT(nvarchar(128), SERVERPROPERTY('InstanceName')) NOT LIKE 'LOCALDB#%' OR SERVERPROPERTY('InstanceName') IS NULL
    THROW 50000, 'Refusing to run: this script is for the local LocalDB dev database only.', 1;

-- rules:start (read-only from here to rules:end)
DECLARE @D13 varchar(65) = REPLICATE('[0-9]', 13); -- a Date.now() in ms
DECLARE @D10 varchar(50) = REPLICATE('[0-9]', 10); -- a Unix time in seconds
DECLARE @D9 varchar(45) = REPLICATE('[0-9]', 9);
DECLARE @D5 varchar(25) = REPLICATE('[0-9]', 5);
DECLARE @Hex8 varchar(64) = REPLICATE('[0-9a-f]', 8);
DECLARE @Rules TABLE (Name varchar(40) PRIMARY KEY, Pattern varchar(200) NOT NULL);
INSERT INTO @Rules VALUES
    -- Also matches the RPT smoke users ui-rpt-<setup>-<ms> and ui-rptdbg-<ms> (L97).
    ('smoke ui-<setup>-<ms>',        'ui-[a-z]%-' + @D13 + '@onlycars.test'),
    ('smoke other-<setup>-<ms>',     'other-[a-z]%-' + @D13 + '@onlycars.test'),
    ('smoke short-<setup>-<ms>',     'short-[a-z]%-' + @D13 + '@onlycars.test'),
    ('register.mjs reg-<ms>',        'reg-' + @D13 + '@onlycars.test'),
    ('register.mjs short-<ms>',      'short-' + @D13 + '@onlycars.test'),
    ('agent low3-<5 digits>',        'low3-' + @D5 + '@example.test'),
    ('agent lowcheck-<5 digits>',    'lowcheck-' + @D5 + '@example.test'),
    ('agent sec-<8 hex>',            'sec-' + @Hex8 + '@example.test'),
    ('agent low4-<ms>',              'low4-' + @D13 + '@onlycars.test'),
    ('agent low4b-<ms>',             'low4b-' + @D13 + '@onlycars.test'),
    ('agent rpt1-a-<9 digits>',      'rpt1-a-' + @D9 + '@example.com'),
    ('agent rpt1-b-<9 digits>',      'rpt1-b-' + @D9 + '@example.com'),
    ('agent probe-rpt-<ms>',         'probe-rpt-' + @D13 + '@onlycars.test'),
    ('agent file1-<word>-<s>',       'file1-[a-z]%-' + @D10 + '@example.test'),
    ('agent be-file1-fix<n>-<s>',    'be-file1-fix%-' + @D10 + '@onlycars.test'),
    ('agent file2-<ms>',             'file2-' + @D13 + '@example.test'),
    ('old qa+<run>-<ms>',            'qa+[a-z0-9]%-' + @D13 + '@example.com'),
    ('old dbg-<ms> onlycars.test',   'dbg-' + @D13 + '@onlycars.test'),
    ('old dbg<ms> x.com',            'dbg' + @D13 + '@x.com'),
    ('old dbg<ms> x.io',             'dbg' + @D13 + '@x.io');

-- Self-check: none of these may ever match (the owner's accounts and near misses of each rule).
DECLARE @MustNotMatch TABLE (Email nvarchar(256));
INSERT INTO @MustNotMatch VALUES ('tommymeidan@gmail.com'), ('tomboi@gmail.com'), ('ui-tommy@gmail.com'), ('ui-x-1792098626274@gmail.com'),
    ('ui-1792098626274@onlycars.test'), ('ui+8755@onlycars.test'), ('qa+me@example.com'), ('qa+tommy-1234@example.com'),
    ('reg-123@onlycars.test'), ('low3-1@example.test'), ('sec-mvp5c-1792133549926-gnb8@test.local'), ('dbg1792199810023@gmail.com'),
    ('ui-a@b-1792098626274@onlycars.test'), ('ui-tom my-1792098626274@onlycars.test'),
    ('rpt1-a-1234@example.com'), ('rpt1-c-132112091@example.com'), ('rpt1-a-132112091@gmail.com'), ('rpt1-a-1321120912@example.com'),
    ('probe-rpt-123@onlycars.test'), ('probe-rpt-1792226542697@gmail.com'), ('probe-1792226542697@onlycars.test'),
    ('file1-1792257093@example.test'), ('file1-check-1792257093@gmail.com'), ('file1-check-179225709@example.test'),
    ('be-file1-fix-1792261851@example.test'), ('file2-1792271596454@onlycars.test'), ('file2-179227159645@example.test');
IF EXISTS (SELECT 1 FROM @MustNotMatch m JOIN @Rules r ON m.Email LIKE r.Pattern
           WHERE m.Email NOT LIKE '%[^a-z0-9+-]%@%' AND m.Email NOT LIKE '%@%@%')
    THROW 50001, 'Self-check failed: a rule matches an address it must never match.', 1;

DECLARE @Targets TABLE (Id uniqueidentifier PRIMARY KEY, Email nvarchar(256), RuleName varchar(40));
INSERT INTO @Targets (Id, Email, RuleName)
SELECT u.Id, u.Email, MIN(r.Name) FROM Users u JOIN @Rules r ON u.Email LIKE r.Pattern
WHERE u.Email NOT LIKE '%[^a-z0-9+-]%@%' AND u.Email NOT LIKE '%@%@%'
GROUP BY u.Id, u.Email;

IF EXISTS (SELECT 1 FROM @Targets WHERE Email IN ('tommymeidan@gmail.com', 'tomboi@gmail.com'))
    THROW 50002, 'Self-check failed: an owner account matched.', 1;

SELECT r.Name AS RuleName, COUNT(t.Id) AS UsersMatched FROM @Rules r LEFT JOIN @Targets t ON t.RuleName = r.Name GROUP BY r.Name ORDER BY r.Name;
SELECT COUNT(*) AS UsersMatched, (SELECT COUNT(*) FROM Users) AS UsersInDatabase FROM @Targets;
SELECT Email FROM @Targets ORDER BY Email;
-- rules:end

DECLARE @DryRun bit = $(DryRun);
IF @DryRun = 1
BEGIN
    SELECT Id AS UserId, Email FROM @Targets ORDER BY Email; -- their R2 prefixes are users/<UserId>/
    PRINT 'Dry run: nothing deleted.';
END
ELSE
BEGIN
    BEGIN TRANSACTION;
    DELETE FROM Users WHERE Id IN (SELECT Id FROM @Targets);
    PRINT CONCAT('Deleted ', @@ROWCOUNT, ' users.');
    COMMIT;
END

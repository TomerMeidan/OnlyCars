-- L72 (LOW-4): one-off cleanup of the test users that browser tests, scripts and agents created on the LOCAL dev database.
-- Not part of the app and not a migration. Deleting a user cascades to all of their data in the database.
-- Stored files are NOT deleted: R2 keeps each deleted user's objects under users/{id}/ (car photo, receipts, run photos) until an orphan
-- sweep exists. The dry run lists the target user ids; keep that list if those prefixes should be removed from the bucket by hand.
--
-- Only machine-generated emails match: one tight LIKE per prefix and domain (the rules below), and the local part may hold
-- only a-z, 0-9, '+' and '-'. The self-check refuses to run if any rule matches the owner's accounts or a near miss,
-- or if any target is not on one of the test domains the rules use (so no gmail.com account can ever be deleted).
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
DECLARE @D6 varchar(30) = REPLICATE('[0-9]', 6);
DECLARE @D5 varchar(25) = REPLICATE('[0-9]', 5);
DECLARE @D4 varchar(20) = REPLICATE('[0-9]', 4);
DECLARE @A4 varchar(40) = REPLICATE('[a-z0-9]', 4);
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
    ('agent file3-<ms>',             'file3-' + @D13 + '@example.test'),
    ('old qa+<run>-<ms>',            'qa+[a-z0-9]%-' + @D13 + '@example.com'),
    ('old dbg-<ms> onlycars.test',   'dbg-' + @D13 + '@onlycars.test'),
    ('old dbg<ms> x.com',            'dbg' + @D13 + '@x.com'),
    ('old dbg<ms> x.io',             'dbg' + @D13 + '@x.io'),
    -- L139 (LOW-6): the browser-QA and agent prefixes no rule above matched in the dev DB on 2026-10-18.
    ('qa qa3-<setup>-<ms>',          'qa3-[a-z]%-' + @D13 + '@onlycars.test'), -- also qa3-<setup>-other-<ms>
    ('qa qa-<tag>-<ms>',             'qa-[a-z0-9]%-' + @D13 + '@onlycars.test'), -- qa-f1-<setup>, qa-4b, qa-car, qa-tap, ...
    ('qa qa-x-<5 digits>',           'qa-x-' + @D5 + '@onlycars.test'),
    ('qa qa-status-<4 digits>',      'qa-status-' + @D4 + '@example.com'),
    ('qa shot-<tag>-<ms>',           'shot-%' + @D13 + '@onlycars.test'),
    ('qa shot<5 digits>',            'shot' + @D5 + '@onlycars.test'),
    ('qa extra-<lang>-<ms>',         'extra-[a-z][a-z]-' + @D13 + '@onlycars.test'),
    ('qa look-<lang>-<ms>',          'look-[a-z][a-z]-' + @D13 + '@onlycars.test'),
    ('qa d-/m-<ms>',                 '[dm]-' + @D13 + '@onlycars.test'),
    ('agent mvp<n><x>- example.com', 'mvp[0-9][a-z]-%' + @D4 + '@example.com'), -- mvp<n><x>-[<tag>-]<4+ digits>
    ('agent mvp<n><x>- example.test','mvp[0-9][a-z]-%' + @D4 + '@example.test'),
    ('agent mvp<n><x>- x.test',      'mvp[0-9][a-z]-%' + @D4 + '@x.test'),
    ('agent mvp3a-<4> test.dev',     'mvp3a-' + @D4 + '@test.dev'), -- test.dev is registrable: the exact shape only
    ('agent mvp<n><x>-<5> test.local','mvp[0-9][a-z]-' + @D5 + '@test.local'),
    ('agent omvp<n><x>-<5>',         'omvp[0-9][a-z]-' + @D5 + '@x.test'),
    ('agent sec-mvp5c-<ms>-<4>',     'sec-mvp5c-' + @D13 + '-' + @A4 + '@test.local'),
    ('agent sec-mvp5c-enum-<ms>',    'sec-mvp5c-enum-' + @D13 + '@test.local'),
    ('agent <letter><9 digits>',     '[a-z]' + @D9 + '@sec.test'),
    ('agent sec<n>-<4 digits>',      'sec[0-9]-' + @D4 + '@example.com'),
    ('agent sec<n>-<5 digits>',      'sec[0-9]-' + @D5 + '@example.com'),
    ('agent sec<n>dev-<5 digits>',   'sec[0-9]dev-' + @D5 + '@example.com'),
    ('agent sec<n>rev<s>',           'sec[0-9]rev' + @D10 + '@example.com'),
    ('agent secrev<s>',              'secrev' + @D10 + '@example.com'),
    ('agent bsec<n>-<5 digits>',     'bsec[0-9]-' + @D5 + '@example.com'),
    ('agent sec<a|b><s>',            'sec[ab]' + @D10 + '@example.test'),
    ('agent be<5 digits>',           'be' + @D5 + '@x.test'),
    ('agent be<6 digits>',           'be' + @D6 + '@x.test'),
    ('agent abc<s>',                 'abc' + @D10 + '@example.com'),
    ('agent pm<s> t.dev',            'pm' + @D10 + '@t.dev'),
    ('agent pm<s> t.io',             'pm' + @D10 + '@t.io'),
    ('agent pmcheck<5 digits>',      'pmcheck' + @D5 + '@x.com'),
    ('agent probe<5 digits>',        'probe' + @D5 + '@example.com'),
    ('agent set<n>-<5 digits>',      'set[0-9]-' + @D5 + '@example.com'),
    ('agent tires-<5 digits>',       'tires-' + @D5 + '@x.test'),
    ('agent tires-o-<4 digits>',     'tires-o-' + @D4 + '@x.test'),
    ('agent tok<5 digits>',          'tok' + @D5 + '@x.test'),
    ('agent split<4 digits>',        'split' + @D4 + '@test.com'),
    ('agent split<5 digits>',        'split' + @D5 + '@test.com');

-- Self-check: none of these may ever match (the owner's accounts and near misses of each rule).
DECLARE @MustNotMatch TABLE (Email nvarchar(256));
INSERT INTO @MustNotMatch VALUES ('tommymeidan@gmail.com'), ('tomboi@gmail.com'), ('ui-tommy@gmail.com'), ('ui-x-1792098626274@gmail.com'),
    ('ui-1792098626274@onlycars.test'), ('ui+8755@onlycars.test'), ('qa+me@example.com'), ('qa+tommy-1234@example.com'),
    ('reg-123@onlycars.test'), ('low3-1@example.test'), ('dbg1792199810023@gmail.com'),
    ('ui-a@b-1792098626274@onlycars.test'), ('ui-tom my-1792098626274@onlycars.test'),
    ('rpt1-a-1234@example.com'), ('rpt1-c-132112091@example.com'), ('rpt1-a-132112091@gmail.com'), ('rpt1-a-1321120912@example.com'),
    ('probe-rpt-123@onlycars.test'), ('probe-rpt-1792226542697@gmail.com'), ('probe-1792226542697@onlycars.test'),
    ('file1-1792257093@example.test'), ('file1-check-1792257093@gmail.com'), ('file1-check-179225709@example.test'),
    ('be-file1-fix-1792261851@example.test'), ('file2-1792271596454@onlycars.test'), ('file2-179227159645@example.test'),
    ('file3-1792271596454@onlycars.test'), ('file3-179227159645@example.test'),
    -- L139 near misses (and the two short onlycars.test accounts left alone on purpose: demo+ and ui+ are not clearly generated).
    ('demo+12345@onlycars.test'), ('qa3-1792098626274@onlycars.test'), ('qa3-desktop-1792098626274@gmail.com'),
    ('qa-1792098626274@onlycars.test'), ('qa-car-179209862627@onlycars.test'), ('qa-x-1234@onlycars.test'), ('qa-status-12345@example.com'),
    ('shot-1792098626274@gmail.com'), ('shot1234@onlycars.test'), ('extra-eng-1792098626274@onlycars.test'), ('look-en-1792098626274@example.com'),
    ('dm-1792098626274@onlycars.test'), ('x-1792098626274@onlycars.test'), ('mvp-a-12345@example.com'), ('mvp5c-abc@example.com'),
    ('mvp5c-12345@gmail.com'), ('mvp5c-123@example.com'), ('sec-mvp5c-1792133549926@test.local'), ('sec-mvp5c-1792133549926-gnb@test.local'),
    ('sec-mvp5c-enum-1792133549926@example.com'), ('a12345678@sec.test'), ('ab123456789@sec.test'), ('sec-12345@example.com'),
    ('sec5-123@example.com'), ('secrev123456789@example.com'), ('seca1792133549@gmail.com'), ('bsec1-1234@example.com'),
    ('be1234@x.test'), ('be1234567@x.test'), ('abc123456789@example.com'), ('pm1792133549@gmail.com'), ('pmcheck1234@x.com'),
    ('probe1234@example.com'), ('set-12345@example.com'), ('tires-1234@x.test'), ('tires-o-12345@x.test'), ('tok1234@x.test'),
    ('split123@test.com'),
    -- L139 fix round: near misses of the newer rules, and human-looking local parts on their domains.
    ('omvp1a-1234@x.test'), ('omvp1a-12345@example.com'), ('mvp1c-1234@test.local'), ('mvp1c-a-12345@test.local'),
    ('mvp2c-123@x.test'), ('mvp2-12345@x.test'), ('mvp3a-51634@test.dev'), ('mvp3a-x-5163@test.dev'), ('mvp3b-5163@test.dev'),
    ('mvp3a-tommy-2024@test.dev'), ('pm123456789@t.io'), ('pm1792133549@t.com'), ('d-179209862627@onlycars.test'),
    ('m-1792098626274@example.com'), ('sec1-tommy-2024@example.com'), ('sec1-123456@example.com'), ('sec1dev-1547@example.com'),
    ('sec1rev179200672@example.com'), ('sec12-12345@example.com');
IF EXISTS (SELECT 1 FROM @MustNotMatch m JOIN @Rules r ON m.Email LIKE r.Pattern
           WHERE m.Email NOT LIKE '%[^a-z0-9+-]%@%' AND m.Email NOT LIKE '%@%@%')
    THROW 50001, 'Self-check failed: a rule matches an address it must never match.', 1;

DECLARE @Targets TABLE (Id uniqueidentifier PRIMARY KEY, Email nvarchar(256), RuleName varchar(40));
INSERT INTO @Targets (Id, Email, RuleName)
SELECT u.Id, u.Email, MIN(r.Name) FROM Users u JOIN @Rules r ON u.Email LIKE r.Pattern
WHERE u.Email NOT LIKE '%[^a-z0-9+-]%@%' AND u.Email NOT LIKE '%@%@%'
GROUP BY u.Id, u.Email;

-- Structural owner guard: every target must be on a domain the rules use, so a gmail.com (or any real) account can never be deleted.
IF EXISTS (SELECT 1 FROM @Targets WHERE SUBSTRING(Email, CHARINDEX('@', Email) + 1, 256) NOT IN
           ('onlycars.test', 'example.test', 'example.com', 'sec.test', 'test.local', 'x.test', 'test.dev', 't.dev', 't.io',
            'x.com', 'x.io', 'test.com'))
    THROW 50003, 'Self-check failed: a target is not on one of the test domains the rules use (e.g. gmail.com).', 1;

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
    -- Run photos don't cascade (SQL Server allows one cascade path to Attachments, taken by service records): delete them first.
    DELETE a FROM Attachments a JOIN ChecklistRuns r ON r.Id = a.ChecklistRunId JOIN VehicleChecklists c ON c.Id = r.VehicleChecklistId
        JOIN Vehicles v ON v.Id = c.VehicleId WHERE v.UserId IN (SELECT Id FROM @Targets);
    DELETE FROM Users WHERE Id IN (SELECT Id FROM @Targets);
    PRINT CONCAT('Deleted ', @@ROWCOUNT, ' users.');
    COMMIT;
END

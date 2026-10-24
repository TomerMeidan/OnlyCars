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
SET QUOTED_IDENTIFIER ON; -- sqlcmd defaults it OFF, and deletes on tables with filtered indexes then fail (Msg 1934)

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
DECLARE @Rules TABLE (Name varchar(40) NOT NULL, Pattern varchar(200) NOT NULL, PRIMARY KEY (Name, Pattern)); -- a rule may have several exact shapes
INSERT INTO @Rules VALUES
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
    ('agent file1-<word>-<s>',       'file1-check-' + @D10 + '@example.test'), -- the words the FILE-1 agent used
    ('agent file1-<word>-<s>',       'file1-other-' + @D10 + '@example.test'),
    ('agent file1-<word>-<s>',       'file1-probe-' + @D10 + '@example.test'),
    ('agent file2-<ms>',             'file2-' + @D13 + '@example.test'),
    ('agent file3-<ms>',             'file3-' + @D13 + '@example.test'),
    ('old dbg-<ms> onlycars.test',   'dbg-' + @D13 + '@onlycars.test'),
    -- L139 (LOW-6): the browser-QA and agent prefixes no rule above matched in the dev DB on 2026-10-18.
    ('qa qa-x-<5 digits>',           'qa-x-' + @D5 + '@onlycars.test'),
    ('qa qa-status-<4 digits>',      'qa-status-' + @D4 + '@example.com'),
    ('qa shot<5 digits>',            'shot' + @D5 + '@onlycars.test'),
    ('qa extra-<lang>-<ms>',         'extra-[a-z][a-z]-' + @D13 + '@onlycars.test'),
    ('qa look-<lang>-<ms>',          'look-[a-z][a-z]-' + @D13 + '@onlycars.test'),
    ('qa d-/m-<ms>',                 '[dm]-' + @D13 + '@onlycars.test'),
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
    ('agent probe<5 digits>',        'probe' + @D5 + '@example.com'),
    ('agent set<n>-<5 digits>',      'set[0-9]-' + @D5 + '@example.com'),
    ('agent tires-<5 digits>',       'tires-' + @D5 + '@x.test'),
    ('agent tires-o-<4 digits>',     'tires-o-' + @D4 + '@x.test'),
    ('agent tok<5 digits>',          'tok' + @D5 + '@x.test'),
    -- L170 (LOW-8): the ACC-1 agent users.
    ('agent acc1-<ms>',              'acc1-' + @D13 + '@onlycars.test');

-- L143 (LOW-8): the loose rules on reserved domains, as exact shapes taken from the QA scripts in the git history and the dev DB.
-- The smoke setups (desktop|mobile)-(light|dark)-(en|he), with the -km/-mi unit tails browser QA added.
DECLARE @Setups TABLE (S varchar(30) PRIMARY KEY);
INSERT INTO @Setups SELECT d + '-' + c + '-' + l + u FROM (VALUES ('desktop'), ('mobile')) a(d) CROSS JOIN (VALUES ('light'), ('dark')) b(c)
    CROSS JOIN (VALUES ('en'), ('he')) e(l) CROSS JOIN (VALUES (''), ('-km'), ('-mi')) f(u);
-- qa+<tag>-<setup>-<ms>, or qa+<tag>-[<word>-]<ms> for the one-off runs.
INSERT INTO @Rules SELECT 'old qa+<tag>-[<what>-]<ms>', 'qa+' + m + '-' + @D13 + '@example.com' FROM (
    SELECT t + '-' + S FROM @Setups CROSS JOIN (VALUES ('low[0-9]'), ('mvp[0-9][a-z]'), ('sec[0-9]'), ('set[0-9]')) x(t)
    UNION SELECT t + '-' + l FROM (VALUES ('low[0-9]off'), ('mvp[0-9][a-z]x'), ('mvp[0-9][a-z]-lo')) x(t) CROSS JOIN (VALUES ('en'), ('he')) y(l)
    UNION SELECT m FROM (VALUES ('mvp[0-9][a-z]'), ('mvp[0-9][a-z]zoom'), ('mvp[0-9][a-z]-api'), ('mvp[0-9][a-z]-more'), ('mvp[0-9][a-z]-zoom'),
        ('mvp[0-9][a-z]-logout'), ('mvp[0-9][a-z]-probe'), ('set[0-9]-flash-light'), ('set[0-9]-flash-dark'), ('dbg'), ('void'), ('void[0-9]'),
        ('never'), ('nobody')) x(m)
) shapes(m);
INSERT INTO @Rules VALUES ('qa qa+low7-<5 digits>', 'qa+low7-' + @D5 + '@example.com'); -- L148
-- mvp<n><x>-[<tag>-]<4, 5, 9 or 10 digits>, and mvp3d-o<s>; a free-text tag (like tommy-2024) never matches.
INSERT INTO @Rules SELECT 'agent mvp<n><x>-[<tag>-]<digits>', 'mvp[0-9][a-z]-' + t + n + '@' + d
    FROM (VALUES (''), ('[a-z]-'), ('be-'), ('big-'), ('other-')) x(t) CROSS JOIN (VALUES (@D4), (@D5), (@D9), (@D10)) y(n)
    CROSS JOIN (VALUES ('example.com'), ('example.test'), ('x.test')) z(d)
    UNION SELECT 'agent mvp<n><x>-[<tag>-]<digits>', 'mvp[0-9][a-z]-o' + @D10 + '@example.com';

-- L184 (LOW-9): the onlycars.test rules as exact shapes, from the smoke and QA scripts and the dev DB (2026-10-24); no '%' is left.
-- <prefix>-<setup>[-<tail>]-<ms>: the smoke users (ui-rpt is RPT's, L97; ui-off1-u/v is OFF-1's) and the browser-QA runs.
INSERT INTO @Rules SELECT p + '-<setup>' + t + '-<ms>', p + '-' + S + t + '-' + @D13 + '@onlycars.test'
    FROM @Setups CROSS JOIN (VALUES ('ui', ''), ('ui-rpt', ''), ('ui-off1-[uv]', ''), ('other', ''), ('other-cap', ''), ('short', ''),
        ('not1', ''), ('ui-qa', ''), ('ui-qa-low5', ''), ('ui-qa-other', ''), ('ui-qa-rpt', ''), ('qa3', ''), ('qa3', '-other'),
        ('qa-f1', ''), ('qa-f1b', ''), ('qa-low6', ''), ('qa-low7', ''), ('qa-acc1', ''), ('qa-not1', ''), ('qa-not1', '-[eo]'),
        ('qa-not1', '-other')) x(p, t);
-- qa-<tag>-<ms>, ui-qa-print-<lang>[-<width>]-<ms>, shot-[d-]<lang>-<width>-<ms>, shot-<ms>, ui-rptdbg-<ms> and be-file1-fix[<n>]-<s>.
INSERT INTO @Rules SELECT 'qa qa-<tag>-<ms>', 'qa-' + t + '-' + @D13 + '@onlycars.test' FROM (VALUES ('[0-9][a-z]'), ('[0-9][a-z]-cap'),
    ('car'), ('tap'), ('f1big'), ('acc1-other'), ('acc1-x-light-en'), ('acc1-x-dark-he'), ('low6-empty-en'), ('low6-empty-he'), ('low6-race'),
    ('not1-api')) x(t)
    UNION SELECT 'qa ui-qa-print-<lang>[-<width>]-<ms>', 'ui-qa-print-' + l + w + '-' + @D13 + '@onlycars.test'
        FROM (VALUES ('en'), ('he')) a(l) CROSS JOIN (VALUES (''), ('-390'), ('-800')) b(w)
    UNION SELECT 'qa shot-[d-]<lang>-<width>-<ms>', 'shot-' + d + l + '-' + w + '-' + @D13 + '@onlycars.test'
        FROM (VALUES (''), ('d-')) a(d) CROSS JOIN (VALUES ('en'), ('he')) b(l) CROSS JOIN (VALUES ('390'), ('1280')) c(w)
    UNION SELECT 'qa shot-<ms>', 'shot-' + @D13 + '@onlycars.test'
    UNION SELECT 'smoke ui-rptdbg-<ms>', 'ui-rptdbg-' + @D13 + '@onlycars.test'
    UNION SELECT 'agent be-file1-fix[<n>]-<s>', 'be-file1-fix' + n + '-' + @D10 + '@onlycars.test' FROM (VALUES (''), ('[0-9]')) x(n)
    -- L195: the OFF-1 agent user.
    UNION SELECT 'agent off1-<s>', 'off1-' + @D10 + '@example.com';

-- L182 (LOW-9): only reserved test domains; real registrable ones (x.com, test.dev, ...) can belong to someone, so they have no rule.
DECLARE @TestDomains TABLE (Domain varchar(30) PRIMARY KEY);
INSERT INTO @TestDomains VALUES ('onlycars.test'), ('example.test'), ('example.com'), ('sec.test'), ('test.local'), ('x.test');
IF EXISTS (SELECT 1 FROM @Rules WHERE SUBSTRING(Pattern, CHARINDEX('@', Pattern) + 1, 200) NOT IN (SELECT Domain FROM @TestDomains))
    THROW 50004, 'Self-check failed: a rule is on a domain that is not a test domain.', 1;

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
    ('sec1rev179200672@example.com'), ('sec12-12345@example.com'),
    -- LOW-8 near misses: the tightened mvp rules and the new not1/acc1 rules.
    ('mvp1a-tommy-2024@example.com'), ('mvp1a-tommy-2024@example.test'), ('mvp1a-tommy-2024@x.test'), ('mvp1a-123@example.com'),
    ('not1-179209862627@onlycars.test'), ('not1-desktop-light-en-179209862627@onlycars.test'),
    ('not1-desktop-light-en-1792098626274@gmail.com'), ('not1-desktop-1792098626274@example.com'),
    ('acc1-179232710335@onlycars.test'), ('acc1-1792327103357@gmail.com'), ('acc1-tommy-1792327103357@onlycars.test'),
    ('acc1-1792327103357@example.com'),
    -- L143 near misses: the exact qa+, file1 and mvp shapes.
    ('qa+tommy-1792098626274@example.com'), ('qa+low1-tommy-1792098626274@example.com'), ('qa+low1-desktop-light-fr-1792098626274@example.com'),
    ('qa+mvp3a-desktop-light-en-179209862627@example.com'), ('qa+mvp3a-desktop-light-en-1792098626274@gmail.com'),
    ('qa+mvp3a-tablet-light-en-1792098626274@example.com'), ('qa+mvp5b-tommy-1792098626274@example.com'), ('qa+dbg-179209862627@example.com'),
    ('qa+set1-flash-blue-1792098626274@example.com'), ('qa+low7-1234@example.com'), ('qa+low7-12345@gmail.com'),
    ('file1-tommy-1792257093@example.test'), ('file1-check-1792257093@example.com'), ('mvp1a-tommy-12345@example.com'),
    ('mvp1a-ab-12345@example.com'), ('mvp1a-123456@example.com'), ('mvp1a-12345678@example.test'), ('mvp3d-x1792257093@example.com'),
    ('mvp1a-other-123@example.test'), ('mvp1a-12345@gmail.com'),
    -- L182 (LOW-9): the users on the six dropped real domains (in the dev DB on 2026-10-24) now stay.
    ('dbg1792199810023@x.com'), ('dbg1792199810023@x.io'), ('mvp3a-5163@test.dev'), ('pm1792045087@t.dev'), ('pm2660420476@t.io'),
    ('pmcheck17460@x.com'), ('split8765@test.com'), ('split16373@test.com'),
    -- L184, L195 (LOW-9) near misses: free text where the old '%' rules allowed it, other setups, tags and widths, and off1.
    ('ui-tommy-1792098626274@onlycars.test'), ('ui-desktop-1792098626274@onlycars.test'), ('ui-tablet-light-en-1792098626274@onlycars.test'),
    ('ui-desktop-light-fr-1792098626274@onlycars.test'), ('ui-qa-tommy-1792098626274@onlycars.test'), ('ui-off1-x-desktop-light-en-1792098626274@onlycars.test'),
    ('other-tommy-1792098626274@onlycars.test'), ('short-tommy-1792098626274@onlycars.test'), ('not1-tommy-1792098626274@onlycars.test'),
    ('qa3-desktop-light-en-tommy-1792098626274@onlycars.test'), ('qa3-tommy-1792098626274@onlycars.test'),
    ('qa-tommy-1792098626274@onlycars.test'), ('qa-f1-tommy-1792098626274@onlycars.test'), ('qa-not1-desktop-light-en-x-1792098626274@onlycars.test'),
    ('qa-12-1792098626274@onlycars.test'), ('qa-low6-empty-fr-1792098626274@onlycars.test'),
    ('ui-qa-print-fr-1792098626274@onlycars.test'), ('ui-qa-print-en-1024-1792098626274@onlycars.test'),
    ('shot-tommy-1792098626274@onlycars.test'), ('shot-en-800-1792098626274@onlycars.test'), ('shot-x-en-390-1792098626274@onlycars.test'),
    ('be-file1-fixme-1792261851@onlycars.test'), ('be-file1-fix12-1792261851@onlycars.test'),
    ('off1-166072577@example.com'), ('off1-16607257731@example.com'), ('off1-1660725773@gmail.com'), ('off1-1660725773@onlycars.test'),
    ('off1-x-1660725773@example.com');
IF EXISTS (SELECT 1 FROM @MustNotMatch m JOIN @Rules r ON m.Email LIKE r.Pattern
           WHERE m.Email NOT LIKE '%[^a-z0-9+-]%@%' AND m.Email NOT LIKE '%@%@%')
    THROW 50001, 'Self-check failed: a rule matches an address it must never match.', 1;

-- Self-check: each exact shape still matches what the old loose rules cleaned (addresses from the dev DB on 2026-10-24), and off1 (L195).
DECLARE @MustMatch TABLE (Email nvarchar(256));
INSERT INTO @MustMatch VALUES ('off1-1660725773@example.com'),
    ('ui-desktop-light-en-1792098626274@onlycars.test'), ('ui-mobile-dark-he-1792098626274@onlycars.test'),
    ('ui-rpt-desktop-dark-he-1792098626274@onlycars.test'), ('ui-rptdbg-1792098626274@onlycars.test'),
    ('ui-off1-u-mobile-light-en-1792098626274@onlycars.test'), ('ui-qa-desktop-light-en-1792098626274@onlycars.test'),
    ('ui-qa-low5-mobile-dark-he-1792098626274@onlycars.test'), ('ui-qa-other-desktop-dark-he-1792098626274@onlycars.test'),
    ('ui-qa-rpt-mobile-light-en-1792098626274@onlycars.test'), ('ui-qa-print-he-390-1792098626274@onlycars.test'),
    ('ui-qa-print-en-1792098626274@onlycars.test'), ('other-desktop-light-en-1792098626274@onlycars.test'),
    ('other-cap-mobile-dark-he-1792098626274@onlycars.test'), ('short-desktop-light-en-1792098626274@onlycars.test'),
    ('not1-mobile-dark-he-1792098626274@onlycars.test'), ('qa3-desktop-dark-he-1792098626274@onlycars.test'),
    ('qa3-mobile-light-en-other-1792098626274@onlycars.test'), ('qa-1b-1792098626274@onlycars.test'), ('qa-1c-cap-1792098626274@onlycars.test'),
    ('qa-car-1792098626274@onlycars.test'), ('qa-tap-1792098626274@onlycars.test'), ('qa-f1big-1792098626274@onlycars.test'),
    ('qa-f1-desktop-light-en-1792098626274@onlycars.test'), ('qa-f1b-mobile-dark-he-1792098626274@onlycars.test'),
    ('qa-low6-desktop-dark-he-1792098626274@onlycars.test'), ('qa-low6-empty-he-1792098626274@onlycars.test'),
    ('qa-low6-race-1792098626274@onlycars.test'), ('qa-low7-mobile-light-en-1792098626274@onlycars.test'),
    ('qa-acc1-desktop-light-en-1792098626274@onlycars.test'), ('qa-acc1-other-1792098626274@onlycars.test'),
    ('qa-acc1-x-dark-he-1792098626274@onlycars.test'), ('qa-not1-api-1792098626274@onlycars.test'),
    ('qa-not1-desktop-dark-he-1792098626274@onlycars.test'), ('qa-not1-mobile-light-en-e-1792098626274@onlycars.test'),
    ('qa-not1-desktop-light-en-o-1792098626274@onlycars.test'), ('qa-not1-mobile-dark-he-other-1792098626274@onlycars.test'),
    ('shot-1792098626274@onlycars.test'), ('shot-d-en-1280-1792098626274@onlycars.test'), ('shot-he-390-1792098626274@onlycars.test'),
    ('be-file1-fix-1792261851@onlycars.test'), ('be-file1-fix6-1792291707@onlycars.test');
IF EXISTS (SELECT 1 FROM @MustMatch m WHERE NOT EXISTS (SELECT 1 FROM @Rules r WHERE m.Email LIKE r.Pattern))
    THROW 50005, 'Self-check failed: a rule no longer matches a test address it must match.', 1;

DECLARE @Targets TABLE (Id uniqueidentifier PRIMARY KEY, Email nvarchar(256), RuleName varchar(40));
INSERT INTO @Targets (Id, Email, RuleName)
SELECT u.Id, u.Email, MIN(r.Name) FROM Users u JOIN @Rules r ON u.Email LIKE r.Pattern
WHERE u.Email NOT LIKE '%[^a-z0-9+-]%@%' AND u.Email NOT LIKE '%@%@%'
GROUP BY u.Id, u.Email;

-- Structural owner guard: every target must be on a domain the rules use, so a gmail.com (or any real) account can never be deleted.
IF EXISTS (SELECT 1 FROM @Targets WHERE SUBSTRING(Email, CHARINDEX('@', Email) + 1, 256) NOT IN (SELECT Domain FROM @TestDomains))
    THROW 50003, 'Self-check failed: a target is not on one of the test domains the rules use (e.g. gmail.com).', 1;

IF EXISTS (SELECT 1 FROM @Targets WHERE Email IN ('tommymeidan@gmail.com', 'tomboi@gmail.com'))
    THROW 50002, 'Self-check failed: an owner account matched.', 1;

SELECT r.Name AS RuleName, COUNT(t.Id) AS UsersMatched FROM (SELECT DISTINCT Name FROM @Rules) r LEFT JOIN @Targets t ON t.RuleName = r.Name GROUP BY r.Name ORDER BY r.Name;
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

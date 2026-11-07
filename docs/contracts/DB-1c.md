# Contract: DB-1c, the copy tool, rehearsed locally

Published by backend-engineer on branch `db-1`. No endpoint, request, response or error code changes, and no migration, so there is nothing new for the frontend. The tool is `tools/OnlyCars.DbCopy`, in `OnlyCars.slnx`, outside `src/`: the Dockerfile copies only `src/`, so SQL Server stays out of the image.

## Commands

From the repository root, once built with `dotnet build tools/OnlyCars.DbCopy -c Release`:

```
dotnet tools/OnlyCars.DbCopy/bin/Release/net10.0/OnlyCars.DbCopy.dll                     # dry run: reads, writes nothing
dotnet tools/OnlyCars.DbCopy/bin/Release/net10.0/OnlyCars.DbCopy.dll --apply-baseline    # target only: applies the Postgres baseline
dotnet tools/OnlyCars.DbCopy/bin/Release/net10.0/OnlyCars.DbCopy.dll --write             # copies, verifies inside the transaction, commits
dotnet tools/OnlyCars.DbCopy/bin/Release/net10.0/OnlyCars.DbCopy.dll --verify            # compares again, writes nothing
```

Exit code 0: it did its job and found nothing that stops a `--write`. Exit code 1: it stopped, and printed why. Any unknown option stops it.

**Connections.** With no key options it reads `ConnectionStrings:AzureSource` and `ConnectionStrings:SupabaseApp` from the user-secrets of `src/OnlyCars.Api`. With `--source-key A --target-key B` it reads only the environment variables `ConnectionStrings__A` and `ConnectionStrings__B`, and never opens the secrets file.

## The commands for DB-1d

These assume gates 1 and 2 are done, so both strings are in user-secrets. No string goes on a command line or in the environment.

| Gate | Command | What to look at |
|---|---|---|
| 3 | the dry run above | `Source migration` is `20261106063910_TemplateHebrewNames`; `Source collation` is `SQL_Latin1_General_CP1_CI_AS` with `different one: none`, else stop for the PM; counts and bytes against the 500 MB limit; U+0000, unpaired surrogates, trailing spaces, collisions. A target without the baseline is expected at this gate and isn't a stop. |
| 5 | `--apply-baseline`, then a dry run, then `--write` | `Target: empty, apart from 12 TaskTemplates`, then `Verify passed` and `Committed N rows in 22 tables`. A failure prints `Nothing was committed`, and the target is as it was. |
| 5, afterwards, and DB-1d AC2 | `--verify` | `differences 0` on all 22 tables and `Verify passed`. Keep this output in the sign-off. |

`--verify` needs Azure unchanged and the site not yet writing to Supabase, so run it before gate 7. After that, any new row is a difference.

**`--apply-baseline` wasn't in the ticket.** Gate 5 needs the baseline applied, and `dotnet ef` would need the string in the environment or on a command line. This keeps it in user-secrets. It runs as `onlycars_app`, which owns the schema, and it doesn't open the source.

## The dry-run report

Each line, for every run but `--apply-baseline`; `--verify` prints only the first group and the `Verify` lines.

- `Source:` and `Target:` database and host names. `Mode:`.
- `Source migration:`. Any other last migration stops every mode. A model column missing from the source stops every mode.
- `Source collation:`, and string columns with a different one.
- `Not copied: Legacy_*, N rows`.
- `<Table>: N rows, B bytes`, per model table. Bytes are the row's values as UTF-8 text, a guide to what it takes on the target.
- `Values with U+0000: N (Table.Column id, ...)` and `Values with an unpaired surrogate: N (...)`. Either stops `--write`.
- `Trailing spaces, removed by --write: Users.Email: N (ids)`, the same for `Vehicles.Vin`.
- `Collisions after trimming: Users.Email: N (id = id, ...)`, the same for `Vehicles.Vin`, per `UserId`. Any stops `--write`.
- `Target:` not at the baseline, or empty apart from `TaskTemplates`, or not empty, with the tables and counts. Not empty stops `--write`.
- `Verify <Table>: source N, target N, differences N`, `Difference: <Table> <id>: different | missing from the target | not in the source`, `Verify passed` or `Verify FAILED`.
- `db-copy stopped:` with a stop's own text, or an exception's type with its SQL number, or SQLSTATE and constraint name. `Time:`.

## Choices made in this ticket

1. **Collisions use .NET's ICU, not the target's collation.** Gate 3's dry run comes before the target has `und_ci`, and creating even a temporary collation would be a write. `CopyPlan.CollisionKey` is a sort key at the same strength. `CollisionKey_AgreesWithTheCollationInPostgres` compares the two on real Postgres for case, full width, `ß`, a decomposed accent, an ignorable mark, blank, accents, leading space, tab, a final Hebrew letter and niqqud. **The limit:** the two ICU versions could differ on a rare character. The target's unique index still refuses it, and the copy rolls back, but with an index name in place of ids.
2. **Text is read from the source as raw UTF-16** (`CAST(... AS varbinary(max))`). SqlClient turns an unpaired surrogate into U+FFFD when it decodes, and the verify would then pass over a changed value. Postgres can't store one, so it is listed and stops `--write`, as U+0000 does. The ticket names only U+0000. A test pins that every text column in the pinned source is `nvarchar`, as this depends on it.
3. **No second pass for a foreign-key cycle.** The model has none, and `TheModel_HasNoForeignKeyCycle_...` pins it. A cycle stops the tool, so it can't go wrong unnoticed.
4. **The verify in `--write` reads the source again,** so a write that reaches the source during the copy also fails it.
5. **The dry run and `--verify` hold a `READ ONLY` transaction on the target,** so Postgres itself refuses a write. The source has no such guard; AC3's test does that job.
6. **`dotnet ef migrations script --idempotent`,** for the committed schema at `tests/OnlyCars.Tests/DbCopy/sqlserver-schema-20261106063910.sql`. The plain script has one batch per migration and fails on SQL Server, because a batch uses a column it adds. The idempotent one has one batch per statement. Made from a temporary worktree of `15df39e`, since removed.
7. **`DbCopyTests` uses LocalDB,** the one test class that does, because the copy's source has to be real SQL Server. This changes DB-1a AC1's "LocalDB unused": `dotnet test` now needs LocalDB as well as Docker. Each test has its own `OnlyCars_Test_<guid>` database, which it drops. It never connects to `OnlyCars`.
8. **The target's password travels only in the connection string.** The tool doesn't require `SSL Mode=Require`; gate 1's string has it.

## Tests compared with 991

991 + 51 = 1042, none removed or rewritten. All 51 are in `DbCopyTests`.

| Criterion | Tests |
|---|---|
| AC1 | `AC1_CopiesEveryTable_...`: all 22 tables, Hebrew, emoji, nulls, an empty string, every decimal limit, non-zero offsets, 100 ns, a VIN and an email with trailing spaces, a tab and leading spaces kept, a seeded template changed and one deleted at the source, read back through `AppDbContext`. It runs as a schema owner who isn't an admin. |
| AC2 | `AC2_ACorruptedTargetRow_...`, `AC2_ATargetValueThatKeptItsTrailingSpaces_...` (2), `AC2_TwoEmailsThatCollide...` (2), `AC2_TwoVinsOfOneUser...` (2, one for two blank VINs), `AC2_ANonEmptyTarget_...`, `AC2_AWrongSourceMigration_...`, `AC2_ADryRun_...`, `AC2_AFailureMidCopy_...`, `AC2_ATargetWithoutTheBaseline_...`, and `AVerifyThatFailsInsideTheWrite_RollsBack_...` |
| AC3 | `AC3_TheSourceReceivesOnlySelects_...`: an Extended Events session on the server records every batch and RPC from the tool's connection through a dry run, a write and a verify. Each is a single `SELECT`, with the source database set `READ_ONLY` throughout. |
| Secrets | `WithoutKeys_ItReadsTheTwoSecrets_...` (a real process, a fake `APPDATA`, fake values, dead ports, no real secret read), `AMissingOrUnreadableString_...` (4, one with invalid JSON), `WithKeys_ItReadsTheEnvironmentOnly_...` (the secrets file holds invalid JSON), `TheToolUsesTheApisUserSecretsId` |
| Other | `CollisionKey_...` (14), `TheSameVinOnTwoUsers_...`, `AModelColumnMissing...`, `ADryRun_ReportsAColumnWithAnotherCollation`, `AValuePostgresCantHold_...` (2), `ApplyBaseline_...`, `TheModel_...`, `ThePinnedSource_...`, `TheHash_...` (2), `TheRead_RetriesWhileAzureWakes_...`, `ABadCommandLine_...` (4) |

The retry on 40613 is tested with a fake error, as no public way exists to build a `SqlException`. Real Azure wakes aren't tested until gate 3.

## What can reach the output, for the reviewer

Every write to the output is in `tools/OnlyCars.DbCopy/DbCopyTool.cs`, and all of them hold only names, counts, sizes, ids or times.

- No exception message is ever printed. `DbCopyTool.Safe` is the only route, and it prints `CopyStop`'s own text, or a type with `SqlException.Number`, `PostgresException.SqlState` and `ConstraintName`. `CliAsync` and `RunAsync` catch everything, so a bad connection string prints only `ArgumentException` or similar, and no stack trace.
- `CopyStop` messages are built from column and table names, migration ids, a CLR type name and connection-string key names.
- Host and database names come from the connection-string builders. Passwords are never read from them.
- The tests search the output for a value marker on the copy, the verify and the failure paths, and for fake passwords on every connection failure.

**Ids are printed, by the ticket's own wording.** They are GUIDs and carry no personal data. Column and constraint names go to the output too. This section is my own reading: **an independent review of it is still owed** (AC6).

## Rehearsal (AC4)

**Source:** the owner's LocalDB `OnlyCars`, read only and directly. Its last migration was already `20261106063910_TemplateHebrewNames`, so no backup or throwaway copy was needed. **Target:** container `onlycars-rehearsal-pg17`, `postgres:17`, its own Docker network `onlycars-rehearsal`, `127.0.0.1:5436` only, a generated password, TLS on with the image's certificate. The baseline was applied by `--apply-baseline` as `onlycars_app`, made by `scripts/app-db-user.sql`.

**Results:** 208,223 rows in 22 tables, about 31.0 MB. `--write` took 10.0 s, including the verify; `--verify` alone 4.2 s; the dry run 2.6 s. No U+0000, no unpaired surrogates, no trimmed values, no collisions, every string column on the database's collation. All on this machine, so gate 5 will take longer, over the network to Azure and Supabase. Row and byte counts per table:

| Table | Rows | Bytes |
|---|---:|---:|
| TaskTemplates | 12 | 1,479 |
| Users | 2,696 | 562,023 |
| ChecklistTemplates | 1,009 | 127,185 |
| ChecklistTemplateItems | 2,220 | 267,162 |
| NotificationRules | 58 | 6,491 |
| Notifications | 70 | 13,370 |
| Vehicles | 7,825 | 1,086,109 |
| MaintenanceTasks | 10,143 | 1,472,527 |
| ServiceRecords | 81,933 | 11,224,948 |
| OdometerReadings | 84,836 | 13,447,198 |
| ServiceItems | 2,036 | 300,538 |
| ServiceRecordTasks | 10,977 | 1,776,064 |
| TireRotations | 25 | 3,308 |
| Tires | 305 | 53,684 |
| TireMeasurements | 95 | 11,903 |
| TireRotationMoves | 18 | 2,628 |
| VehicleChecklists | 961 | 176,470 |
| ChecklistRuns | 708 | 90,545 |
| ChecklistRunItems | 1,121 | 175,774 |
| Issues | 739 | 118,038 |
| VehicleDocuments | 302 | 42,515 |
| Attachments | 134 | 42,040 |

Not copied: `Legacy_TireChecks` 29, `Legacy_TireMeasurements` 59, `Legacy_TireMounts` 40, `Legacy_TireRotations` 16, `Legacy_TireSets` 91.

### Starting it, for QA (AC5)

The password stays in the container. In Git Bash, from `src/OnlyCars.Api` in the worktree:

```
export ConnectionStrings__Default="Host=127.0.0.1;Port=5436;Database=onlycars;Username=onlycars_app;Password=$(docker exec onlycars-rehearsal-pg17 printenv POSTGRES_PASSWORD);SSL Mode=Require"
export ASPNETCORE_ENVIRONMENT=Staging ASPNETCORE_URLS=http://127.0.0.1:5153 Auth__OpenRegistration=true Jwt__SigningKey=<any dummy of 32 or more characters>
export RateLimiting__AuthPermitLimit=10000 RateLimiting__GlobalPermitLimit=100000 RateLimiting__FailedLoginLimit=10000 RateLimiting__UploadPermitLimit=10000
dotnet run -c Release --no-launch-profile
```

Don't print the string or commit it. Don't use ports 5150, 5173, 5432 or 5433. Checked once with this start: `GET /api/auth/providers` 200, `GET /api/vehicles` 401 without a token; no write was made. Staging has no R2 settings, because it loads no user-secrets. For the R2 paths, set a dev bucket's `Storage` settings for that run only. **I didn't read the user-secrets, so I don't know whether the bucket in them is a dev one: check before using it.**

**The copy holds the owner's real data, and three things can reach outside it:**
- **Email.** The copy has real addresses and notification rules. Run the API with no `Email` settings, and don't call the digest endpoint with any set. `Staging` loads no user-secrets, so it has none unless you add them.
- **R2.** The copy's `Attachments` and other keys are the owner's real keys. Use a dev bucket, delete only on a test account made for the purpose, and never run `sweep-orphans` against this copy: it would call the owner's files orphans or the reverse.
- **Sign-in.** The owner's password hashes are real. Make test accounts. Never reset or change an existing account.

`--verify` will report differences once QA has written to the copy. That is expected.

### Removing it, after AC5

```
docker rm -f onlycars-rehearsal-pg17
docker network rm onlycars-rehearsal
```

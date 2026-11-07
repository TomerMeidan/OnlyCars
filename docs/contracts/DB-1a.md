# Contract: DB-1a, the app runs on Postgres 17

Published by backend-engineer on branch `db-1`. No endpoint, request, response or error code changes, so there is nothing new for the frontend. Checked with HTTP calls against the worktree's API on 127.0.0.1:5151 and a local `postgres:17`.

## Local dev

```
docker run -d --name onlycars-dev-pg17 -p 127.0.0.1:5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
dotnet ef database update --project src/OnlyCars.Infrastructure --startup-project src/OnlyCars.Api
dotnet run --launch-profile http   # in src/OnlyCars.Api
```

These run in Development, the default for `dotnet ef` and the launch profile. `appsettings.Development.json` holds `Host=127.0.0.1;Port=5433;Database=onlycars;Username=postgres`, with no password because the container uses trust auth and binds only to 127.0.0.1. Development also loads the owner's user-secrets. `onlycars-pg` (Postgres 18, port 5432) is not used.

**Without user-secrets, as agents must run:** any other environment needs its own string with `SSL Mode=Require` or stronger, so it needs a database with TLS. Use a container with the image's own certificate, on a port of your choice:  In Git Bash, prefix `docker run` with `MSYS_NO_PATHCONV=1`, or it rewrites the certificate paths.

```
docker run -d --name onlycars-tls-pg17 -p 127.0.0.1:5434:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
ASPNETCORE_ENVIRONMENT=Staging
ConnectionStrings__Default="Host=127.0.0.1;Port=5434;Database=onlycars;Username=postgres;SSL Mode=Require"
Jwt__SigningKey=<any dummy of 32 or more characters>
```

## Startup checks

`RequireDatabaseConnection` (`DependencyInjection.cs`, called from `Program.cs`) stops the app when:
- `ConnectionStrings:Default` is missing or blank, in any environment. `appsettings.json` no longer holds a string, so a production deploy can't fall back to localhost.
- the string can't be parsed.
- outside Development, its SSL Mode is weaker than `Require`. A string with no SSL Mode counts as weak, because Npgsql's default is `Prefer`.

No error message quotes the string. **The string for DB-1d must say `SSL Mode=Require`,** or the site won't start.

`VerifyCA` and `VerifyFull` with `Root Certificate=<path>` pass the check, and the provider handles them with no code change. **Neither is turned on or required. `VerifyFull` with Supabase's CA stays open under L259 for DB-1d,** because it needs the CA from the owner and can't be tested until then.

Tests need Docker running and nothing else: `dotnet test tests/OnlyCars.Tests -c Release`.

## Changed types and rules

| Was (SQL Server) | Now (Postgres) | Where |
|---|---|---|
| `UseSqlServer` | `UseNpgsql(..., AppDbContext.NpgsqlOptions)`, which also puts the history table in the schema | `DependencyInjection.cs`, `AppDbContext.cs` |
| 20 migrations | One `Baseline`, with the template seed and `NameHe`; no `Legacy_*` tables | `Persistence/Migrations` |
| Schema `dbo` | Schema `onlycars` for all tables and `__EFMigrationsHistory` | `AppDbContext.cs` |
| `uniqueidentifier` | `uuid` | provider |
| `datetimeoffset` | `timestamp with time zone` | provider |
| `date` | `date` | provider |
| `decimal(p,s)` | `numeric(p,s)`; configuration still says `decimal(p,s)`, which Postgres stores as `numeric` | provider |
| `nvarchar(n)` / `nvarchar(max)` | `character varying(n)` / `text` | provider |
| Server collation on all strings | `und-x-icu`: Postgres's built-in ICU `und`, deterministic | `AppDbContext.ConfigureConventions` |
| Case-insensitive `User.Email`, `Vehicle.Vin` | `onlycars.und_ci`: ICU `und-u-ks-level2`, non-deterministic | `UserConfiguration`, `VehicleConfiguration` |
| `[Column]` in check constraints and filters | `"Column"`; same 11 checks and 5 filtered unique indexes | `Configurations/*` |
| NO ACTION keys (10) | 8 are `DEFERRABLE INITIALLY DEFERRED`, 2 on `Attachments` stay immediate (see below) | `Baseline` |
| `SET DEADLOCK_PRIORITY HIGH` plus `UPDATE` on runs and documents | `SELECT ... FOR UPDATE` on runs and documents (see below) | `AccountService.cs` |
| SQL errors 1205, 1222 read by reflection | `DbException.SqlState` `40P01`, `55P03` | `AttachmentFiles.cs` |
| `SqlException`, number in Sentry and the start-up log | `PostgresException`, SQLSTATE | `ErrorReporting.cs`, `Program.cs` |
| `SqlConnectionStringBuilder` | `NpgsqlConnectionStringBuilder` | `Program.cs` |
| `scripts/app-db-user.sql`, T-SQL user | Role `onlycars_app`, which owns schema `onlycars` and has no other grants. One transaction, works for a CREATEROLE non-superuser. It sets no password: the role can't sign in until the separate `ALTER ROLE ... PASSWORD` step. | `scripts/app-db-user.sql` |
| `scripts/cleanup-test-users.sql` | Retired | deleted |
| LocalDB in tests | `Testcontainers.PostgreSql`, `postgres:17`, random port, one container per run, a new database per test instance as before | `TestDbContextFactory.cs` |

`ConnectionStrings:Default` is still the one key the app reads, and `render.yaml` still lists it with `sync: false`. `Include Error Detail` is off (the default).

## Choices made in this ticket

1. **Deferred keys. This one wasn't in the ticket.** SQL Server checks a NO ACTION key at the end of the whole statement, cascades included. Postgres checks at the end of each cascaded step, so deleting a car or user failed when a row was reached by two paths (`23503`). The old one-path keys now check at commit: a delete that takes both ends passes, and a raw delete of just the parent is still refused. Cascade or `SET NULL` were rejected: an attach racing a template delete would then delete the car's checklist and its runs instead of being refused.
   - **Deferred:** `FK_VehicleChecklists_ChecklistTemplates_TemplateId`, `FK_OdometerReadings_ServiceRecords_ServiceRecordId`, `FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId`, `FK_Tires_ServiceRecords_ServiceRecordId`, `FK_ChecklistRuns_OdometerReadings_OdometerReadingId`, `FK_TireRotationMoves_Tires_TireId`, `FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId`, `FK_Issues_ChecklistRunItems_SourceRunItemId`.
   - **Immediate:** `FK_Attachments_ChecklistRuns_ChecklistRunId` and `FK_Attachments_VehicleDocuments_VehicleDocumentId`, because `AttachmentFiles` needs their violation as a `DbUpdateException` from the save.
   - **Difference:** a deferred violation arrives as a raw `PostgresException` at commit, not a `DbUpdateException`. No service catch depends on it: the same cases were already 500, or hit the token check first. DB-1b can pin this.
   - **For later migrations:** the EF model can't express deferral, so it lives in hand-written SQL in the baseline. A migration that recreates one of these keys loses it; `Baseline_DeferredKeys_...` fails if that happens.
2. **Account delete locks with `FOR UPDATE`.** With deadlock priority gone, the old `UPDATE` deadlocked with a racing upload and the delete could lose: its lock doesn't block the upload's foreign key check. `FOR UPDATE` makes the upload wait at that key, so there is no deadlock, and it then fails as a 409 once the delete commits. A deadlock in the tiny window between the upload's `INSERT` and `UPDATE` is still possible; returning a retryable 409 for that case is DB-1b AC6. This statement names schema `onlycars` in `Application`.
3. **Default collation is the built-in `und-x-icu`,** not a created `und`: same ICU locale, nothing to create, and the name always resolves.
4. **`SET LOCAL search_path = onlycars` in the baseline.** The provider writes `COLLATE und_ci` without a schema. It lasts only for that migration's transaction, so no connection string or role setting depends on it. A later migration that adds an `und_ci` column needs the same line, and fails loudly without it.
5. **Sentry: `PostgresException` copies its message and `Detail` into `Exception.Data`,** which Sentry sends in `mechanism.data`. It would have leaked row values even with `Include Error Detail` off. `Scrub` now clears it for database exceptions, and `ADatabaseError_...` proves it.
6. **The `dotnet ef` commands in this ticket ran with `ASPNETCORE_ENVIRONMENT=Staging`,** so no user-secrets were loaded. `dotnet ef` runs `Program.cs`, so under Staging it also needs a dummy `Jwt__SigningKey` and a `ConnectionStrings__Default` with `SSL Mode=Require`. `has-pending-model-changes` and `migrations script` don't connect, so a dummy host works for them.

## Tests compared with the ticket's 929

Counted at the first commit: 929 - 1 removed + 10 new = 938. The fix round added 11 test cases to `PostgresBaselineTests`, all listed below; none removed.

**Removed (1):** `TireMigrationTests.Up_CopiesEveryMountCheckAndRotation_KeepsTheOldTablesAsLegacy_AndDownThenUpWorks`, because it tests a migration that no longer exists.

**New (10), `PostgresBaselineTests`:**
- `Baseline_AsTheAppRole_EveryTableInTheSchema_NoneInPublic_NoSequences`
- `Baseline_EveryStringColumnHasItsCollation_EmailAndVinCaseInsensitive`
- `Baseline_MoneyAndDatesHaveTheSpecTypes`
- `Baseline_SeedsEveryTemplateWithItsHebrewName`
- `Baseline_EveryCheckConstraint_IsEnforced`
- `Baseline_EveryFilteredUniqueIndex_RefusesADuplicate_AndAllowsRowsOutsideItsFilter`
- `Baseline_DeferredKeys_LetACascadeReachOneRowByTwoPaths_ButStillRefuseARawParentDelete`
- `ARoleWithNoGrants_CantReadTheSchema`
- `TheAppRole_HasNoRightsOutsideItsSchema`
- `TheTests_RunOnlyOnTheirOwnContainer`

**Added in the fix round, `PostgresBaselineTests`:**
- `Baseline_Down_RemovesTheTablesAndTheCollation_AndCanBeAppliedAgain` (1)
- `Startup_OutsideDevelopment_RefusesAWeakSslMode_WithoutPrintingTheString` (4)
- `Startup_OutsideDevelopment_AcceptsRequireAndStronger` (3)
- `Startup_RefusesAMissingString_InEveryEnvironment` (2)
- `Startup_RefusesAStringItCantParse_WithoutPrintingIt` (1)

**Rewritten, same count, same behaviour checked:**

| Test | Change and reason |
|---|---|
| `ErrorReportingTests.ASqlError_SendsOnlyTheTypeAndNumber_NotTheRowValues` (2 cases) | Now `ADatabaseError_SendsOnlyTheTypeAndSqlState_NotTheRowValues`, with `PostgresException`; the fake `SqlException` is gone. |
| `ErrorReportingTests.ScrubText_RemovesEmailsUrlQueriesAndSqlRowValues` (2 of its cases) | The T-SQL messages became Postgres `Key (...)` and `Failing row contains` messages. |
| `LowNineTests.L183_ALockConflict_IsStill409_...` (2 cases) | 1205 and 1222 became `40P01` and `55P03`. |
| `LowNineTests.L183_AnyOtherSaveError_IsRethrown_...` (2 cases) | -2 and 4060 became `57014` and `3D000`. |
| `ServiceRecordSearchTests.Search_OnSqlServer_EscapesLikeWildcards` | Now `Search_OnPostgres_...`. **It no longer expects `[` to be escaped,** because Postgres `LIKE` has no `[` class; `%` and `_` still are. DB-1b adds the real search results. |
| `AccountDeleteSqlTests.L173_ARunPhotoSavedMidDelete_Is409_AndTheDeleteGoesThrough` (3 cases) | Only the SQL text its gates wait for changed. |
| `AccountDeleteSqlTests`, its seed and `CountsAsync` | No longer seed or count `Legacy_*` rows, which don't exist on Postgres. |
| `MaintenanceSchemaTests.Export_OnSqlServer_...` | `[Column]` became `"Column"` in the query-text checks, and the test is renamed as below. |
| `MaintenanceSchemaTests` index checks (3 tests) | `sys.*` became `pg_catalog`. |
| `MaintenanceSchemaTests.RunAttachments_...`, `DocumentAttachments_...` | Expect `PostgresException` in place of `SqlException`. |

**Renamed `OnSqlServer` to `OnPostgres`, otherwise only the connection changed:** every `*_OnSqlServer_*` test in `MaintenanceSchemaTests`, and `Migrations_SeedTheHebrewTemplateNames_AndTheSearchRunsOnSqlServer` (now `...RunsOnPostgres`).

**Moved to the container, unchanged otherwise:** the other tests in `MaintenanceSchemaTests`, `AccountDeleteSqlTests`, `GoogleSignInSqlTests` and `OfflineOdometerTests`.

## Example, from the checks on 5151

```
POST /api/auth/register {"email":"Db1a-1794040147231@X.test","password":"..."}  -> 200, user.email "db1a-1794040147231@x.test"
POST /api/auth/login, the same address in lower case                            -> 200
POST /api/vehicles {"nickname":"טויוטה","vin":"ABC123",...}                     -> 201
POST /api/vehicles {"nickname":"x","vin":"abc123"}                              -> 409 vehicle.vinTaken
GET  /api/service-records?q=שמן                                                 -> 200, 1 result
GET  /api/vehicles/{an unknown id}                                              -> 404 vehicle.notFound
```

## Not changed, on purpose

- The `(SQL Server)` reasons in the comments on the one-path keys in `Configurations/*` and `Notification.cs` stay: they explain why these keys don't cascade.
- `docs/CHECKLIST.md` and the docs that mention the cleanup script or LocalDB are not edited here, because `main` has uncommitted edits to them.
- Behaviour differences belong to DB-1b. Retry policy and the data copy are out of scope.

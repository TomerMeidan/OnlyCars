# Contract: DB-1b, the same behaviour on Postgres

Published by backend-engineer on branch `db-1`. No screen changes. Two new error codes, both only for a NUL character, which the UI can't type. Checked with HTTP calls against the worktree's API on 127.0.0.1:5152 and a throwaway `postgres:17`, both removed afterwards.

## API changes

No new endpoint. The shapes are unchanged.

| Request | Was | Now |
|---|---|---|
| Any JSON body with `\u0000` in a string, at any depth | SQL Server stored it | 400 `http.400`, field names only |
| `GET /api/service-records?q=` with a NUL | SQL Server ran it | 400 `serviceRecord.invalidSearch` |
| Any upload (record, run, document, car photo) with a NUL in the file name | Cleaned away and saved (`CleanFileName`; from the code, not recorded) | 400 `file.invalidName`, nothing stored |
| `DELETE` account when Postgres picks it as the deadlock victim, or on a lock timeout | Couldn't happen: it had deadlock priority | 409 `concurrency.conflict`. It rolled back whole, so asking again is safe. No extensions. |

Everything else answers as recorded below.

```
POST /api/auth/register {"email":"Db1b-1794049215267@X.test",...}       -> 200, user.email "db1b-1794049215267@x.test"
POST /api/auth/login, the address in upper case with spaces around it   -> 200
POST /api/vehicles {"nickname":"טויוטה","vin":"ABC123"}                 -> 201
POST /api/vehicles {"nickname":"x","vin":"abc123"}                      -> 409 vehicle.vinTaken
POST /api/vehicles {"nickname":"x","vin":"ABC123  "}                    -> 409 vehicle.vinTaken
POST /api/vehicles {"nickname":"a\u0000b"}                              -> 400 http.400
GET  /api/service-records?q=a%00b                                       -> 400 serviceRecord.invalidSearch
GET  /api/service-records?q=שלומ, the shop being "מוסך שלום"            -> 200, totalCount 1, totalCost 10.50
GET  /api/service-records?q=%                                           -> 200, totalCount 0, totalCost 0
GET  /api/checklist-templates after Alpha check, Beta check, beta check -> 200, Alpha check|Beta check|beta check
PUT  /api/vehicles/{id}/photo, filename*=UTF-8''a%00b.png               -> 400 file.invalidName
```

## How the results were recorded

1. A temporary worktree at `15df39e`, the last SQL Server commit, with `tests/OnlyCars.Tests/BehaviourScenarios.cs` copied in. That file runs on both databases through the real services.
2. One xUnit class there ran each scenario on its own database, `OnlyCars_Test_<guid>` on `(localdb)\mssqllocaldb`, with `MigrateAsync` and then `EnsureDeletedAsync`, the way that commit's tests do. It wrote each scenario's lines to a text file.
3. Those lines became the fixed lists in `tests/OnlyCars.Tests/BehaviourRecorded.cs`. They are not regenerated from Postgres. `BehaviourParityTests` compares them line by line, and every accepted difference is named in that file.
4. The worktree is removed, 0 `OnlyCars_Test_*` databases are left, and the owner's `OnlyCars` database was not opened.

**Recorded on:** LocalDB 17.0.4025.3, server and database collation `SQL_Latin1_General_CP1_CI_AS`. **Azure SQL was not read,** so its collation is an assumption until DB-1d. The check is `SELECT DATABASEPROPERTYEX(DB_NAME(), 'Collation')`, a read-only query that can run at gate 3.

## Every difference from SQL Server, for the PM

| Area | SQL Server | Postgres now | Why it stays |
|---|---|---|---|
| Search: width | `ＯＩＬ` finds `OIL` | Finds nothing | The ticket accepts this |
| Search: ligature | `ﬁlter` finds `filter` | Finds nothing | Same family as width; nobody types it |
| Search: sharp s | `strasse` finds `Straße` | Finds nothing; `straße` still does | Not Hebrew or mixed-case English. Two lines in `TextRules` if wanted |
| Search: dotted I | `istanbul` and `İstanbul` find `İstanbul` | Finds nothing | As above |
| Sort: leading punctuation | `(paren)` before `_under` | `_under` before `(paren)` | ICU's punctuation order; only names that start with punctuation |
| Sort: names differing only in a final letter | `שלום` and `שלומ` tie, so creation order decides | `שלומ` first | Only two names equal but for that letter. `מכון` before `מכונית` is unchanged |
| VIN with trailing spaces, saved | Kept: reads back `'ABC123 '` | Saved without them: the call returns `'ABC123 '`, later reads `'ABC123'` | This is how the check and the unique index keep ignoring them. Invisible on screen |
| Cars or tasks equal but for case | No defined order | Stable, by `Id`, within the recorded order | **Looks better, your call.** Without it, Postgres can reorder them when a row is updated |
| Account delete in a deadlock | Never the victim | Can be: 409, rolled back whole | No deadlock priority on Postgres. The ticket asks for this |
| NUL in a file name | Cleaned, then saved | 400 | The ticket asks for this. It also covers the car photo, whose name is otherwise ignored |

No difference in decimals, report sums, averages or their JSON form, in email, in case-only VIN or in the full-width guard.

## What the recording showed, and what changed

- **Search (AC1).** SQL Server's `LIKE` treats a final Hebrew letter as its plain form (`שלומ` finds `שלום`, `בלם` finds `בלמים`) and looks through invisible marks (U+034F, U+061C, U+200D to U+200F, U+202A to U+202E, U+2060, U+2066 to U+2069, U+FEFF; U+202A, U+202C and U+2066 stand for their ranges, and U+200B, U+200C and U+00AD were recorded as not ignored). Niqqud is not looked through. `TextRules.SearchPattern` builds a parameterised regular expression that does the same, and the search uses `Regex.IsMatch(column, pattern, IgnoreCase)`, which Npgsql sends as `~*`. It has the same result on InMemory. `ServiceRecordSearchTests.Search_OnPostgres_EscapesLikeWildcards` tested a `LIKE` that is no longer used, so it became `BehaviourParityTests.Search_OnPostgres_SendsTheWordAsAParameter`. Literal `%`, `_`, `[`, `]`, `\` and `^` are in the recorded list.
- **Sort (AC2).** The word sort is case-insensitive and ignores hyphens and apostrophes. The key is now `regexp_replace(lower(name), '[-'']', '')`, then the name's length, then `CreatedAt` for templates and `Id` for cars and tasks. Lines 415 and 809 of `MaintenanceTaskService` and the task list after a record sort in .NET, so they are unchanged.
- **The QA bug.** `Beta check|beta check` is what SQL Server gives: they tie, so `CreatedAt` decides. Postgres put lower case first after a reload. The client's `byName` (`ChecklistsPage.tsx:29`) uses `sensitivity: 'accent'`, so they tie there too and its stable sort keeps the new row last, which is the order right after Save. The client needs no change. **Smoke step `checklist-low3` should now pass:** `Criterion2_TheSmokeSteps_...` pins the API order. The smoke itself was not run.
- **Email and VIN (AC3).** A converter on `Vehicle.Vin` and `User.Email` removes trailing spaces, for saved values and query parameters alike, so the check, the catch and the unique index all agree. Blank VINs (`""`, `"  "`) collide as recorded. Leading spaces, a tab and accents stay distinct, as recorded.
- **Money (AC4).** Extra decimals round half away from zero on both databases: `1.005` gives `1.01`, `-1.005` gives `-1.01`, `9999999999.995` overflows. Nothing changed for these. One real difference is fixed: a coalesce on no cost came back `0.0` on Postgres and `0.00` on SQL Server, in search totals, reports and the dashboard. `ReportService.InCents` restores the scale.
- **NUL (AC5).** One converter in `ApiJson` covers every JSON string. `UploadedFile` covers every upload, and the search checks `q`. The other query strings (`year`, `sort`, `dir`) already refuse anything unknown.
- **Double save (AC5).** `TireService.MoveAsync` saves twice with `UpdatedAt` as the token. Npgsql cuts 100 ns to microseconds both when writing and in the `WHERE`, so it matches. A real conflict is still `concurrency.conflict`.
- **Races (AC6).** Real `40P01` and `55P03`, not fakes: a second connection forms the cycle, and the session's `deadlock_timeout` decides who is the victim. Covered for run-photo and document-file saves (409, no row, no object) and for account delete (409, every row still there, no prefix deleted, and a second try works).

## A broken deferred key, pinned (AC6)

For each of the 8 deferred keys in DB-1a:

- Saved with another command: a raw `PostgresException` at commit, SQLSTATE `23503`, and the whole save rolls back.
- Saved alone: the same error wrapped in `DbUpdateException`, because the statement commits itself.
- Either way the response is 500 `http.500`, `An unexpected error occurred.`
- The body, the handler's log with the exception text, and every EF log line down to Trace hold neither the row's values nor the missing parent's id. The log does keep `23503`.
- Sentry gets `PostgresException, SQLSTATE 23503` and nothing else, tested with a real exception from a connection with `Include Error Detail=true`. This relies on `Scrub`, not on that setting being off.

**Not a behaviour change from SQL Server,** where the same violation was a `DbUpdateException` and a 500. No `catch (DbUpdateException)` loses a case: the sites either rethrow or map an immediate unique index. `TireService.SaveAsync` inside `MoveAsync` would map a key violation to 409 and a deferred one now reaches `CommitAsync` as a 500, but its tires' tokens fail first, so that path was not reachable in reading the code.

## For DB-1c

- **VIN with trailing spaces in Azure.** A plain copy would keep them, and a stored `'X '` would then be missed by the check, whose parameter is trimmed, and by the unique index. The dry run should report such rows and the copy should decide on trimming them. That conflicts with "strings as exact UTF-8" in the hash, so the ticket needs a line on it.
- **Collisions under the new collation** should compare VIN and email after trimming.

## Tests compared with 949

949 - 1 + 42 = 990. The 1 is the search test rewritten above, counted again in the 42. New: `BehaviourParityTests` (17 cases), `NulRequestTests` (14), `AccountDeleteSqlTests` (9: document race 3, delete as victim 1, lock timeout 1, upload 4), `ErrorReportingTests.ARealPostgresError_AtCommit_...` (1), `MaintenanceSchemaTests.Tires_OnPostgres_TheDoubleSave...` (1). `FileTestBase.NewDb` became virtual and its host uses `Program.cs`'s model-state factory, so the new HTTP tests run on Postgres with the same error shape.

`dotnet ef migrations has-pending-model-changes`: none, as converters don't change the schema. No migration added.

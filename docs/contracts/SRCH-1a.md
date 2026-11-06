# API contract: SRCH-1a, search service history by words and task names, sort, average and last date

Published by backend-engineer, checked with curl against a private API on the new code (LocalDB dev database). Migration `TemplateHebrewNames` (adds `TaskTemplates.NameHe`, nvarchar(100), required, seeded for the 12 templates; it is never returned). Needs the bearer token (401 without it).

## Changed: `GET /api/service-records`

Unchanged: `vehicleId`, `taskId`, `from`, `to`, `skip` (default 0), `take` (default 50, 1 to 100), user scoping (another user's ids just match nothing), non-voided records only, archived cars included. A call without the new parameters answers as before, plus the new fields.

| Parameter | Values | Default |
|---|---|---|
| `q` | 1 to 100 characters after trimming; blank means no search. Split on whitespace into **at most 10 words**. | none |
| `sort` | `date`, `cost`, `odometer` (lower case, exactly) | `date` |
| `dir` | `desc`, `asc` (lower case, exactly) | `desc` |

**Words:** a record matches when **every** word is found (case-insensitive "contains", any order) in at least one of: shop name, notes, an item's description, brand or part number, a linked task's name, that task's starter template name in English or in Hebrew, or, for a tire change (`tireCount > 0`), the labels "Tire change", "Tires" and "החלפת צמיגים" (so the Tires chip's "tires" and "צמיג" both find it). So "oil" and "שמן" both find an oil change whatever language its task was named in, or if it was renamed. No phrase search, no typo tolerance. "שמן" also finds Transmission fluid ("שמן גיר"); accepted.

**Sort:** by the chosen column in the chosen direction. Records **without a cost come last in both directions** for `cost`. Ties fall back to the old order: date newest first, then odometer highest first, then created newest first, then id. Paging with `skip`/`take` never repeats or skips a row.

### Response 200

```
{
  items: ServiceRecordDto[],   // the page
  totalCount: number,          // every match
  totalCost: number,           // every match, a missing cost counted as 0
  averageCost: number | null,  // NEW: totalCost / matches that have a cost, rounded to cents; null when no match has a cost
  lastDate: "YYYY-MM-DD" | null // NEW: the latest date among every match; null when nothing matches
}
```

`ServiceRecordDto` gains **`tireCount: number`**: the tires this record fitted (a tire change); 0 for a normal service. It is on every endpoint that returns a `ServiceRecordDto` (the car's record list, create, edit, file upload), not only the search.

### Errors (400, `ProblemDetails` with `code`)

| code | when |
|---|---|
| `serviceRecord.searchTooManyWords` | NEW: `q` has more than 10 words |
| `serviceRecord.invalidSort` | NEW: `sort` or `dir` is any other value (including `Date`, `DESC` or empty) |
| `serviceRecord.searchTooLong` | unchanged: `q` over 100 characters after trimming |
| `serviceRecord.invalidDateRange` | unchanged: `from` after `to` |
| `serviceRecord.invalidPaging` | unchanged: `skip` < 0, or `take` not 1 to 100 |

No extensions on these errors.

## Examples (from the curl checks)

One car: a 2026-03-02 record linked to an oilChange task (350), a 2026-08-15 record with notes "oil top-up" and no cost, and a 2026-11-06 tire change of 2 tires (900).

`GET /api/service-records?q=oil&sort=cost&dir=desc` (the first record matches through its template's name, the second through its notes; no cost last). The task name is shown as it was meant; Windows curl sent it as `???` in the check, which also proves the match came from the template:

```json
{"items":[
  {"id":"ec75fe36-7c04-4cfb-b735-da037f066701","date":"2026-03-02","odometerKm":41000.00,"shopName":"Speedy Garage","totalCost":350.00,"notes":null,
   "tasks":[{"id":"4670b762-9440-42c1-a159-8e9f1fd485fb","name":"שמן מנוע ופילטר שמן","category":"Oil"}],"items":[],
   "vehicleId":"26661946-46c5-4a8b-a1ac-80617eda52e9","attachments":[],"tireCount":0},
  {"id":"32fbe00f-0892-492d-a198-df889ca71438","date":"2026-08-15","odometerKm":48000.00,"shopName":"Speedy Garage","totalCost":null,"notes":"oil top-up",
   "tasks":[],"items":[],"vehicleId":"26661946-46c5-4a8b-a1ac-80617eda52e9","attachments":[],"tireCount":0}],
 "totalCount":2,"totalCost":350.00,"averageCost":350.00,"lastDate":"2026-08-15"}
```

`GET /api/service-records?q=צמיגים` (URL-encoded):

```json
{"items":[{"id":"fe71a737-3e9c-43a0-858d-4c3a24ba8b74","date":"2026-11-06","odometerKm":50000.00,"shopName":"Tire Pro","totalCost":900.00,"notes":null,
  "tasks":[],"items":[],"vehicleId":"26661946-46c5-4a8b-a1ac-80617eda52e9","attachments":[],"tireCount":2}],
 "totalCount":1,"totalCost":900.00,"averageCost":900.00,"lastDate":"2026-11-06"}
```

`GET /api/service-records?sort=odometer&dir=asc&take=1` → the 41,000 km record only, with `"totalCount":3,"totalCost":1250.00,"averageCost":625.00,"lastDate":"2026-11-06"` (the totals cover every match, not the page; 1250 / 2 records with a cost).

`GET /api/service-records?q=nothing` → `{"items":[],"totalCount":0,"totalCost":0,"averageCost":null,"lastDate":null}`.

`GET /api/service-records?q=a+b+c+d+e+f+g+h+i+j+k` → 400 `{"title":"Validation failed","status":400,"detail":"The search can have up to 10 words.","code":"serviceRecord.searchTooManyWords"}`.

`GET /api/service-records?sort=price` (or `dir=up`) → 400 `{"title":"Validation failed","status":400,"detail":"Sort must be date, cost or odometer, and dir asc or desc.","code":"serviceRecord.invalidSort"}`.

Another user, `?q=oil` or `?vehicleId=<the first user's car>` → 200 with no items and zero totals.

## Notes for the client

- The client-side narrowing while waiting (decisions.md, SRCH-1 (6)) can't see template names; a row matched only through the other language's template name (e.g. "oil" on a Hebrew-named task) appears once the server answers.
- `averageCost` comes rounded to cents; format it like other money.
- The Hebrew template names on the server must stay equal to `templates.*` in `client/src/i18n.ts`; change both together (a test pins the server copy).

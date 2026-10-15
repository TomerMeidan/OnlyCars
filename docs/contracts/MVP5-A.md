# API contract: MVP5-A, checklist templates

Published by backend-engineer, verified with curl against the live API (SQL Server/LocalDB). Every endpoint needs the bearer token (401 without it) and only sees the caller's templates: another user's template is a 404 `checklistTemplate.notFound` on GET, PUT and DELETE. Migration `AddChecklistTemplates` adds the tables `ChecklistTemplates` and `ChecklistTemplateItems`.

## Shapes

```
ChecklistTemplateDto {
  "id": guid, "name": string,
  "itemCount": int,                    // items.length
  "items": ChecklistTemplateItemDto[]  // in the saved order
}
ChecklistTemplateItemDto {
  "id": guid, "label": string,
  "type": "Check" | "Number" | "Text", // Check means OK / Not OK
  "unit": string|null, "minValue": decimal|null, "maxValue": decimal|null   // always null unless type is Number
}
ChecklistTemplateRequest {             // body of POST and PUT
  "name": string,
  "items": [ { "id": guid|null, "label": string, "type": string, "unit": string|null, "minValue": decimal|null, "maxValue": decimal|null } ]
}
```

- `name` and `label` are trimmed; `unit` is trimmed and an empty one becomes null.
- The order of `items` in the request is the saved order. `items` null or missing is an empty list.
- Decimals read back from the database have 2 decimals (`2.6` is returned as `2.60` by GET); the POST/PUT response echoes the value as sent. Same number either way.
- Units are free text; they are not converted by the km/mi setting.

## Endpoints

| Method and path | Body | Success |
|---|---|---|
| `GET /api/checklist-templates` | | 200 `ChecklistTemplateDto[]`, ordered by name, then creation time. `[]` when none. |
| `GET /api/checklist-templates/{id}` | | 200 `ChecklistTemplateDto` |
| `POST /api/checklist-templates` | `ChecklistTemplateRequest` (items without `id`) | 201 `ChecklistTemplateDto`, `Location` header to the GET |
| `PUT /api/checklist-templates/{id}` | `ChecklistTemplateRequest` | 200 `ChecklistTemplateDto` |
| `DELETE /api/checklist-templates/{id}` | | 204; the template and its items are hard deleted |

PUT sends the whole item list:
- an item with the `id` of an item of this template is updated in place and keeps its `id` (its type can change; changing to Check or Text needs unit, min and max sent as null);
- an item without `id` is created with a new `id`;
- items of the template not in the list are deleted.

## Errors

All use the existing ProblemDetails shape with `code`. Item errors carry `index`, the 0-based row in `items`. Checks run in this order and the first failure is returned; a failed request saves nothing.

| Code | Status | Extensions | When |
|---|---|---|---|
| `checklistTemplate.notFound` | 404 | | Unknown id, or another user's template (GET, PUT, DELETE) |
| `checklistTemplate.invalidName` | 400 | | Name empty or over 100 characters after trim |
| `checklistTemplate.tooManyItems` | 400 | | More than 50 items |
| `checklistItem.invalidLabel` | 400 | `index` | Label empty or over 100 characters after trim (or the item is null) |
| `checklistItem.invalidType` | 400 | `index` | Type not exactly `Check`, `Number` or `Text` (case-sensitive; numbers rejected) |
| `checklistItem.numberOnly` | 400 | `index` | A Check or Text item with a non-empty unit, or a min or max |
| `checklistItem.invalidUnit` | 400 | `index` | Number item's unit over 20 characters after trim |
| `checklistItem.invalidRange` | 400 | `index` | Min or max outside -1,000,000 to 1,000,000, more than 2 decimals, or min above max (each is optional) |
| `checklistItem.invalidId` | 400 | `index` | PUT: an `id` that is not an item of this template (another template's, unknown, or the same `id` twice). POST: any item `id` |
| `checklistTemplate.tooMany` | 400 | | POST when the user already has 100 templates |
| `http.400` | 400 | `errors` | Malformed JSON or a non-guid/non-number value (model binding) |

## Example (curl)

```
POST /api/checklist-templates
{"name":" Monthly quick check ","items":[{"label":"Lights","type":"Check"},{"label":"Tire pressure","type":"Number","unit":"bar","minValue":2.0,"maxValue":2.6},{"label":"Notes","type":"Text"}]}
201
{"id":"09d379f0-…","name":"Monthly quick check","itemCount":3,"items":[
 {"id":"14bdf680-…","label":"Lights","type":"Check","unit":null,"minValue":null,"maxValue":null},
 {"id":"39a7f722-…","label":"Tire pressure","type":"Number","unit":"bar","minValue":2.0,"maxValue":2.6},
 {"id":"6ce1c253-…","label":"Notes","type":"Text","unit":null,"minValue":null,"maxValue":null}]}

PUT /api/checklist-templates/09d379f0-…   (move Notes first and rename it, add Wipers, keep Lights, drop Tire pressure)
{"name":"Monthly","items":[{"id":"6ce1c253-…","label":"Notes v2","type":"Text"},{"label":"Wipers","type":"Check"},{"id":"14bdf680-…","label":"Lights","type":"Check"}]}
200
{"id":"09d379f0-…","name":"Monthly","itemCount":3,"items":[
 {"id":"6ce1c253-…","label":"Notes v2","type":"Text",…},
 {"id":"e6051f58-…","label":"Wipers","type":"Check",…},
 {"id":"14bdf680-…","label":"Lights","type":"Check",…}]}

PUT with another template's item id
400 {"title":"Validation failed","status":400,"detail":"Item 1: The item doesn't belong to this checklist.","code":"checklistItem.invalidId","index":0}

POST {"name":"T","items":[{"label":"L","type":"Number","minValue":3,"maxValue":2}]}
400 {"title":"Validation failed","status":400,"detail":"Item 1: Min and max must be -1000000 to 1000000 with at most 2 decimals, and min not above max.","code":"checklistItem.invalidRange","index":0}

GET /api/checklist-templates/09d379f0-…   as another user
404 {"title":"Not found","status":404,"detail":"ChecklistTemplate '09d379f0-…' was not found.","code":"checklistTemplate.notFound"}

DELETE /api/checklist-templates/{id}  ->  204; GET it  ->  404 checklistTemplate.notFound
```

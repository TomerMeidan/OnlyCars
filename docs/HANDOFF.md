# Handoff: 2026-11-24

## Where things stand
- **Live:** `main` at `ca30641`, merged from [TomerMeidan/OnlyCars#5](https://github.com/TomerMeidan/OnlyCars/pull/5) and deployed to Render with a manual deploy. Render reports the deploy `dep-dc2uh6rm8hqs73ad0vng` as live, which means it passed the health check at `/api/auth/providers`.
- **What is in it:** OBD-1, the device tokens and the readings sent by the OBD adapter app, with all the review and audit fixes:
  - a 2,000 km/day limit, counted from the last reading of an earlier day;
  - a `SELECT … FOR UPDATE` row lock, so parallel posts can't go over the 20-readings-a-day cap;
  - a resent reading is answered before the archived-car check;
  - the `DbCopyTests` foreign-key loop covers only the copied tables;
  - the `settings-devices` smoke step.

  See the last rows of `docs/decisions.md`.
- **Tests:**
  - On Linux, 1,026 passed.
  - `BehaviourParityTests.Criterion1_Search` fails, and it fails on the old `main` too.
  - The 88 `DbCopyTests` passed on the owner's Windows PC on 2026-11-24 (88 of 88, 0 failed). They only cover the database copy tool, which the live app doesn't use.

## Open items
1. ~~Run `DbCopyTests` on the Windows PC.~~ Done 2026-11-24: 88 passed, 0 failed.

2. **Render auto-deploy doesn't fire on pushes to `main`.** The service settings, read through the Render API on 2026-11-24, are correct:
   - `autoDeploy: yes`, trigger `commit`, branch `main`;
   - repo `https://github.com/TomerMeidan/OnlyCars`;
   - the GitHub app access was already checked.

   The likely cause is a stale link between Render and GitHub. **Owner:** in Render, the service, Settings, Build & Deploy, disconnect the repository, then reconnect it with branch `main`. Until then, start a Manual Deploy after each merge. With the Render MCP, use `trigger_deploy` with service `srv-dbkc9l3bc2fs73f1tt6g` and workspace `tea-csppvgl6l47c738h2ob0`.
3. **`BehaviourParityTests.Criterion1_Search` fails on `main`.** The cause hasn't been looked into.
4. **Owner items** in `docs/CHECKLIST.md`, under "Waiting on the owner":
   - rotate the Supabase app password;
   - add the Sentry DSNs in Render;
   - back up, then delete, the Azure SQL server.

## Notes for the next session
- The owner prefers plain language and low token use, and replies in Hebrew when they write in Hebrew.
- A cloud session can't reach `onrender.com` directly, because the proxy blocks it. Check deploys through the Render MCP instead.

# OnlyCars design: the workshop green

## The idea

OnlyCars looks like a well-kept workshop app: soft, very rounded sheets on a grey-green floor, one deep teal-green for everything you can press, and amber kept for the one thing a car owner must notice (something is due soon). The drum odometer in its dark bezel is still the single loud element, so a car always reads as a car and not as a spreadsheet row. On a phone the app is driven from the thumb: a bottom tab bar with icons, the current tab raised in a teal bubble, and a labelled floating button for the main add action. (Owner, 2026-11-06: in the direction and patterns of maintano.app, not its brand; every value here is OnlyCars' own.)

It is deliberately **not** a SaaS dashboard (no gradients, no glass, no colored section headers, no shadow under every card) and not a racing theme. Cards have no border and no shadow: the floor tint alone separates them. Shadows are kept for the three things that float: the tab bar, the More menu and the floating button.

## Color tokens

All tokens live on `:root` in `client/src/index.css` as `light-dark(light, dark)`. `color-scheme` picks one (the OS, or `data-theme="light|dark"` from Settings). Ratios are WCAG 2 contrast ratios worked out from the hex values (`--tonal` and the status tints are `color-mix` results).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#e7edea` | `#0c1412` | the floor (page background) |
| `--surface` | `#fafcfb` | `#151f1c` | cards, inputs |
| `--sunken` | `#eef3f0` | `#101916` | open edit panels, stat boxes, archived cards, read-only fields |
| `--raised` | `#ffffff` | `#1c2824` | the tab bar and the More menu (the layer above cards) |
| `--ink` | `#0f1f1b` | `#e2ebe7` | text |
| `--muted` | `#4b5c57` | `#9db0a9` | labels, hints, secondary lines, inactive tabs |
| `--line` | `#d3ddd8` | `#2b3a35` | row dividers (decoration), progress-bar track |
| `--field` | `#73847e` | `#6c7f78` | input and select borders |
| `--primary` | `#0b6b5a` | `#6fd6bd` | filled buttons, the current tab's bubble, links, month and category bars, OK status |
| `--on-primary` | `#ffffff` | `#00382e` | text and icons on primary |
| `--tonal` | primary 13% on surface | same | secondary buttons, hover on tabs and nav, the selected wheel |
| `--focus` | = `--primary` | = `--primary` | focus ring, checkbox and radio fill |
| `--cluster` | `#0d2a24` | `#050d0b` | odometer bezel (dark in both themes) |
| `--cluster-ink` / `--cluster-muted` | `#eef4f1` / `#a9bdb6` | same | text in the bezel |
| `--amber` | `#f2a516` | `#f6b73c` | the odometer unit, the Undo bar tint (18%), the brand dial |
| `--fault` | `#b3261e` | `#ff8a7a` | error text, flagged items |
| `--danger` | `#b3261e` | `#d92d20` | destructive buttons (white text) |
| `--status-ok` / `-soon` / `-overdue` | `#0b6b5a` / `#8f5300` / `#b3261e` | `#6fd6bd` / `#f6b73c` / `#ff8a7a` | status text, chips and progress fill: teal far, amber close, red past |

### Contrast (text 4.5:1, large text, UI parts and focus 3:1)

| Pair | Light | Dark |
|---|---|---|
| ink on surface / bg / sunken / raised | 16.5 / 14.4 / 15.2 / 17.0 | 13.9 / 15.4 / 14.7 / 12.5 |
| muted on surface / bg / sunken / raised | 6.9 / 6.0 / 6.3 / 7.1 | 7.4 / 8.2 / 7.9 / 6.7 |
| field border on surface / bg (UI) | 3.8 / 3.3 | 4.0 / 4.4 |
| primary (links, focus ring) on surface / bg / raised | 6.2 / 5.4 / 6.4 | 9.7 / 10.7 / 8.7 |
| on-primary on primary (buttons, current tab, current nav pill) | 6.4 | 7.5 |
| ink on tonal (secondary buttons) / primary on tonal | 13.5 / 5.1 | 10.2 / 7.1 |
| muted on tonal | 5.6 | 5.4 |
| white on danger | 6.5 | 4.8 |
| busy or disabled danger (`--danger` 50% with `--field`) on surface / white on it | 5.6 / 5.8 | 3.2 / 5.3 |
| cluster-ink / cluster-muted / amber on cluster | 13.7 / 7.7 / 7.4 | 17.6 / 10.0 / 11.0 |
| fault on surface / bg | 6.3 / 5.5 | 7.4 / 8.2 |
| status ok / soon / overdue on surface | 6.2 / 6.0 / 6.3 | 9.7 / 9.4 / 7.4 |
| status text on its 12% chip tint | 5.0 or more | 6.0 or more |
| ink on a search highlight (`mark`: primary 22% on surface) / its primary underline (UI) | 11.9 / 4.5 | 8.3 / 5.8 |
| status fill on bar track (`--line`) | 4.6 / 4.4 / 4.7 | 6.8 / 6.7 / 5.2 |

Amber on the light surface is about 2:1, so in the light theme the Due soon text and bar use the deeper ochre `#8f5300`; amber itself only appears on the dark bezel, as a tint behind ink, or in the brand mark. The brand tile has fixed colors (`#0b6b5a`, amber dial, white needle) in both themes. Print turns everything black on white.

## Type

- **Rubik** (Google Fonts, 400 to 700) for headings, figures, buttons, tabs and chips; **Assistant** (400 to 700) for reading text. Both draw Latin and Hebrew, so a Hebrew page has the same voice as an English one. Fallback: `system-ui`, Segoe UI, Arial. The CSP already allows `fonts.googleapis.com` and `fonts.gstatic.com`; `public/boot.js` loads both faces with a Latin and a Hebrew letter so the service worker caches them for offline.
- Body text 1.0625rem (17px) on `body`, line height 1.5; Assistant runs small, so reading text is a step up while `rem` stays 16px.
- Headings (Rubik): `h1` 2rem/1.15 700; `h2` 1.3rem/1.25 600 (car names on the dashboard 1.45rem); `h3` 1.05 to 1.15rem 600. Slight negative tracking (-0.01em).
- Figures: the drum 2.1rem Rubik 600 `tabular-nums`; the report's year total 2.75rem 700 (the "big number"); history and stat values 1.1 to 1.3rem 600.
- Labels 0.95rem `--muted`; chips 0.8rem Rubik 500; tab labels 0.8rem Rubik 500 (700 on the current tab).
- No all-caps, no letter-spaced eyebrows.

## Space, shape, elevation, layout

- Spacing steps: 0.25, 0.5, 0.75, 1, 1.25, 1.5rem. Cards pad 1.25rem with a 1rem gap; `main` stacks blocks 1rem apart.
- Radius by rank: cards 24px (`--r-card`), fields, panels, stat boxes and photos 16px (`--r-control`), the bezel 20px, buttons, chips, nav items and the Spending switch fully round (`--r-pill`). The floating button is 18px (a rounded rectangle, so it reads as a different thing than the pills in the page).
- Elevation: cards are flat and borderless on the floor. Floating layers only: the tab bar (a 1px `--line` top edge and a soft shadow), the More menu (a `--line` ring and a shadow), the floating button (a primary-tinted shadow), the current tab's bubble (a small primary shadow).
- Layout: one column, `main` at most 42rem and centred (Service history's table page 60rem); the header row at most 64rem. Phone padding is 1rem; nothing scrolls sideways at 360 or 390px. Tap targets are 44px or more (fields and buttons 48px).

## Components

- **Header**: on the floor, no bar. The brand is the dial mark on a deep teal rounded tile plus "OnlyCars" in Rubik 700. From 40em up the nav links are pills (`--muted`, hover `--tonal`); the current page (`aria-current="page"`) is a filled primary pill with on-primary text (a shape as well as a color). Log out is a plain text button in the same row.
- **Phone tab bar** (NAV-1, below 40em signed in): fixed to the bottom on `--raised`, its top corners rounded 24px, padding for `env(safe-area-inset-bottom)`. Four equal items (Dashboard, Spending, Tires, More), each a 1.4rem stroked icon (inline SVG in `App.tsx`, `aria-hidden`, none mirrored since none points a direction) over its label. The current item's icon sits in a 3.5 x 2rem primary bubble raised 2px with on-primary icon, and its label turns ink and bold. More is a disclosure button (`aria-expanded`, `aria-controls`) whose menu is a raised card above the bar at the inline end, with Settings and Log out as 44px rows; it closes on Esc, a tap outside or a choice. The header keeps only the brand.
- **Floating add button** (`.fab`): on a phone with the tab bar, the dashboard's Add car is fixed above the bar at the inline end, a plus icon and its label ("+ Add car", never a bare "+"). From 40em up it is an ordinary primary button beside the title. `main` and the scroll padding leave room for it.
- **Page title**: a small label above a large title where the page has one: the Back link ("All cars") on car pages, the Spending switch on Spending.
- **Buttons**
  - Primary (default `button`, `.button`): a teal pill, on-primary text, Rubik 500; hover darkens toward ink; press scales to 0.97.
  - Secondary (`.add`, `.add-file`, `.scan`, `.more`, `.mount`, `.move`, picker rows): a tonal pill (primary 13% on surface) with ink text, no border.
  - Danger (`.danger`): `--danger` pill, white text.
  - Link (`button.link`, links in `.actions`): primary text, Assistant 600, underlined, 44px tap target.
  - Busy: `disabled` or `aria-disabled="true"` at 0.55 opacity (progress cursor for `aria-disabled`/`aria-busy`). A busy or disabled danger is greyed instead (`--danger` mixed half with `--field`). Buttons whose label changes while busy keep their width with `.stack` and `data-alt`.
- **Inputs**: 48px, 16px radius, surface fill, `--field` border (3:1); ink border on hover, primary border and ring on focus; `--muted` placeholder. Checkboxes and radios use `--primary` as the accent; the whole label is the 44px target (`label.inline`).
- **Cards**: `.card` is a borderless 24px sheet on `--surface`. An archived car is `--sunken` with a dashed 2px `--line` outline.
- **Dashboard car card**: the car photo (if any) as a 4.5rem rounded square beside the name and model line, then the odometer, the quick reading, the counts, and the most urgent tasks, each with its progress bar (teal far, amber close, red past), its remaining line and Mark done at the end.
- **Lists**: rows divided by 1px `--line` (`.tasks`, `.services`, `.history`, `.figures`). An open edit or confirm panel in a row sits on `--sunken` with 16px corners.
- **Service history rows**: the date as the row title with the odometer reading at the end side (Rubik 600), then one line "place · amount" in muted with the amount in ink and bold.
- **Status**: a chip with the word, the status color on a 12% tint, and a shape: a circle for OK, a triangle for Due soon / Expiring, a square for Overdue / Expired. Progress bars are 0.5rem pills that fill from the inline start (the right in Hebrew).
- **Odometer**: the drum counter (each digit a cell; leading zeros dimmed; only changed digits roll) inside a dark teal-black bezel with 20px corners, the unit in amber Rubik, and the km/day average beside it in `--cluster-muted`.
- **Reports year card**: the year, the total as the big number, and three small stat boxes on `--sunken` (services, top month, top category). The number and boxes are `aria-hidden` because the summary line and the rows below say the same thing to screen readers. Month and category bars are primary.
- **Spending switch** (`.subnav`): a segmented pill on `--surface`; the current tab is a filled primary pill.
- **Undo bar and notice**: an amber 18% tint with 16px corners, rising in.
- **Tire drawing** (TIRE-2b): as before (the car from above in its own SVG, always `dir="ltr"`), but the selected wheel is a primary edge on `--tonal` with its tire filled primary; the pair buttons are tonal pills and the selected one is filled primary. Low tread stays a dashed `--status-soon` outline with the Due soon word and triangle.
- **Scanner** (SCAN-1): unchanged; it uses `--bg`, `--surface`, `--cluster` and `--amber`.
- **Service history search** (SRCH-1b): chips, car pills and quick dates are rows of tonal pills (`.quick` of `button.more`), the pressed one filled primary (as the tire groups); an archived car's pill is `--sunken` with the dashed outline. The results are a table (Date | Car | What was done | Shop | Odometer | Cost), the Date, Odometer and Cost headers sort with an arrow (↓ ↑, ↕ when not sorted; vertical, so not mirrored). Year and month header rows are sticky on `--surface`. Matched words are a `mark` in primary 22% with a 2px primary underline (a shape as well as a tint). A row opens its service card below it on `--sunken`. Below 40em the sort headers become a row of pills and each row a two-line card (date, car, cost; what was done, shop, odometer in muted).
- **Empty, loading, error**: empty is a plain sentence with the action next to it; loading is a `--muted` `role="status"` line in the place the content will take; errors are `--fault` text (600) with `role="alert"` and a Retry button where a retry makes sense.

## Motion

One easing, `cubic-bezier(0.2, 0, 0, 1)` (`--ease`), at 200ms for small changes (button press, tab bubble, chevron, the Undo bar rising) and 400ms for larger ones (the drum digits rolling, a progress bar changing). Nothing animates on page load. Under `prefers-reduced-motion: reduce` every animation and transition is off.

## RTL and Hebrew

Logical properties only (`margin-inline`, `padding-block`, `inset-inline`, `border-start-start-radius`). Numbers in running text are wrapped in `<bdi>`; the drum is always LTR. The tab icons, the dial and the status shapes have no direction, so they are not mirrored; the fold chevron is. Rubik and Assistant draw Hebrew with the same weights as Latin.

## Checking a change

`node ui-tests/design-shots.mjs <name>` (API and Vite running; `BASE_URL` for another port) seeds a user and saves the main screens in en/he, light/dark, 390 and 1280px to `ui-tests/out-design/<name>/`, and prints any sideways overflow. Registration must be open on that API (`Auth__OpenRegistration=true`).

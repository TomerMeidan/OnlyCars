# OnlyCars design: the glovebox service book

## The idea

OnlyCars looks like the service book that lives in a car's glovebox, read under the light of the instrument cluster. The pages are quiet paper with ruled entries in dark petrol ink; the one loud thing is the cluster: a dark bezel with the drum odometer and its unit lit in amber, and the same dark strip as the header. Amber is the "lit telltale" color, used for the one main action on a form and for nothing decorative.

It is deliberately **not** a SaaS dashboard (no KPI tiles, gradients, drop shadows under every card, or a different color per section), and not a sporty "racing" theme (no carbon fibre, neon, italics or speed lines). It should feel like a tidy, trustworthy logbook.

## Color tokens

All tokens live on `:root` in `client/src/index.css` as `light-dark(light, dark)`. `color-scheme` picks one (the OS, or `data-theme="light|dark"` from Settings). Ratios are WCAG 2 contrast ratios, worked out from the hex values.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#e6e9e3` | `#0c1215` | page (the desk under the book) |
| `--surface` | `#fcfcfa` | `#151e22` | cards (a page of the book), inputs |
| `--sunken` | `#eff1ec` | `#10181b` | archived cards, open edit panels, the Undo bar, read-only fields |
| `--ink` | `#142229` | `#e7ecea` | text |
| `--muted` | `#505e64` | `#9ba9aa` | labels, hints, secondary lines, chart bars |
| `--line` | `#cbd1ca` | `#2a363b` | dividers and card edges (decoration), progress-bar track |
| `--field` | `#788589` | `#6b7b80` | input, select and secondary-button borders |
| `--focus` | `#142229` | `#f5b53a` | focus ring, checkbox and radio fill |
| `--cluster` | `#0f1a1f` | `#060b0d` | header and odometer bezel (dark in both themes) |
| `--cluster-ink` / `--cluster-muted` | `#eef2ef` / `#a7b4b5` | same | text on the cluster |
| `--amber` | `#f2a516` | `#f5b53a` | primary buttons, the unit on the odometer, header rule, current nav item |
| `--on-amber` | `#142229` | `#142229` | text on amber |
| `--fault` | `#b8321f` | `#ff7a66` | error text, flagged items |
| `--danger` | `#b42318` | `#d92d20` | destructive buttons (white text) |
| `--status-ok` / `-soon` / `-overdue` | `#1d7745` / `#8a5206` / `#b3311d` | `#5cc98d` / `#f5b53a` / `#ff7a66` | status text, badges, progress fill |

### Contrast (text 4.5:1, large text, UI parts and focus 3:1)

| Pair | Light | Dark |
|---|---|---|
| ink on surface / bg / sunken | 15.8 / 13.3 / 14.3 | 14.2 / 15.8 / 15.1 |
| muted on surface / bg / sunken | 6.5 / 5.5 / 5.9 | 7.0 / 7.8 / 7.4 |
| field border on surface (UI) | 3.7 | 3.8 |
| focus ring on surface (UI) | 15.8 | 9.3 |
| on-amber on amber | 7.9 | 9.0 |
| white on danger | 6.6 | 4.8 |
| busy or disabled danger (`--danger` 50% with `--field`) on surface / white on it | 5.6 / 5.7 | 3.2 / 5.4 |
| cluster-ink / cluster-muted / amber on cluster | 15.6 / 8.3 / 8.6 | 17.5 / 9.3 / 10.9 |
| fault on surface / bg | 5.8 / 4.9 | 6.6 / 7.4 |
| status ok / soon / overdue on surface | 5.4 / 6.2 / 6.1 | 8.2 / 9.3 / 6.6 |
| status text on its 10% badge tint | 4.7 or more | 6.5 or more |
| status fill on bar track (`--line`) | 3.6 / 4.1 / 4.0 | 6.0 / 6.8 / 4.9 |
| chart bar (`--muted`) on surface | 6.5 | 7.0 |

Amber on the light surface is 2.0:1, so amber is never used for text or a ring on paper; amber buttons carry their own dark text and are named by it. Print turns everything black on white.

## Type

- **Noto Sans** and **Noto Sans Hebrew** (Google Fonts, variable `wdth` 62.5 to 100 and `wght` 400 to 800). One family in two widths: the Latin and Hebrew shapes match, and the condensed width carries the "stamped label / gauge" character.
- Reading text: normal width, 400, 1rem/1.55. Labels 0.95rem `--muted`. Small badges 0.8rem 600.
- Headings: condensed (`font-stretch: 75%`), 700. `h1` 2.125rem/1.1, `h2` 1.4rem/1.2, `h3` 1.15rem.
- Figures (odometer drum, history values, unit): condensed 700, `tabular-nums`. Drum 2.25rem; history values 1.4rem.
- Weights: 400 body, 500 links and errors, 600 to 650 names and buttons, 700 headings and figures, 800 the brand.
- No all-caps labels, no letter-spaced eyebrows.

## Space, shape, elevation, layout

- Spacing steps: 0.25, 0.5, 0.75, 1, 1.25, 1.5rem. Cards pad 1.25rem with a 1rem gap; `main` stacks cards 1.25rem apart.
- Radius by rank: cards 14px (`--r-card`), controls 10px (`--r-control`), odometer bezel 12px, drum 6px, badges fully round.
- Elevation: flat. Cards are separated by a 1px `--line` edge, not shadows. The only shadows are the bezel's inner shading and the 2px darker lower edge on filled buttons (a key you press).
- Layout: one column. `main` is at most 42rem (one book page) and centred on desktop; the header spans the full width. Phone padding is 1rem; nothing may scroll sideways at 360 or 390px.

## Components

- **Header / navigation**: the dark cluster strip with a 3px amber rule under it. The brand is a dial mark (inline SVG, also the favicon) and "OnlyCars" in condensed 800. Nav links are `--cluster-muted`, without underline; the current page (`aria-current="page"` from `NavLink`) is lit in `--cluster-ink` with a 2px amber underline (two cues, not just color). The language switch and Log out sit in the same row. At 390px the nav wraps to its own lines. Every item is 44px tall.
- **Phone navigation** (NAV-1): below 40em, signed in, the header keeps only the brand and the page links move to a tab bar fixed to the bottom: the same cluster strip with its 3px amber rule on top, five equal text items (Dashboard, History, Checklists, Tires, More), at least 48px tall, the current one lit in `--cluster-ink` with the 2px amber underline as in the header. More is a disclosure button (`aria-expanded`, `aria-controls`), lit when the page is Reports or Settings; its menu opens above the bar at the inline end (under More, so on the left in Hebrew) on the same cluster, with Reports, Settings, the language switch and Log out as 44px rows, and closes on Esc (focus back on More), a tap outside or a choice. The bar pads `env(safe-area-inset-bottom)` (with `viewport-fit=cover`), and `main` and the scroll padding leave room for it. No icons, badges or motion. Signed out, and from 40em up, the header is as above.
- **App icons** (PWA-1): the dial mark from `favicon.svg`, rendered to PNG by `node scripts/icons.mjs` (from `client/`; rerun after a favicon change): 192 and 512 px as the favicon (rounded `--cluster` tile); the 512 maskable and the 180 `apple-touch-icon` full bleed on `--cluster`, the maskable mark at 0.8 scale inside the 80% safe circle.
- **Buttons**
  - Primary (default `button`, `.button`): amber fill, `--on-amber` text, 650 weight, 2px darker lower edge, presses down 1px.
  - Secondary (`.add`, `.add-file`, `.more`, `.mount`, `.move`, picker rows): surface fill, `--field` border, ink text; hover goes sunken with an ink border. Use it for actions that open a form rather than save one, so a section has at most one amber button at rest.
  - Danger (`.danger`): `--danger` fill, white text.
  - Link (`button.link`): underlined text, 44px tap target, thicker underline on hover.
  - Busy: `disabled` or `aria-disabled="true"` at 0.55 opacity (the progress cursor for `aria-disabled`/`aria-busy`). A busy or disabled danger button is greyed instead (`--danger` mixed half with `--field`, full opacity), so it keeps 3:1 on the page. Buttons whose label changes while busy keep their width with `.stack` and `data-alt`.
- **Inputs**: 44px tall, surface fill, `--field` border (3:1), ink border on hover and focus, `--muted` placeholder. Checkboxes and radios use `--focus` as the accent color; the whole label is the 44px tap target (`label.inline`).
- **Cards**: `.card` is a page: surface, 1px line edge, 14px radius. An archived car is dashed and sunken.
- **Lists**: ruled rows (`.tasks`, `.services`, `.history`, `.figures`), 1px `--line` between rows. An open edit or confirm panel in a row sits on `--sunken`.
- **Status**: a telltale badge with the word, the status color on a 10% tint, and a shape: a circle for OK, a triangle for Due soon / Expiring, a square for Overdue / Expired. Progress bars fill from the inline start (the right in Hebrew) with the status color.
- **Odometer**: the drum counter (each digit a cell; leading zeros dimmed; only changed digits roll) inside a dark bezel with the unit in amber condensed, and the km/day average beside it in `--cluster-muted`. It is the one bold element on a screen.
- **Undo bar**: sunken, amber inline-start rule, slides in. A one-time notice (`.notice`, such as "Your account was deleted." on `/login`) looks the same.
- **Empty, loading, error**: empty is a plain `--muted` sentence with the action next to it; loading is a `--muted` `role="status"` line in the place the content will take; errors are `--fault` text (500 weight) with `role="alert"` and a Retry button where a retry makes sense.

## Motion

Short and only in answer to an action: the drum digits roll in (0.45s), a pressed button moves down 1px (80ms), the Undo bar rises in (160ms). Nothing animates on page load. Under `prefers-reduced-motion: reduce` every animation and transition is off.

## RTL and Hebrew

Logical properties only (`margin-inline`, `padding-block`, `inset-inline`, `border-inline-start`). Numbers in running text are wrapped in `<bdi>`; the drum is always LTR. The dial mark and status shapes have no direction, so they are not mirrored. Hebrew uses the same sizes and weights as English; Noto Sans Hebrew is drawn to match Noto Sans.

## Checking a change

`node ui-tests/design-shots.mjs <name>` (API and Vite running) seeds a user and saves the main screens in en/he, light/dark, 390 and 1280px to `ui-tests/out-design/<name>/`, and prints any sideways overflow.

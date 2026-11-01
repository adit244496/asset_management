# IT Asset Engine — Frontend

React + Vite single-page app for IT Asset Engine. Talks to the
Flask backend in `../backend` over the REST API defined in
`../docs/API_CONTRACT.md` — that document is the source of truth for every
endpoint shape and the role permission table; this README covers how to build
and run this frontend.

**Structure note:** this app is built to match
`E:\project_catalog\catalog1\frontend`'s conventions (React + Vite, plain CSS
per component, `src/pages` + `src/components`, an axios instance in
`src/api.js` with a JWT request interceptor and a 401 response interceptor,
`lucide-react` icons, oxlint) — the same house style as the user's other
projects. It replaces an earlier vanilla-JS + Tailwind build of the same
screens; the visual design language (dark navy sidebar, warm-white content
surfaces, blue accent, Manrope + IBM Plex Sans) was carried over deliberately
unchanged, as were all features.

## Directory layout

```
index.html            Vite entry document (just #root + the module script)
vite.config.js         Vite + React plugin; dev server on 5173; the /api
                       proxy to the backend (in dev, the single place that
                       knows the backend's port)
.oxlintrc.json         Lint config (npm run lint)
public/
  favicon.svg          The "AN" brand mark
src/
  main.jsx             React entry (createRoot + StrictMode)
  App.jsx              Providers, BrowserRouter, route guards, app shell
  App.css              Shell layout (sidebar + content column, scroll rules)
  index.css            Design tokens (:root / [data-theme='dark']) + shared
                       primitives: buttons, form fields, banners, modals,
                       data tables, status badges, brand mark
  api.js               axios instance: baseURL from VITE_API_BASE_URL, JWT
                       request interceptor, session-expiry handling (see
                       lib/sessionExpiry.js), errorMessage()
  context/
    AuthContext.jsx    Session state: login, logout, current user, role
                       helpers (isAdmin / isSuperadmin / canWrite),
                       token bootstrap against GET /auth/me
    MastersContext.jsx The master (dropdown value) lists, loaded once per
                       session from GET /api/masters (see "Master data")
    AssetsContext.jsx  The selected register held in memory for the session,
                       plus create/update/delete/bulk/clear and the derived
                       dropdown options. Also owns `register` (which of the
                       two lists is showing), caches each one separately, and
                       exposes fetchRecord()/assetHistory() for one record
                       from a NAMED register rather than the selected one
    ThemeContext.jsx   Light/dark theme, OS default + remembered override
  lib/
    schema.js          The asset-register columns (labels, types, groups,
                       required flags, seed options, header aliases, filter
                       and sort types), the client-side validation mirror of
                       the server rules, and the two presentation orders
                       REPORT_COLUMNS (the grid) and EXPORT_COLUMNS (the
                       CSV/Excel download) — one array drives both, so they
                       cannot drift apart
    parser.js          Excel/CSV -> schema-keyed rows (SheetJS, lazy-loaded)
    charts.js          Chart.js config builders + the validated palette
    exporters.js       CSV / Excel export of the filtered register (in
                       EXPORT_COLUMNS order, i.e. the Report Section's own
                       column order), and the bulk-upload template workbook
    assetTemplate.js   Contents of that template (header row, Field Guide,
                       column widths), derived from schema.js COLUMNS
    scanDetect.js      Pure timing rules that tell a barcode reader apart
                       from someone typing
    serials.js         One serial number, one device: the matching rule
                       (lower/trim), who already holds a serial, and how
                       that reads to the operator
    warranty.js        Warranty / AMC state per asset, fleet age from the
                       purchase date, and the dashboard's counts
    masterFile.js      Reads an uploaded spreadsheet into master values:
                       header detection, column guessing, de-duplicated
                       extraction (SheetJS, lazy-loaded like parser.js)
    parseMasterPaste.js   Turns pasted text into master-table entries, and
                       classifies entries from either source against the
                       current list
    statusClass.js     Buckets a Status value into scrapped (deleted, and
                       excluded from the dashboard) / in-use / in-stock /
                       later-added / sold for the dashboard KPI tiles,
                       understanding both letter codes (A, C, D) and
                       spelled-out statuses ("In Use", "LATER ADDED",
                       "SOLD"). The buckets are not a partition — see the
                       note in the file
    sessionExpiry.js   Tells a dead-session 401 from a 401 a route raised
                       for its own reasons (a wrong confirmation password),
                       so only the former signs you out
    dashboardFilters.js  The "Unspecified" bucket label shared by the
                       charts and the dashboard's global filters, plus the
                       predicate that maps it back to "this field is blank"
    dropdownPlacement.js  Pure geometry for positioning a floating panel
                       against its button (flip, clamp, resolved width)
    userSearch.js      Matching one account out of hundreds on User
                       Management: username + full name, every term must
                       match, "rohit ghosh" finds rohit.ghosh
    registers.js       The two registers (assets / peripherals): API path,
                       the words on screen, and the three column labels that
                       differ. See "Two registers" below
    unknownMasters.js  Which values in a parsed upload no master list has,
                       so the upload screen can ask before sending. The
                       server checks again; this buys the question
    historyGroups.js   Turning the audit trail's one-row-per-changed-field
                       into one entry per thing that happened -- what counts
                       as a move, what belongs together, and in what order.
                       See "One entry per thing that happened"
    qrDecode.js        Reading a QR out of a camera frame: the native
                       BarcodeDetector where it exists, the vendored jsQR
                       everywhere else, and the rules for what to tell
                       someone whose camera will not open. See "Scanning
                       with the camera"
  vendor/
    jsqr/              jsQR 1.4.0 (Apache-2.0), vendored because this
                       network cannot reach the npm registry. Not linted,
                       not edited; the file's own banner records where it
                       came from and what was changed
  components/
    Sidebar.jsx        Nav, current user, theme toggle, logout
    KpiRow.jsx         The dashboard KPI tiles (Total, In Use, In Stock,
                       Later Added, Sold/Disposed, Out of Warranty, Sites)
    ChartCard.jsx      One chart; owns the Chart.js instance lifecycle, and
                       the expander that opens what its "Other" bar is
                       hiding (see "Opening the Other bar")
    Banner.jsx         The page-level confirmation strip: auto-dismissing,
                       closable, pauses on hover (see "Banners" below)
    AssetForm.jsx      Schema-driven asset form (Data Entry + edit modal)
    BarcodeInput.jsx   Text field that also accepts a handheld barcode
                       reader (see "Barcode scanning" below)
    AssetModal.jsx     Edit-an-asset modal, with the History panel
    AssetHistory.jsx   One asset's trail of changes, newest first
    HistoryGroup.jsx   One entry in a trail -- one thing that happened,
                       however many rows the audit table recorded for it.
                       Shared by the panel and the full History page
    BulkEditModal.jsx  Set the same value on many selected assets
    QrCodesModal.jsx   QR labels for a selection: one at a time, or a
                       printable sheet of all of them
    QrScanner.jsx      The device's own camera as a QR reader: owns the
                       stream and the decode loop, hands back the decoded
                       text, releases the camera on unmount
    AssetDetail.jsx    One asset in full, read-only, driven by the schema
    BulkUpload.jsx     Drag-and-drop Excel/CSV import with preview + de-dupe
    ReportTable pieces MultiSelectFilter.jsx, StatusBadge.jsx
    UserModal.jsx      Create/edit a user account
    MasterOptionModal.jsx  Create/edit one master-table value
    MasterBulkAdd.jsx  Add many master values at once, from an uploaded
                       spreadsheet or pasted text, with a preview of what
                       each value will do
    ClearAllModal.jsx  Password-confirmed "Clear all data" dialog
    ScanSerialsModal.jsx  Walks a selected queue of assets capturing one
                       serial number each, scanner-driven
  pages/
    LoginPage.jsx          Sign-in screen
    DashboardPage.jsx      KPI tiles + the six-chart grid, fits one screen
    DataEntryPage.jsx      Manual entry form + (admin) bulk upload
    ReportPage.jsx         Full register: per-column filters, sort, paging,
                           export, row edit/delete/restore, bulk edit, scan
    MasterDataPage.jsx     Admin-only master data: a tab per master table,
                           plus a Users tab (components/UsersPanel.jsx)
    LookupPage.jsx         Find one asset by scan or serial, in full
    HistoryPage.jsx        Assets that have been changed, server-filtered
    HistoryDetailPage.jsx  One asset's full trail, grouped by day
```

Each component/page has a matching `.css` file imported at the top of the
JSX file, following catalog1's convention. Anything shared by more than one
of them lives in `index.css` instead.

## Install & run

Requires Node.js 18+ (developed against Node 24) and npm.

```bash
cd frontend
npm install
npm run dev       # dev server with hot reload -> http://localhost:5173
npm run build     # production bundle into dist/
npm run preview   # serve the built bundle -> http://localhost:4173
npm run lint      # oxlint
```

The backend has to be running too (see `../backend/README.md`). The easiest
way to get both up, from the repo root:

```powershell
..\start-dev.ps1     # starts whatever isn't already running, then health-checks it
..\stop-dev.ps1      # stops only this repo's dev servers
```

`start-dev.ps1` reuses an already-healthy backend rather than starting a
second one, waits until each side actually answers before reporting success,
and tells you what to fix if it can't start (missing venv, missing `.env`,
port occupied by something else).

> If port 5173 is taken, Vite falls back to the next free port and prints the
> actual URL. Nothing needs reconfiguring when that happens — the app uses a
> relative API path, so the port it happens to land on doesn't matter.

## How the app reaches the API

The app calls the **relative** path `/api`, i.e. the same origin the page was
served from. Something in front forwards that to the Flask backend:

| Environment | What forwards `/api` | Configured in |
|---|---|---|
| `npm run dev` | Vite's dev-server proxy | `vite.config.js` |
| Production    | nginx `proxy_pass`, or the IIS equivalent | `nginx.conf` |

This is deliberate, and it removes a whole category of breakage:

- **No backend host or port is baked into the bundle.** Verified: the built
  JS contains no `localhost:8000`, just `baseURL: "/api"`. Moving the backend
  never requires rebuilding or re-pointing the frontend.
- **CORS is not involved at all.** The browser only ever talks to one origin,
  so there are no preflights and no way for a stale `CORS_ORIGINS` list on
  the backend to break the app.
- **One place knows the backend's port.** In dev that's the proxy target in
  `vite.config.js`, overridable without editing the file:

  ```bash
  API_PROXY_TARGET=http://localhost:8010 npm run dev
  ```

`VITE_API_BASE_URL` still exists as an escape hatch for a deployment where
the API genuinely lives on a different origin. If you set it, the backend's
`CORS_ORIGINS` must allow this frontend's origin, because you have opted back
into cross-origin requests. Note that Vite inlines `VITE_*` variables at
**build** time, so it has to be set before `npm run build` — changing it
afterwards does nothing to an already-built bundle.

## Auth flow

- The JWT is stored in `localStorage` under `iam_auth_token_v1`, so a signed-in
  user stays signed in across reloads and restarts until the token expires.
  (catalog1 uses `sessionStorage`; `localStorage` is kept here to preserve the
  previous build's behaviour of not logging people out when they close a tab.)
- `AuthContext` validates any stored token against `GET /auth/me` on startup,
  because a token can be present but stale.
- `api.js`'s response interceptor clears the token and fires an
  `iam:unauthorized` event when the session is genuinely over; `AuthContext`
  listens and drops back to the login screen without a full page reload.
  **Not on every `401`** — that is decided by `lib/sessionExpiry.js`, which
  looks for the backend's `code: "invalid_token"` marker, set only by the
  `token_required` decorator. Some endpoints answer `401` for their own
  reasons (a mistyped confirmation password on "Clear all data", a wrong
  current password when changing it); those must surface as an error on the
  screen you are on, not log you out.
### The four profiles

`src/lib/roles.js` mirrors `backend/app/roles.py`; `AuthContext` exposes
three helpers built from it, and the rest of the app asks those rather than
comparing role strings:

| Helper | True for | Hides, when false |
|---|---|---|
| `canWrite` | superadmin, admin | Data Entry (nav + route), row Edit / Clone, Edit selected, Bulk Upload, the Edit button on Find an Asset and the record page |
| `isAdmin` | superadmin, admin | Master Data, including its Users tab (nav + route), Scrap |
| `isSuperadmin` | superadmin | the per-row **Restore**, "Clear all data", "Clear all users", the per-row **Delete permanently**, the Activity Log |

`isAdmin` is true for a superadmin too, so every control that was already
admin-gated keeps working for the profile above without being listed twice.

A **viewer** therefore sees the dashboard, the register, history, lookup and
QR labels, and no control that would change anything. An **assignee** never
reaches the UI at all — the login screen refuses them with *"This profile
cannot sign in."*

**Scrap and Delete are different words on purpose.** The bulk button says
*Scrap* (reversible, admin); the red row icon says *Delete permanently*
(superadmin, password-confirmed, `PermanentDeleteModal`).

The two are **alternatives, not stages** — the row icon appears on every
record, scrapped or not, so a superadmin removing something created by
mistake does not have to scrap it first. What keeps that safe is the dialog
rather than hiding the button: it names the record, says plainly how this
differs from scrapping (and, on a record that is still live, suggests
scrapping instead if you might want it back), and asks for the caller's own
password.

All of this is a UX nicety only — the backend enforces every rule
independently with a `403`, per `../docs/API_CONTRACT.md` §2. Hiding a
button is not a permission.

## Assigned User is narrowed by Location

Two screens choose a location and a holder together, and both narrow the
people list to the place: the **entry form**
(`components/AssignedUserField.jsx`) and the **Transfer dialog**. The rule
itself lives in `lib/people.js` — `splitByLocation` returns `here`,
`unknown` and `elsewhere` — so the two cannot drift apart about who counts
as being at a place.

On the form, **the Location section is rendered above Assignment**, which is
not the order `schema.js` GROUPS lists them in. It has to be: reaching the
person first means choosing from all 622 and never seeing the narrowing.
Only the form is reordered — the grid and the exports read the flat column
list, and the record detail view keeps the familiar reading order because
there is nothing to fill in there.

It is an **`<input>` with a `<datalist>`, not a `<select>`**, and that is the
whole design decision. The Assigned User column is not only people:
`KSS OFFICE`, `SOLD TO PAWAN KUMAR JAIN` and `SERVICE-ECOSPACE` are real
values here. A dropdown makes those unenterable; a plain text box gives no
help with the 622 who *are* people. A datalist is both at once — type
anything, and the people at this location are suggested while you do. There
is no mode to switch, so no mode to be in the wrong one of.

**A name that resolves to exactly one account fills in both Email ID and
Location** from that account. The relationship runs both ways: choosing a
Location narrows the suggested people, and choosing a person sets the
Location. Neither is typed a second time, which is what stops them drifting
— an asset issued to somebody cannot disagree with the directory about
their address or where they sit.

The two are not treated identically, and the difference is deliberate:

- **Email ID is set even when the person has none** — blank is the right
  answer, and the previous holder's address would be worse.
- **Location is set only when the person has one.** Location is required,
  and blanking a filled-in field to record that we don't know where somebody
  sits would take something away for nothing. The hint says so.

Three cases the field is careful about:

- **Two accounts share a name** → resolves to *neither*
  (`findByName` returns null on ambiguity), so neither Email ID nor Location
  is filled. A name alone does not identify a person, and guessing would put
  one person's address on the other's laptop. The hint says so and asks for
  both to be entered by hand.
- **The value is not a person** → *"Not in the directory — saved as typed."*
  Said plainly rather than flagged as a problem; these values are legitimate
  and always have been.
- **The name changes away from a person** → the address this field filled in
  for them is **taken back**. Typing `KANKANA DAS` and then replacing it with
  `KSS OFFICE` must not save Kankana's address against a store room. Only
  ever its own: an address somebody typed, or one that arrived with the
  record being edited, is left alone.

Typing the name of somebody at *another* location is not blocked — it moves
the Location to theirs and says where it came from. The field informs rather
than refuses, because the register is the thing that is out of date about as
often as the entry is.

## Clone carries, and locks what it carries

Clone answers one question — *"another one of those"* — so the form it opens
is not a blank one with suggestions in it. Everything that makes the new
record the **same kind of thing** is carried from the source and shown
**read-only**; what is left blank is what belongs to the individual unit.

Three buckets, all declared in `lib/schema.js`:

| Blank + editable (`CLONE_BLANK_KEYS`) | Carried + editable (`CLONE_PREFILLED_KEYS`) | Carried + locked |
|---|---|---|
| Srl No., Computer / Asset Name | Status | Asset Type, Model |
| Description | Location, Floor | PO No., Date of Purchase |
| Assigned User, Email ID | Department, Company | Comments |
| Warranty / AMC End, Insurance Expiry, Assigned Date | | |
| Linked Peripherals | | |

`cloneAsset()` blanks the first column; `AssetForm`'s `cloning` prop locks
anything in neither of the first two that is not already server-generated.

The middle bucket exists because those five carry over *usually* but
routinely need changing: a clone may go into stock rather than into use, to
another floor, department or group company. Pre-filling saves the typing;
locking them would mean saving the record and immediately editing it.

Three of those blanks matter more than they look:

- **Srl No.** — a serial identifies one physical device. Duplicating it onto
  a second is the one thing a clone must never do.
- **Description** — it carries the service tag in brackets, which the
  importer matches on. Copying it would make the new asset look like the old
  one to every duplicate check.
- **Linked Peripherals** — the original's mouse is plugged into the
  original. It is the one `generated` column a clone leaves open, because it
  is also the control you attach peripherals with.

**Read-only, not hidden.** The carried values are the reason Clone was
pressed; you should be able to see what you are getting. They are editable
again the moment the record exists — locking is for the entry, not the
asset. The lock also drops on save or Clear Form, since locking a blank
field would be nonsense.

Cloning something that is **in stock** leaves Assigned User and Email ID
disabled for the status's reason rather than the clone's — the more specific
of the two explanations wins.

## Inventory (`pages/InventoryPage.jsx`, `lib/inventory.js`)

Everything marked **IN STOCK**, across both registers.

**Not a third register.** A spare keyboard is an ordinary row of the
peripheral list whose status says nobody is using it, so this is a view over
what already exists — and nothing on it writes. Something leaves stock by
being edited or transferred, in the screens that already do that; this one
shows the result rather than offering a second way to cause it. Rows link
straight to the record, which is where anything you'd then *do* lives.

**Every profile that can sign in** — viewer included, with no role flag on
the nav item or the route. "Have we got a spare dock" is the commonest
question asked of this app, and making a viewer ask an admin instead is how
a register stops being trusted.

**Both registers at once**, unlike the Report Section's toggle: the store
room does not keep laptops and keyboards in separate rooms, so the register
is a column here rather than a mode.

**The counts lead**, because they are the actual question — `PRINTER 3`,
`DOCKING STATION 2` — and clicking one narrows the table to it, since having
read the number the next thing anyone wants is *which* ones. The register
chips recompute the type counts, so picking Peripherals never leaves a count
that disagrees with the rows under it.

### Something enters stock by having its status changed

There is no "move to inventory" action, because there is nothing to move —
setting the status to IN STOCK **is** putting it on the shelf, and the
screen follows.

Doing that **releases the holder**: the server blanks Assigned User and
Email ID (`crud._apply_asset_fields`), and the form says so before you save
rather than accepting a name it is about to throw away — the field is
disabled, reads *"Nobody — it is in stock"*, and the hint names who will be
cleared. `validateAsset` drops the Assigned User requirement for the same
status, mirroring `crud.validate_asset_fields`; otherwise the form would
demand a name the save is about to remove.

Two matching rules worth knowing, both in `lib/inventory.js`:

- **Status is matched on shape**, not equality (`^in[\s_-]*stock$`), the way
  the backend matches "in use". This register spells statuses
  inconsistently — `In Use` beside `IN STOCK` in one master list — and a
  peripheral marked `in-stock` is doing the same thing as one marked
  `IN STOCK`. A status that merely *contains* the words (`not in stock`)
  does not count.
- **Deleted rows are excluded** even if their status still says IN STOCK. A
  scrapped machine is not a spare. Deletion moves a record to SCRAP anyway,
  so this is belt and braces rather than a second rule.

Two spellings of one type count separately. That is the master list's
problem to fix — papering over it here would hide the thing that needs
correcting.

## Searching the lists (`lib/textSearch.js`)

Every tab on Master Data has a search box — the five value lists and Users —
and it is literally the same control (`components/SearchBox.jsx`) over the
same rules. They sit one click apart, so a box that folded separators on one
tab and not the next would be two behaviours wearing one shape.

`textSearch.js` holds the rules; `userSearch.js` and `masterSearch.js` only
say **which fields are searchable** (username/name/email, and value +
description). Nothing goes to the server: each list arrives whole in one
request, so filtering is a synchronous pass and the rows narrow as you type.

- **Every term must match**, so a second word narrows rather than widens —
  typing `ecospace 3` after `ecospace` is how you get from six rows to two.
- **Separators fold to spaces** on both sides, so `rohit.ghosh` and
  `ROHIT GHOSH` are the same query.
- **Counts stay honest**: `3 of 21 — 21 active`. The active/retired figures
  are over the whole table, because a count that changed as you typed would
  be answering a different question.
- **An empty result is not an empty table** — it says what matched nothing
  and offers to clear the search, rather than reading as data loss over 67
  rows.
- **Switching tabs clears the query.** Arriving at Locations to find 3 of 21
  rows, with no obvious reason why, is worse than losing what you typed.

The description is searchable because the terse values need it: `A` and `D`
say nothing on their own, and "Disposed of" is the only place a word anyone
remembers actually appears.

## "N/A" shows as a dash (`lib/notRecorded.js`)

The app already showed an em dash for an empty field — `AssetDetail`'s
comment says why: on a lookup screen the *absence* of a value is
information. But a spreadsheet does not leave cells empty, it writes
**"N/A"**, so the same fact arrived in two shapes and was shown two ways.
226 cells in this register say N/A, **204 of them the Floor column**, and a
grid of them reads as data when it is the opposite.

`isNotRecorded()` now catches blank and the placeholder spellings the
register actually contains (`N/A`, `NA`, `N.A.`), and three places render
them the same muted dash: the **Report Section grid**, the **record detail**,
and the **column filter** — a column showing a dash while its filter offers
"N/A" is one value under two names, and you could not find the rows you were
looking at. `Site / Floor` drops a missing half rather than printing it, so
that cell no longer reads `N/A · N/A`.

Two boundaries, both deliberate:

- **The list is short.** Only unambiguous placeholders, because a wider net
  eats real values — `NIL` and `NONE` are plausible supplier names, and a
  false positive hides a fact behind a dash, which is worse than showing
  "N/A".
- **Display only.** Nothing is rewritten. Filtering, sorting, global search
  and both exports still see the stored `N/A` — a CSV is data leaving the
  system, and a download that disagreed with the register would be worse
  than an ugly cell. The same goes for the history trail and its PDF, which
  record what a field *held*, not what it means now.

## Download PDF (`components/HistoryReport.jsx`)

The per-asset history page has a **Download PDF** button. It calls
`window.print()`; the destination in the browser's dialog is *Save as PDF*,
which Chrome and Edge default to.

**Not a PDF library, on purpose.** None is reachable on this network, and
letting the browser paginate is better than anything hand-rolled anyway: it
page-breaks a variable-length table correctly, embeds fonts, and produces
selectable text. `HistoryReport` is rendered permanently but hidden, and
revealed only by `@media print` — the same approach `QrCodesModal` takes for
labels, so `window.print()` has nothing to wait for.

It is a **separate rendering**, not the screen trail with a print stylesheet
over it, because the two answer different questions. On screen entries
collapse — most of the time you want the shape of what happened. On paper
nothing can be clicked, so a collapsed entry is a fact that has been
withheld: **every change is listed**. The report also names its subject, its
register, when it was produced and by whom, because a page of undated
changes with no subject is not evidence of anything.

Two things the print stylesheet has to force, both found by actually
printing it:

- **Every colour is reset**, not just the container's. `h1 { color:
  var(--text-primary) }` in `index.css` is near-*white* in the dark theme, so
  the report's title printed white on white — invisible, and invisible in a
  way nothing on screen would show you.
- **`html, body` are forced white** (`!important`). The theme's page surface
  is near-black in dark mode, which would print as a page of solid ink. The
  report must come out identical whichever theme the admin happens to be in.

## Transfer (`components/TransferModal.jsx`)

The primary action on a record page — moving a machine and handing it to
somebody is the everyday thing that happens to a record, where Edit is for
correcting what is already written.

Location and Assigned User were separate fields on the edit form, which is
how an asset ends up at ECOHUB 4A assigned to someone at RAICHAK: nothing
connected them, so nothing noticed. Here **the destination is chosen first**
and the list of people is then narrowed to that place, so the mismatch is
not available to make rather than being caught afterwards.

Three groups of people, and the split is the whole design:

| Group | Offered? |
|---|---|
| Recorded **at the destination** | yes — the answer nearly always |
| **No location on file** (86 accounts) | yes — refusing them would make this unusable for the people an admin most needs to sort out |
| Recorded **somewhere else** | hidden behind "Show everyone else (n)", because offering them is offering the mistake |

Widening the list is one click and never hidden, because people do change
desk. Picking someone from elsewhere shows a warning naming both places, and
only then does the request carry `allowElsewhere`. The server checks the same
pairing and refuses a mismatch with `422 location_mismatch` — this dialog is
what makes that refusal rare, not what enforces it.

A **peripheral** has no Assigned User, so `canAssign={false}` there.

### …and a peripheral in use asks for an asset, not a place

The dialog changes its question based on the record's status, mirroring
`crud.peripheral_transfer_mode`:

| Status | What it asks for |
|---|---|
| **in use** | *Find the asset* (free-text) + *Plug into* — its location follows whatever it is plugged into |
| anything else | *Move to* + *Floor*, as for an asset |

Rendered **instead of** the location fields, not beside them: offering both
is offering the contradiction the branch exists to remove. A short note says
why the question changed.

The asset search matches across Asset ID, computer name, serial, service tag,
holder and model — because what you know about the laptop you are plugging
something into varies with why you are standing in front of it. Only the
first 40 matches are listed; a 629-entry select is a scroll, not a choice.
Only one of the two lists (people or assets) is ever fetched.

## Two registers: Assets and Peripherals

The app keeps two lists — assets (laptops, desktops, servers, printers) and
peripherals (keyboards, mice, docks, headsets). They are separate tables on
the server with identical structure, and **the same components render both**.

`AssetsContext` owns which one is showing. `register` is the selected key,
`setRegister` changes it, `meta` carries the words for it, and every API
call in the context is built from that register's path — so `assets`,
`createAsset`, `bulkImport` and the rest keep meaning "the list you are
looking at" and no consuming page had to change how it calls them. Each
register's rows are cached separately and fetched **lazily**, the first time
it is selected; the choice is remembered in `localStorage` so the toggle
survives a reload.

`<RegisterToggle />` appears on Dashboard, Data Entry, Report Section and
History — **one selection for the app, not a per-page filter**, because
"which list am I working in" is not a question worth re-answering on every
screen. It is a radio group in a fieldset rather than two buttons: the
options are mutually exclusive, which is what a radio group is, and arrow-key
navigation and the right announcement come with it.

**Exactly three column labels differ** (`lib/registers.js`):

| Key | Assets | Peripherals |
|---|---|---|
| `assetId` | Asset ID | Peripheral ID |
| `type` | Asset Type | Peripheral Type |
| `assetTag` | Computer / Asset Name | Peripheral Name |

Everything else — Srl No., Model, Make, Status, Location, PO No., the dates —
means the same thing about a keyboard as about a laptop, so renaming it would
make the two grids harder to read side by side, not easier.

**Four columns are register-specific**, marked `onlyIn` in `schema.js` so
they drop out of the other register's grid, form, filters and export at once:
`user` and `email` are assets-only (a mouse is used by whoever is using the
laptop it is plugged into), `linkedPeripheralsText` is assets-only and
`linkedAssetText` is peripherals-only. `schema.js` rewrites just those labels over the one `COLUMNS` array
(`columnsFor` / `reportColumnsFor` / `exportColumnsFor` / `byKeyFor`) rather
than keeping a second array that would drift; the column sets are built once
per register at module load, and an unchanged column is **the same object**,
so `byKeyFor('srl', …) === byKey('srl')` and the memoised grid code still
sees stable identities.

Both spellings are **header aliases** on import, so a template downloaded
for either register loads into either. Which list an upload lands in is the
toggle's decision, not the file's — silently routing rows by their header
would be a much worse surprise than loading them where you are standing.

**Find an Asset deliberately has no toggle**: it searches both registers and
labels each result with the one it came from. Someone scanning a label is
holding a device and asking what it is; which list it is filed under is part
of the answer, not something they need to know before they can ask.

### Linking peripherals to an asset

`<LinkPeripherals />` fills the **Linked Peripherals** slot on the asset
entry form and the edit modal: scan or type an identifier, get a chip, save.
Three ways in, all resolved by the same server lookup, because the person
holding a mouse should not have to know which one they are using:

1. **Typed** — a serial number or a Peripheral ID.
2. **A barcode reader**, which is a keyboard wedge. The same timing rules as
   `BarcodeInput` (`lib/scanDetect.js`) recognise the burst and swallow the
   trailing Enter so it cannot submit the whole entry form.
3. **A QR label** from this app, which is several lines — hence a
   `<textarea>`, not an `<input>`: an input silently keeps only the first
   line, and a reader configured to send the whole payload would look broken.

It resolves against the **server**, not the peripherals cached in the
browser: the scan has to find the authoritative record, including one added
by someone else a minute ago, and the matching rules already live in one
place. It refuses an asset's own label ("only peripherals can be linked"),
refuses an ambiguous partial match rather than guessing which mouse, and
warns — but allows — when a peripheral is currently on another asset.

It also tells you what saving will *do*, which depends on the peripheral's
type: an **exclusive** one (a mouse, a keyboard) already on another asset
will be **moved** — a warning; a **shared** one (a printer) is simply
**added** and stays where it was — an aside. The server sends `isSharedType`
on every peripheral so the field can use the right words.

Two schema columns carry the relationship, one per register, both `generated`
and both marked `onlyIn` so each stays out of the other's grid, form, filters
and export:

| Key | Register | Label |
|---|---|---|
| `linkedPeripheralsText` | assets | Linked Peripherals |
| `linkedAssetText` | peripherals | Linked To (several, for a shared type) |

**Whether a type is shared is set on the Master Data screen**, in a column
that appears for Asset Types alone — "One at a time" / "Several assets". It
is on the type rather than on each device because that is where the fact
lives: printers are shared, this printer is not special.

Their **value is flat text** — the grid, the per-column filter, the global
search and the CSV/Excel export are all string operations. The structured
form (`linkedPeripherals`, an array; `linkedAsset`, an object) rides
alongside on the record for the chips, passed through `normalizeAsset`
rather than declared as a column. Being `generated` also keeps them out of
the upload template, which is right: you cannot plug a mouse into a laptop by
typing a serial into a spreadsheet, and a column that looked like you could
would be a trap.

## Column filters and sorting

Each column's filter widget comes from its `filterType` in `lib/schema.js` —
`text` (contains), `select` (checkboxes), `date` (range) — and each column's
**ordering** comes from `isNumericColumn()`, which is a different question.

**A checkbox filter offers only the values the register actually holds**, not
the whole master list (`filterOptionsFor` in `AssetsContext`). Forty
departments listed when nine are in use is thirty-one choices that return
nothing, and a tick producing an empty grid reads as a broken filter rather
than as an empty category. Three lists, three questions:

| | What it answers | Used by |
|---|---|---|
| `optionsFor` | everything that *could* appear — masters ∪ data | the status colour map; the base the other two narrow |
| `filterOptionsFor` | what the register *actually holds* | the grid's column filters |
| `formOptionsFor` | what you *may pick* when entering a record | the entry form and edit modal |

They can't be collapsed into one: the entry form must offer a value nothing
uses yet — that is the point of adding one — and for Site and Floor, which
have no master table, `formOptionsFor` falls back to `optionsFor`, so
narrowing *that* would make a new site impossible to enter.

`filterOptionsFor` narrows `optionsFor` rather than sorting afresh, so the
curated master order survives (Statuses stay A, B, C, D). It is scoped to the
whole register rather than the rows currently showing — options that vanished
as you filtered would make it impossible to widen a selection — and it always
keeps what is **already ticked**, so a value can't disappear from the list
while still filtering the grid.

**Srl No. is where the two part company.** It holds numbers, so it sorts
numerically and sits right-aligned in tabular figures; but it filters as a
text search, because what anyone does with a serial number is *look one up*.
A min/max range over serials answers a question nobody asks — "is it between
400 and 500" tells you nothing about a device — and it cannot find
`H6RP9G3` at all. The column carries `sortType: 'number'` to keep the order
while the filter changed.

That matters more than it sounds: **Srl No. is the grid's default sort**, so
letting it fall back to text ordering would have made a register of 1–627
read `1, 10, 100, 101 … 2, 20`.

`filterType: 'number'` (the min/max pair) is now unused. It is kept because
a genuinely numeric column added later should get a range filter with no
work here.

## Opening one record

**Clicking a row in the Report Section opens that record's own page** —
`/report/:register/:id`, `pages/RecordPage.jsx`. The grid answers "which of
these", in twenty columns you scroll sideways through; this answers "what is
this one", with every field readable at once.

**No history on this page.** It had the trail in a slim sticky column on the
right; the page is for reading the record as it stands, and the trail was
competing for both the width and the attention. **Full trail** in the bar
goes to `/history/:id`, which is a page built for reading it. Removing the
sidebar gave the record back about 358px — four columns of fields on a
1400px window where it had three — and it no longer fetches a trail it will
not show.

- **The Actions cell is excluded** from the row click — its controls mean
  other things. Checked by `e.target.closest('.actions-cell')` so a click on
  the icon *inside* a button is caught too, and a click that is really a text
  selection (dragging across a serial to copy it) is ignored.
- **The row is keyboard-reachable**: `tabIndex={0}` with Enter/Space, because
  a `<tr>` is not focusable on its own and the only other way in would be the
  Edit button, which is a different thing to want.
- **The register is in the URL, not taken from the toggle.** A reload, a link
  someone was sent, and the linked-record cards — which cross from an asset to
  a peripheral and back — all need the page to know its own kind. Arriving
  from a link moves the toggle to match, so Back lands in the right list.
- **The record is fetched from the server**, not read out of the cached
  register: on a cold load there is nothing cached.
- **The page waits for the record and the URL to agree** before rendering.
  React re-renders with the new params before the fetch for them resolves,
  so without the gate one machine's fields show under another machine's URL
  — on a page whose whole job is "what is this one", the worst thing it
  could do. It used to be worse still: the history panel took the old
  record's id with the new register and asked
  `/api/assets/<a peripheral's id>/history`, a 404.
- **Linked records are cards, not text.** `AssetDetail` takes an `omit` prop
  so the two flat link columns are left out of the body here; the same
  information is a click away instead. The scan-lookup page passes no `omit`
  and keeps them, because there is no card there to replace them.

## Design system

`index.css` holds the design tokens as CSS custom properties on `:root`,
with `[data-theme='dark']` overriding them; `ThemeContext` sets that
attribute on `<html>`. Every component's CSS references the tokens
(`var(--surface-1)`, `var(--accent)`, …), so both themes come from one place
and the theme toggle repaints the whole app at once. **A stylesheet that
hardcodes a colour instead is a bug** — it will not follow the dark theme.

The look: white cards floating on a soft grey canvas, wide corner radii
(9 / 13 / 18px plus a pill), diffuse two-layer shadows rather than hard
outlines, near-black headings over muted grey supporting text, and one
violet accent (`--accent`). Inter for text, Manrope for headings and
figures. The sidebar is a light column separated from the canvas by a
hairline, with the current page marked by a tinted pill.

Three groups of tokens are worth knowing before adding a component:

- **`--*-soft`** (`--accent-soft`, `--good-soft`, `--critical-soft`,
  `--warning-soft`) are the tinted backgrounds for badges, banners and
  hover states. They exist as tokens because they cannot be derived from
  the base colour: a 12% wash reads as a pale tint on white and as a murky
  one on near-black, so the dark theme sets its own.
- **`--critical`** is a *text* colour, lightened in the dark theme to stay
  readable on black. For a solid red fill with white text on it, use
  **`--critical-solid`**, which stays dark in both themes.
- **`--accent-ring`** is the focus halo (`box-shadow: 0 0 0 3px …`), used
  instead of an `outline` so a field's edge does not thicken and shift the
  form when focus moves.

In the dark theme shadows are all but invisible against the canvas, so
depth there comes from surfaces being lighter than the page plus a stronger
hairline; the shadow tokens are reduced to keep overlays from floating
flat.

The Dashboard's "fits one screen, no page scroll" requirement is preserved
structurally: `.page-fixed` (App.css) is a full-height flex column with
`overflow: hidden`, and `.dashboard-grid` is a `flex: 1; min-height: 0`
3x2 grid (2x3 below 1300px).

## Opening the "Other" bar (dashboard charts)

Each chart names its seven largest categories and folds everything else into
one **Other** bar. On this register that bar is the *second largest* on the
Department chart — `Other 201` — and it says nothing about the 64
departments inside it. A card whose Other bar has something behind it now
carries an expander reading **"+64 in Other"**, which opens the full
breakdown.

- **The button carries the count, not the word "Expand".** The number is the
  reason to press it, and its presence is itself the signal: a card with one
  is hiding categories, a card without one is showing everything it has.
  `otherBucket()` in `lib/charts.js` is what decides — it returns the total
  number of categories, how many the Other bar stands for, and their
  combined count.
- **The breakdown opens in a dialog, not in the card.** The grid is sized to
  one screen with no page scroll; a card that grew to hold sixty-four more
  bars would push the rest of it off the bottom. The dialog is as tall as its
  data and scrolls inside itself — at 71 departments that is a 1525px plot in
  an 836px dialog.
- **The expanded chart is horizontal and single-hue**, even for the charts
  whose compact form is a vertical categorical bar (Status, Type). Past a
  handful of categories the question stops being "which of these is which"
  and becomes "how big is each": labels lie along the axis instead of being
  rotated under it, and magnitude is the only thing being encoded, so it
  takes the sequential hue rather than cycling a categorical palette that
  runs out at eight.
- **Its height is `categories × 21px` plus an axis band**, set inline. A
  fixed height would either crop the last categories or leave a nested
  scrollbar that clips the value axis. Every bar is directly labelled, so the
  axis — which sits below the last bar and needs a scroll to reach — is a
  reference rather than something you must read a row against.
- **The chart is built lazily**, when the dialog opens: `breakdown` carries a
  `buildConfig()` function rather than a config, so assembling 71 bars does
  not happen on every filter change for six charts nobody expanded. It is a
  function rather than a getter on purpose — a getter returns a new object on
  every access, and the modal's effect would then destroy and rebuild the
  chart on every render.
- **Nothing is lost between the two views.** The counts in the expanded
  chart sum to the same total as the compact one; there is no `Other` bar in
  the expanded chart, because there is nothing left to fold.

## Routes

| Route         | Screen                | Access        |
|---------------|-----------------------|---------------|
| `/login`      | Sign in               | unauthenticated |
| `/`           | Home / Dashboard      | any signed-in user |
| `/data-entry` | Data Entry            | any signed-in user (bulk upload: admin) |
| `/report`     | Report Section        | any signed-in user (delete: admin) |
| `/inventory`  | Inventory — what is IN STOCK | any signed-in user, read-only |
| `/report/:register/:id` | One record in full, with its trail | any signed-in user |
| `/find`       | Find an Asset         | any signed-in user |
| `/history`    | History               | any signed-in user |
| `/masters`    | Master Data (value lists + Users tab) | admin only |
| `/users`      | The same screen, opened on its Users tab | admin only |

`/users` is kept only so bookmarks and links already handed around keep
resolving — user accounts are a **tab of Master Data**, not a screen of
their own, and the sidebar has one entry for both.

Because these are real URLs (BrowserRouter, not hash routing), anything
serving the built bundle needs two rules: a catch-all rewrite of unknown
paths to `index.html`, and a proxy for `/api` to the backend. `nginx.conf` in
this folder is a worked example of both; an IIS deployment needs the
equivalent URL Rewrite rules.

## Bulk upload of assets (Data Entry)

- **Download Excel template** sits above the drop zone. It builds a workbook
  with two sheets:
  - **Asset Import** — the header row and nothing else; the sheet people
    fill in. 18 columns for assets, 16 for peripherals (which have no
    Assigned User or Email ID). **Site is not among them** — it is derived
    from Location (below).
  - **Field Guide** — the same columns in the same order, **transposed**:
    each one a spreadsheet column under its own heading, with *Required*,
    *Format*, an *Example* value and *What to enter* reading down it. So a
    column is found in the guide by counting across, exactly as on the sheet
    above, rather than by reading down a list of eighteen names.

  There was a third sheet, **Example**, with the same headers and two worked
  rows. It is gone: the Field Guide already shows an example beside each
  column, which answers "what do I type here" without asking anyone to read a
  second sheet and map its cells back column by column — and a workbook
  carrying a sheet of plausible-looking asset rows is a thing people copy
  from.
- **Rejected rows come back as a file you fix and upload again.** When an
  import leaves rows out, a **Download the N rejected row(s)** button appears
  above the reasons. It builds a workbook whose **first sheet is a valid
  upload file** — same headers, same column order as the template — with two
  extra trailing columns: the row number in the upload and why it was not
  imported. So the loop is: download, fix the cells the last column names,
  upload that file. Nothing has to be found again by hand in a spreadsheet
  of hundreds, which is the actual work.

  Those two extra columns are read, not re-imported: `parser.js` matches
  headers against the schema and **ignores what it cannot place**, so they
  ride along harmlessly and don't need deleting first.

  Rows that imported *with a cell cleared* go on a **second** sheet. They are
  not failures and must not come back in — and since the importer reads
  sheet one and no other, putting them anywhere but first is exactly what
  stops a fix-and-reupload from duplicating them. The failed-rows sheet is
  always created first even when empty, for the same reason.

  The download is named after the file the rows came from
  (`<original> - not imported.xlsx`), which is what tells two attempts apart.
- **Sheet 1 never carries a sample row.** `parser.js` reads `SheetNames[0]`
  and no other sheet, so nothing on the Field Guide can be imported however
  long it is left there. A sample row on the data sheet would be one
  forgotten deletion away from entering the register as a real asset —
  silent, plausible-looking wrong data, which is the worst kind. That
  constraint is what makes worked example values safe to ship at all, and
  `EXAMPLE_VALUES` in `assetTemplate.js` says so.
- **The example Description carries a `[SERVICETAG]` token**, because that
  bracketed value is not decoration: the server extracts it into the indexed
  `service_tag` column, which is what duplicate detection matches on. Anyone
  copying the example's shape gets that right by default.
- **The template is generated from `schema.js` COLUMNS**, not from a fixed
  header list, so adding a column there puts it on both sheets and in
  the importer's header matching with no other edit.
  Columns flagged `generated` are the exception — Asset ID, Make,
  Availability and **Site** are worked out by the server, so there is
  nothing to type and they are left out of the template (and rendered
  read-only in the form). A Make, Availability or Site column in an uploaded
  file is ignored: they are always re-derived from Model, Status and
  Location.
  Contents live in `lib/assetTemplate.js`; `lib/exporters.js` wraps them in
  a workbook.
- The header row uses each column's **label**, which `lib/parser.js` also
  accepts as a header spelling — so a downloaded template fills in and
  uploads back with no renaming.

## One place field: Location carries the site

The form used to ask for a **Location** (free text) and a **Site**
(dropdown) — two answers to "where is it" that could disagree, and in the
live register they do: 17 locations sit under more than one site, and codes
like `CCPT`, `CCHD`, `CCRP` don't contain their site name at all, so no
string rule could reconcile them.

There is one field now:

- **Location is the dropdown**, and it offers the values Site used to. That
  is `optionsFrom: 'site'` on the column in `schema.js`;
  `AssetsContext.optionsFor` reads the vocabulary from the named column
  instead of the field's own, and then adds the field's own existing values
  so **no record becomes unpickable** — an asset still sitting at
  `ECOSPACE 4B` keeps that option in its dropdown.
- **Site is `generated`**, like Make and Availability: read-only on the
  form, captioned *"Set from Location when you save"*, dropped from the
  upload template, and ignored if an uploaded file or an API call supplies
  one. `crud.derive_site` copies Location onto it on every write.

Site remains a full column everywhere else — the Report Section shows and
filters it, the dashboard's Site chart and *Sites Covered* tile read it, and
it is exported.

**Existing records are not rewritten.** Their Location and Site stay as
recorded until someone edits one; editing then sets Site from whatever
Location holds at that moment. A row left at `ECOSPACE 4B` will therefore
get Site `ECOSPACE 4B` rather than `ECOSPACE` — which is why the legacy
value stays in the dropdown: it is the moment to pick a real site, not a
value to lose silently.
- The Field Guide's "what to enter" for a dropdown column lists the values
  that column currently accepts, read from the live master lists at
  download time rather than baked in.
- **Importing appends, and skips what's already there.** Rows are added to
  the register; nothing already in it is modified or removed. Duplicate
  checking is on by default ("Skip records already in the register"), so
  re-uploading the same file adds nothing — it matches on the device's
  service tag, falling back to whole-row content for rows without one. See
  `backend/README.md` for why Computer / Asset Name is *not* used for this
  (it isn't unique, and matching on it drops real assets). A matching row
  is always *skipped*, never merged, so the stored asset is never
  overwritten — corrections made in the spreadsheet won't flow back in via
  re-upload.
- **"Clear all data"** in the sidebar is the only thing that removes
  assets, and it also restarts Asset ID numbering at AMB000001, so the
  usual reload workflow is clear-then-upload. It opens `ClearAllModal`,
  which spells out the scope and requires the admin to re-enter their own
  account password — a dialog rather than `window.confirm` because
  `window.prompt` would echo the password in clear text. A wrong password
  is a 401 and deletes nothing.
- **Every skipped row is explained.** After an import the panel lists each
  row that did not go in and why (missing required field, duplicate, a value
  not in the master data), and each row that went in with an unusable
  optional cell cleared. See `backend/README.md` for the server-side rules.
- **An upload carrying values the master data does not have asks first.**
  `UnknownMastersDialog` opens before anything is sent: *"This file uses 1
  department and 1 location that no master list has. 2 of 3 rows carry
  them."* — with the values themselves listed, because "3 departments are
  not in the master data" is unanswerable where `RISK, LEGAK, PROCUREMENT`
  is obviously two real departments and a typo. Two answers: **add them and
  import**, or **skip those rows** and leave the master lists alone.

  Asked beforehand, not reported afterwards, because both outcomes are
  awkward to undo — a registered typo is in everyone's dropdown, and a
  rejected file is four hundred records not loaded.

  `lib/unknownMasters.js` holds the rule (pure, no DOM), and the server
  applies it again to what it actually receives — a browser cannot be
  trusted with a rule that decides what enters the master tables. What the
  browser's copy buys is the question.
- **A value spelled differently from its master row is stored the master's
  way.** Upload `Marketing` against a master row of `MARKETING` and the
  asset records `MARKETING`. The import says so — *"3 value(s) were
  recorded using the master data's spelling"* — because someone who typed
  one thing and finds another in the grid should not have to guess whether
  their file was misread. Without this the dashboard's Department chart drew
  two bars for one department, which is what it does for 71 assets in the
  register today. See `backend/README.md`.

## Master data (dropdown value lists)

The **Asset Type**, **Status**, **Department**, **Company** and **Location**
dropdowns are filled from master tables on the server, not from a list in the
code. `MastersContext` fetches them all once at sign-in (`GET /api/masters`)
and every form reads from it; admins curate them on **Master Data**
(`/masters`), one tab per table. Backend details are in `backend/README.md`
and `docs/API_CONTRACT.md` §7. What's worth knowing on this side:

- **A dropdown offers only values that already exist.** There is
  deliberately no "add a new value here" on the entry form or the edit
  modal. The point of the master tables is that the list of valid values is
  decided once, on Master Data, rather than being grown a typo at a time by
  whoever happens to be entering an asset — which is how a register ends up
  with ACCOUNTS, Accounts and ACCOUNT as three departments and every report
  split three ways. New values are added by an admin on **Master Data**,
  where they can be seen, renamed and retired.

  Removed with it: the inline add-new editor in `AssetForm`, the staged
  "pending" list in `MastersContext`, and `AssetsContext.rememberOption`
  with its `localStorage` list of per-browser values. Nothing is lost —
  a remembered value only ever existed because an asset had been saved
  carrying it, and `optionsFor()` unions in every value present in the
  register anyway. What goes is the divergence: a list that lived in one
  person's browser and nowhere else, so two people entering the same asset
  saw different dropdowns.
- **Two different option lists, deliberately.** `optionsFor(key)` returns
  everything a column could hold (master values ∪ values present in the
  data) and feeds the Report Section's filters and the status colour map,
  so a retired value that assets still carry stays filterable.
  `formOptionsFor(key, currentValue)` returns only what a *new* asset may be
  given — active master rows — plus the current value, so opening the edit
  modal on an asset holding a retired value doesn't show a blank select and
  silently clear the field on save.
- **`SEED_OPTIONS` in `lib/schema.js` is now a fallback**, used only before
  `/api/masters` answers or if it fails. Editing it will not change what the
  app offers once the master lists have loaded.
- **Bulk add** on the Master Data screen takes either an uploaded
  `.xlsx`/`.xls`/`.csv` or a pasted column. Both preview every value
  (new / already exists / repeated / too long) before anything is written,
  and only the new ones are sent. Parsing lives in `lib/masterFile.js`
  (spreadsheet) and `lib/parseMasterPaste.js` (text + the shared
  classification).
  - For a file it detects whether row 1 is a header, picks the likely value
    column and an optional description column, and shows both as dropdowns
    so a wrong guess is one click to fix. Column guessing reuses the
    `headerAliases` from `lib/schema.js` that drive the asset importer.
  - Extraction takes the **distinct** values of the chosen column, so you
    can upload a whole asset register to populate a master list — 695 rows
    of the reference file collapse to its 4 distinct statuses rather than
    695 lines to review.
  - For a paste, a second tab-separated column becomes the description —
    which is exactly what copying two columns out of Excel puts on the
    clipboard.
- **Site and Floor are not mastered.** They keep the original behaviour:
  seed list plus values remembered per-browser in `localStorage`.

## Bulk serial-number scanning (Report Section)

Tick assets in the Report Section and **Scan serial numbers** walks the
selection one at a time (`ScanSerialsModal`): the asset's identity is shown
read-only, the field is focused and waiting, and a scan saves the serial and
brings up the next asset. A shelf goes through without a single click or
keypress.

**A scan commits itself — there is no Save button in the normal flow.** Two
signals end a scan, because readers differ, and whichever arrives first
commits (the other then finds an empty burst and does nothing):

- the reader's **terminator**, Enter or Tab, if it sends one; or
- **`SCAN_QUIET_MS` (90 ms) of silence** after the last character, for
  readers whose suffix is switched off and which simply stop typing.

The only button that ever saves is the one confirming a flagged duplicate.

**Scanning is the only way in — the serial cannot be typed.** The field is
`readOnly` and every keystroke is intercepted, so a value can only arrive
off a barcode reader. A serial number is a fact printed on the hardware;
hand-typing one is how a register acquires a serial belonging to no device,
or to a different one. Someone at the keyboard gets told so rather than
silently ignored, and is offered **Skip**.

What separates a reader from a person is keystroke timing, the same rule
`BarcodeInput` uses (see below). `lib/scanDetect.js`'s `appendToBurst()`
accumulates only characters arriving within `SCAN_MAX_GAP_MS` (35 ms) of
each other — a late character *starts a new burst* rather than extending it,
so hand-typing never builds past one character and never reaches the
`SCAN_MIN_BURST` (3) needed to count. Auto-repeat from a held-down key fires
at roughly scanner speed on Windows, so `event.repeat` is ignored too.

What makes it fast rather than merely possible:

- **It PATCHes the asset directly**, instead of going through
  `AssetsContext.updateAsset`, which refetches the whole register after
  every write. Measured against the live 631-asset register: **25 ms per
  scan as built, vs 527 ms if each save refreshed — 21× slower**, or 1.2 s
  versus 26 s across 50 assets. The register is refreshed once, when the
  queue finishes.
- **The input re-focuses itself** the moment a save resolves, and refuses to
  give up focus while the queue is open, so the next barcode always lands
  in a ready field even if a button was clicked. It is `readOnly` rather
  than `disabled` during a save, because a disabled field loses focus and
  stops receiving the reader's keystrokes.
- **A serial already on another asset is refused**, with no override — see
  the next section. Scan the right barcode, or Skip.

Note the terminator handling is the opposite of `BarcodeInput` elsewhere,
which *swallows* Enter so a scan can't submit the 18-field entry form — here
committing on it is the whole point.

## Banners (the confirmation strip)

Every page's `{ text, kind }` banner renders through `Banner.jsx`, which
clears it rather than leaving it up until the page is navigated away from.
A stale confirmation is worse than none: "restored as IN STOCK" still
sitting there while you edit something else stops being obvious about
whether it describes what you just did or what you did five minutes ago.

- **Success and info go away** after 6 seconds. They confirm something that
  already happened and is visible in the register anyway.
- **Errors stay** until dismissed, along with anything marked `sticky`. An
  error is the one kind of message you may still need to act on, and one
  that vanishes before it is read is worse than one that lingers.
  `sticky: true` is for a banner that explains what is *on screen* rather
  than reporting a finished action — Data Entry's "Cloned from …", which
  describes the form you are looking at.
- **Hovering (or focusing) pauses the clock**, so the message you lean in to
  read isn't the one that disappears as you read it.
- Everything gets a close button, and `role="status"` / `role="alert"` so
  the strip is announced — it is the only feedback these actions give.

Two implementation notes: the dismiss callback is held in a ref because
pages pass an inline arrow, which as a dependency would restart the
countdown every render and never fire; and the timer is keyed on the banner
*object* rather than its text, since React state keeps one reference across
re-renders, so repeating an action that produces word-for-word the same
message still gets a full fresh countdown instead of inheriting a
part-spent one.

## History

There are two ways in, because there are two different questions.

### The History list (`/history`)

**A list of assets, not a feed of events** — built on the same `.data-table`
as the Report Section, so the two read as the same kind of thing. One row
per asset that has been changed, most recently first, showing how many
changes it has and a one-line chip for the latest one. The whole row is the
link; the full trail opens on its own page.

A flat feed was the first shape and the wrong one: a register of any age
produces thousands of individual changes, the same asset repeats down the
page, and the question people actually arrive with ("what happened to this
laptop?") gets harder rather than easier. Moving the detail to its own route
is what lets this page stay scannable.

The filters run over **events**, not assets, so "Deleted" lists the assets
that have ever been deleted — and each row then summarises the delete it was
found by rather than whatever happened to it afterwards.

Open to both roles, like the per-asset trail.

### The History detail page (`/history/:assetPk`)

One asset's full trail, grouped by day with a sticky day heading. It is
deliberately the opposite of the list: nothing else is competing for the
space, so it can afford to be readable rather than compact. The header
carries the asset's current identity and a **Show in Report Section** button.

Both this page and the compact panel draw their entries with the shared
`<HistoryGroup>`, so the two cannot drift apart — see *One entry per thing
that happened* below.

**Filtered and paged by the SERVER, unlike every other list in this app.**
The register has a known size, so the Report Section pulls all of it and
filters in the browser. This table grows with every edit anyone makes and
has no ceiling, so the same approach would get slower every week the app is
used. Consequences visible in the code:

- The search box **debounces** (300 ms) and re-fetches rather than narrowing
  an array already in memory, so typing a twelve-character asset tag is one
  request, not twelve.
- Every request carries a **ticket number**; a response whose number is
  stale is discarded. Without that, a slow early request can land after a
  fast later one and show results for a filter the person has already moved
  on from.
- The list is **dimmed, not blanked**, while re-fetching, so a filter change
  feels like the list narrowing rather than the page reloading.
- The filter dropdown contents (who appears in the history, which actions
  exist) come back **with the results**, so the page needs no second
  request to populate them.

**Show in Report Section** hands the asset over as a **search term** rather
than a selection — that box already does this job, and it stays visible and
editable on arrival, so it is obvious why the grid is showing one row and
how to get back to all of them. The handoff is consumed once
(`navigate(..., { replace: true, state: null })`), so browser back/forward
can't re-apply it after the person has cleared it.

A row whose recorded Asset ID differs from the asset's current one says
**"was AMB000123"**: Asset IDs are positional and shift when an earlier
asset is deleted, so an old entry legitimately names a different one.

**History starts when this was added** — a register untouched since then
shows the empty state, which says so rather than implying nothing ever
happened.

### The per-asset panel (edit modal)

`AssetHistory` renders the same trail, compactly, in a collapsed **History**
section at the bottom of the edit modal — for when you already have the
asset open and don't want to leave it.

- **Loaded on demand**, when the section is opened — a trail is read
  occasionally and can be long; fetching one with every Edit click would
  slow the common case for a panel most people never open. It is not held
  in `AssetsContext` either, so it can't go stale.
- **Keyed on the asset** (`key={asset.id}`), so opening a different one
  remounts rather than briefly showing the previous asset's trail. The
  in-flight request is cancelled on unmount for the same reason.
- Field names come from `schema.js`, so the trail reads "Date of Purchase
  (DOP)" rather than `dop`, follows a label change, and says "Peripheral
  Type" on a peripheral's trail.
- An event recorded under a **different Asset ID** says so. Asset IDs are
  positional and shift when an earlier asset is deleted, so an old entry can
  legitimately name another one.

### One entry per thing that happened (`lib/historyGroups.js`)

The audit table records **one row per changed field** — the right shape for
an audit table, and the wrong one for a timeline. One click that moved a
machine to another building produced four separate entries, each a third of
the panel tall, with nothing saying they were the same act. A real trail read
as seven entries for what were really three decisions.

So the trail is **grouped at the point of display**: one entry per thing that
happened, expandable to the individual fields. Nothing is hidden and nothing
is merged away — every recorded row is still there, one level down, and the
header quotes both numbers ("6 entries from 9 recorded changes") so it is
never mistaken for history having gone missing.

**The kinds come from the schema's own field groups** (`GROUPS` in
`schema.js`), so a column added there lands in the right kind here with no
edit, and the two can never disagree about what a field is:

| Kind | What it is | Where it comes from |
|---|---|---|
| **Moved** | site, floor, location, sub-location | the `location` group |
| **Reassigned** | assigned user, email, department | the `assignment` group |
| **Status changed** | status alone | an override — see below |
| **Peripherals** / **Moved to another asset** | `linkedPeripherals` / `linkedAsset` | an override: these are not schema columns |
| **Updated** | everything else | the remaining groups, folded together |

Two overrides, and only two. **Status** belongs to the `identification`
group, but it is the field that decides whether a machine is in use, in stock
or scrapped; buried inside "Updated" it would be the one change people miss.
The **link fields** are not schema columns at all, so they have no group to
be read from. The remaining groups fold into one "Updated" deliberately:
splitting the rest four ways would rebuild the wall of entries this exists to
remove.

Details that matter:

- **Two rows join an entry** when they are the same kind, by the same person,
  within `GROUP_WINDOW_MS` — and only for `updated`, the one action that
  writes several rows for a single click. A delete and a restore in the same
  second stay two entries.
- **The window is 1 second**, which is sized by the wrong answers rather than
  the right one. Within a save the spread is **0.0 ms** (measured on the real
  register — the rows are written in one flush), so any window works; a
  second is already far longer than the round trip between two saves made
  through the form. It was two seconds first, and a test that saved twice in
  quick succession duly showed one entry holding changes made at different
  times.
- **Re-editing the same field is never merged**, whatever the timing:
  ECOSPACE → ECOHUB → ECOSPACE is not one move.
- **Entries within one save are ordered by consequence** — status, then
  where it is, then who has it — not by whichever field the server's diff
  loop reached first, which is what put Company above Site in the real data.
- **Fields within an entry follow the form's order**, so a move reads
  Location, Site, Floor as the form shows them rather than in the order the
  diff happened to write them.
- **A lone change needs no expander** and renders as one line — and neither
  do moves or reassignments, which compose (below).
- **Expand all / Collapse all** on the detail page, because clicking through
  fifteen expanders to read a year of changes is worse than the wall of
  entries this replaced.

Grouping happens at display time rather than via a save-correlation column on
`asset_events`, because such a column would be NULL for every row already
written — and this register's history predates it. A rule that reads the
existing rows works on the whole trail, past and future, and costs no
migration.

### Composed entries: one fact written as one thing

Grouping a move still left three lines that the reader had to reassemble into
the two places that are the actual fact. Two kinds are therefore **composed**
into a single before/after pair:

```
Location  ECOSPACE 4B → ECOHUB 4A
Site      ECOSPACE    → ECOHUB       →   ECOSPACE 4B (3rd Floor) → ECOHUB 4A (Grd Floor)
Floor     3rd         → Grd

Assigned User  SERVICE-ECOSPACE → ABHIRUP DUTTA
Email ID       it@… → abhirup.dutta@…
                                     →   SERVICE-ECOSPACE (it@…) → ABHIRUP DUTTA (abhirup.dutta@…)
```

One line each, and **no expander** — there is nothing left behind it, because
the composed line carries every field the entry holds on both sides. The
check is on the *fields*, not on the kind, so a location or assignment field
added to `schema.js` later that the composition knows nothing about brings
the expander back rather than going quietly missing. Everything else
("Updated") has no composed form and keeps its field list.

`COMPOSED` in `historyGroups.js` is the whole table: a kind, the fields it
draws on, and the function that words them.

Built **only from the fields the entry holds**. The trail records what
changed and nothing else, so a move that left the floor alone has no floor to
show — and taking it from the asset's *current* floor would put a later value
into an older entry, which is the one thing an audit trail must never do.
Every rule below therefore has to read correctly with any subset of its
fields missing.

The formatting rules come from how this register is actually written, read
out of the live data rather than assumed:

- **The site is dropped when the location already names it.** 554 of the 629
  locations begin with their site (`ECOSPACE 4B`), so including both would
  read "ECOSPACE · ECOSPACE 4B". The other 75 keep it: `PATNA · Block C`.
- **Floors are bare** in this data (`3rd`, `6th`, `Grd`), so the word is
  supplied — but only to values that are ordinals. `ROOFTOP` would otherwise
  become "ROOFTOP Floor", and `URVISHA` and `CCSG` are in the floor column
  too (site names typed into the wrong field), so anything unrecognised is
  shown as written.
- **`N/A` is no floor at all**, not a floor called N/A — 204 of 629 assets
  carry it. A move that clears the floor therefore reads `ECOSPACE 4B (3rd
  Floor) → ECOSPACE 4B`, which says what happened without inventing a word
  for it.
- A **sub-location** joins the place when there is one (`ECOSPACE 4B ·
  Workstation 22`), and an empty side renders as the same italic *empty* as
  any other blank value rather than as a gap.
- **Neither half of a person can be assumed.** 4 of the 629 assets have an
  assigned user and no email, so there are no empty brackets; a save that
  corrected only the address has an email and no name, so there are no
  orphaned ones — it reads `old@… → new@…`. The longest real pair is 79
  characters (`DEBAPRIYA PATHAK [IN CUSTODY OF ABHIJIT KUNDU]`), which wraps
  rather than being cut.
- **A department changed alongside the person rides on the same line**
  (`ABHIRUP DUTTA (abhirup.dutta@…) · IT`), which is what lets the entry
  stay expander-free; a reassignment that left it alone reads as just the
  person, which is the common case.

## Row actions, and where deleting lives (Report Section)

A row offers **Edit**, **Clone** and **History** — and **Restore** when that
row is deleted. Deleting is not among them: it is a **selection** action, in
the bar above the grid.

**Why deleting moved off the row.** A trash icon one pixel from Edit, on
every one of six hundred rows, is a slip away from scrapping the wrong
machine. Ticking what you mean first is a deliberate act, and the selection
already existed for bulk edit, QR codes and the scan queue. The button is
**last in that bar**, apart from the actions beside it, so it is never the
one your hand was already moving towards — and it is admin-only in the UI
*and* on the server (`POST /api/assets/bulk-delete`, `@require_admin`); the
frontend hiding a button is never the check.

It asks first, naming what it is about to scrap — the record when there is
one, the count when there are several — and says plainly that nothing is
erased. **`window.confirm`, not a custom dialog**, deliberately: this is the
one destructive action reachable from the grid, and the browser's own dialog
cannot be dismissed by a stray click on the backdrop.

**One request, not one DELETE per record.** `deleteAssets()` posts the whole
selection, exactly as bulk edit does — deleting fifty one at a time would be
fifty round trips *and* fifty refetches of the whole register, because
`deleteAsset` refreshes after each one. The response reports `deleted`,
`alreadyDeleted` and `notFound` so the banner adds up, and each record still
gets its own history entry.

**History is open to every profile**, like the trail itself; **Restore is
superadmin only** — an admin scraps, but does not bring a scrapped record
back, and the scrap confirmation says so rather than promising an undo the
admin cannot perform.

### Restoring

**Restore stays on the row**, because it is not a bulk action: it applies
only to a deleted record, and it has to ask which status to bring that one
back as. It brings the asset back as the status it held when it was deleted;
an asset deleted before the server started recording that has nothing to come
back as, so the UI prompts rather than picking one.

## Bulk edit (Report Section)

`BulkEditModal`, reached from the selection bar that already existed for the
scan queue. Whatever is filled in is applied to every selected asset.

**A blank box means "leave it alone."** There is no way to clear a field
across a selection, deliberately — emptying Department on forty assets by
tabbing past a box is far easier to do than to notice, and the single-asset
editor can still clear one field on one asset. The server drops blanks for
the same reason, so this isn't only a UI convention.

Only the fields that genuinely change together are offered — status, type,
department, company, user, email, the four location fields, warranty end and
comments. **Srl No. is absent**: a serial identifies one device, and the
scan queue exists for that job.

## Warranty / AMC and fleet age

`lib/warranty.js` answers two separate questions, deliberately, because the
register can answer one of them today and not the other:

- **`warrantyState()`** reads the `warrantyEnd` column — authoritative, and
  blank on most assets until someone fills it in. An asset with no date is
  `unknown`, **never "in warranty"**: guessing a warranty length from the
  purchase date would invent a contract term. States are `expired`, `soon`
  (within `EXPIRING_SOON_DAYS`, 90), `covered`, `unknown`, with the end date
  treated as inclusive — cover runs to the end of that day, as a warranty
  certificate reads.
- **`ageYears()`** reads `dop`, which the register already has for the great
  majority of assets, so "how much of the fleet is over five years old" is
  answerable right now with no new data entry.

Two implementation notes that are easy to get wrong:

- Dates are parsed from their **parts into UTC**, not through
  `new Date(string)`, which would be read in the viewer's timezone — an
  asset expiring on the 1st would read as expired on the 31st for anyone
  west of UTC. The parser also rejects impossible dates (`2026-02-31`),
  which `Date` silently rolls forward into March.
- Age is **calendar arithmetic**, not elapsed days over an average year.
  Dividing by 365.2425 reports a machine bought exactly five years ago as
  four, because five real years containing a leap day are 1826 days and five
  average ones are 1826.2 — wrong on precisely the anniversary, which is the
  boundary the count turns on.

On the Dashboard this is one **Out of Warranty** tile (with the
expiring-soon count beneath it) plus the fleet-age figure on the Total
Assets tile. A register with no warranty dates shows "—" and "No warranty
dates recorded" rather than "0", which would read as a fleet with no
warranty problems.

The KPI row derives its column count from the number of tiles
(`grid-auto-flow: column`), so adding one no longer means editing a number
in `KpiRow.css` to match.

**The share-of-fleet footers carry three decimals** (`98.728% of fleet`),
which looks like false precision until you see what whole numbers did to
this register: In Stock 2 and Later Added 1 both read **"0% of fleet"** under
a tile whose own number was not zero. That is not a small share, it is a
contradiction, and it appears the moment a bucket holds fewer than about 1
in 200 — which for a fleet of 629 is almost any bucket that is not In Use.
Three decimals carry the smallest thing the register can hold, one asset in
629, as `0.159%`. The cost is that In Use reads `98.728%` rather than `99%`,
which is the right way round: the big number is legible either way, and it
was the small ones being rounded into nonsense. The longer string was
checked against `KpiRow.css`'s one-row rule — `100.000% of fleet`, the widest
it can ever be, still fits a tile on one line.

The status tiles are **not a partition** and are not expected to sum to
100% — see the note in `lib/statusClass.js`.

## Find an Asset (`/find`)

The register read the other way round: from the device in your hand to its
record. Built for someone standing at a machine, so there is one oversized
box, focused on arrival, and a full read-only record underneath it.

Three ways in, all landing on `GET /api/assets/lookup`:

- **A scanned QR label** from this app. A 2D reader in wedge mode types the
  whole multi-line payload — or stops at the first newline. Both work; the
  server reduces either to the Asset ID.
- **A scanned or typed serial number**, the ordinary case. Service tag and
  computer name work too.
- **This device's own camera** — see *Scanning with the camera* below.

Details that matter:

- **The box is a `<textarea>`, not an `<input>`.** An input silently drops
  everything after the first newline, so a reader sending a whole QR payload
  would look broken for no visible reason.
- **Searching is automatic and debounced** (`SCAN_QUIET_MS`, min 350 ms).
  Someone holding a laptop one-handed should not have to find a button, and
  a wedge scan arrives as a burst that settles well inside that. Enter
  searches immediately and is swallowed, so a reader's terminator cannot add
  a newline to what is really one value.
- **Stale responses are discarded** by request ticket — otherwise a slow
  early lookup can land after a fast later one and show the *previous*
  device's record, which on this screen is the worst possible failure.
- **The result says what matched**, not just what was found. "AMB000042,
  matched on its serial number" is a different thing to be told than
  "AMB000042" when the point of scanning was to confirm you have the right
  device.
- **Several matches are offered as a list**, never resolved silently —
  computer names are not unique in this data.
- `AssetDetail` renders every schema field from `GROUPS`/`COLUMNS`, so a
  column added to `schema.js` appears here too. **Empty fields show a dash
  rather than disappearing**: on a lookup screen the absence of a value is
  information, and a field that quietly vanishes cannot be acted on.

## Scanning with the camera (`components/QrScanner.jsx`)

**Scan with camera** on Find an Asset opens the device's own camera and reads
a QR label from it — no handheld reader, no app to install. It decodes
continuously and stops at the first code it reads, because there is nothing
to aim: the interaction that works is waving the camera at the sticker. The
decoded text goes **into the search box**, not straight to the server, so a
misread is visible and editable and takes the same path a wedge scan does.

### Two decoders, and why there have to be two

| | Where it works | Cost |
|---|---|---|
| `BarcodeDetector` | the browser's own — Android, ChromeOS, macOS | free, hardware-backed |
| **jsQR**, vendored | everywhere else | a 130 KB chunk, loaded on demand |

The native one is **not available on Windows**, which is what the desks here
run — measured, not assumed: Chrome 153 on Windows 11 reports
`'BarcodeDetector' in window === false`. A camera button gated on it is a
button nobody in this office ever sees, which is exactly how this started
out. `lib/qrDecode.js` hides the choice behind one `createFrameDecoder()`,
and the vendored decoder is behind a dynamic `import()` so only someone who
actually opens the camera downloads it.

Frames are scaled to 640 px on the long edge before decoding (a QR needs
only a few pixels per module, and decoding 1080p costs several times as much
for nothing) and read ten times a second, not per animation frame — a hand
holding a label steady holds it steady for far longer than 100 ms, and
sixty decodes a second would pin a core and flatten a phone battery.

### The camera needs https, and this is the part that will bite

Browsers hand out camera access only in a **secure context**: `https://`, or
`localhost`. Open this app from a phone at `http://192.168.x.x:8080` and
`navigator.mediaDevices` is simply **not there** — no prompt, no error, and
nothing any amount of frontend code can do about it. Verified on this
network, not assumed:

```
http://192.168.201.232:4180/  ->  isSecureContext: false
                                  navigator.mediaDevices: undefined
```

So **the button is shown even where the camera cannot be opened**, and says
why when pressed, naming the protocol the page was actually served over. It
used to be hidden, which made the commonest case look like a feature that
did not exist rather than a deployment that needs a certificate. Serving the
app over https is the fix; the handheld reader needs no camera and is
unaffected either way.

`cameraAvailability()` distinguishes *insecure context* from *browser
without the API*, and `cameraErrorMessage()` turns `getUserMedia`'s
`DOMException` names into something actionable — "close Teams, Zoom or any
other app holding the camera" rather than `NotReadableError`.

### Vendored, not installed

`src/vendor/jsqr/` holds jsQR 1.4.0 as a file rather than a `package.json`
entry because **this network cannot reach `registry.npmjs.org`** — it times
out, while the CDNs and PyPI are fine — so `npm install jsqr` does not work
here and a dependency nobody can install is worse than a file everybody can
read. It is **Apache-2.0** (jsQR descends from ZXing), the licence sits
beside it, and the banner at the top of the file records the upstream URL,
its sha256 and the three mechanical changes made to turn the UMD bundle into
an ES module — everything needed to repeat the exercise on the next version.
`src/vendor/**` is excluded from lint in `.oxlintrc.json`; third-party code
is not ours to restyle.

## QR labels (Report Section)

Tick assets and **QR codes** opens `QrCodesModal`, which shows the labels
**one at a time** with Previous / Next (arrow keys work too — with fifty
labels to check, reaching for the mouse fifty times is the whole cost of the
task), and a **Print all** that lays every selected label out as a sheet.

- **Nothing is encoded in the browser.** The codes come from
  `POST /api/assets/qr` as SVG data URIs, used as `<img src>` — so no
  server-supplied markup is injected into the page, and the code is built
  from the authoritative record rather than this page's copy. Why the code
  carries data rather than a link, and how the field list was chosen, is in
  backend/README.md.
- **The printed label is the code plus two lines of text** — the register ID
  (`AMB000001` / `PRP000001`) and the device's serial number, under the code
  — in a **23 × 29.5 mm** sticker. They are there so a label is identifiable
  by eye: the label was briefly the code and nothing else, which left a
  scratched or smudged sticker saying nothing at all, and a shelf of
  identical black squares is no help when you are looking for one machine.

  | | |
  |---|---|
  | 1.5 mm | margin / quiet zone |
  | 20.0 mm | code |
  | 1.2 mm | gap |
  | 2.7 mm | ID line (2.3 mm type) |
  | 2.4 mm | serial line (2.0 mm type) |
  | 1.5 mm | margin |
  | **29.5 mm** | |

  The text sits **below the quiet zone**, so it cannot interfere with a
  scan, and the code itself is untouched. The cost is sheet density:
  **72 labels an A4 sheet**, against 96 for a bare code and 24 at the
  original 40 mm size.

  Both lines are **monospace and never wrap**. These are read off a sticker
  and typed back in, which is what keeps 0/O and 1/l apart; and a label that
  changed height would stop the sheet being a grid, so an over-long serial
  is ellipsised. 20 mm of usable width is about sixteen characters at
  2.0 mm — enough for every serial in this register. A peripheral with no
  serial yet prints a blank second line rather than a shorter label.
- **The dialog captions the preview as well**, with the machine name, model
  and service tag that are *not* printed — deliberately outside `.qr-label`.
  Without it, stepping through fifty codes would be stepping through fifty
  near-identical squares.
- **Labels are always dark-on-light, in both themes.** A QR inverted by dark
  mode does not scan, and this is a picture of something that will be
  printed on white paper.
- **Print uses the browser's own dialog.** The full sheet is in the DOM the
  whole time, hidden on screen and revealed by the print stylesheet, rather
  than opening a second window a pop-up blocker can swallow.
- **The printed geometry was verified by decoding and by measurement, not
  chosen.** 20 mm code with a 1.5 mm margin — both the cutting guide and the
  quiet zone a scanner needs — eight across A4 inside 8 mm page margins and
  nine rows down, with `break-inside: avoid` so a label never straddles a
  page break. The laid-out boxes were read back under print media to confirm
  the millimetres are what the CSS claims, that every label comes out the
  same height, and that 8 × 9 really fits.

  At this size the register's densest label is **0.351 mm per module** —
  still under the 0.5 mm rule of thumb usually quoted for handheld imagers,
  but not by much. That number was tested rather than trusted: every one of
  the 629 labels was rasterised onto the dot grid a 300 dpi printer actually
  lays down at 20 mm, each dot taking the value of whichever module its
  centre falls in as a bi-level device does, and decoded — **629/629 read
  back exactly**, and the densest still read at 15 mm, at 203 dpi, and with
  the quiet zone cut to 1 mm. That is **4.1 printer dots per module**.

  **It used to be 0.290 mm and 3.4 dots** — dropping the assigned user and
  the placement fields from the payload (see `app/qrcodes.py`) took the worst
  case from version 13 to version 10, so every sticker got coarser and this
  margin got better rather than worse.

  What that harness cannot see: the raster is perfectly aligned and
  noise-free, which makes it unrealistically kind at small sizes — a 6 mm
  sticker "decodes" in it, at 1.2 dots per module, which no real printer or
  phone would manage. It proves the encoding survives the printer's grid, not
  that a given size scans in the field. Ink spread, lamination glare and a
  phone that cannot focus close enough all eat into the margin and none can
  be simulated, so **test-print a sheet and scan it before committing a
  batch**.
- **The lever, either way, is error correction** in `app/qrcodes.py`.
  Measured over the same 629 labels:

  | `ERROR_LEVEL` | recovers | worst case | at 20 mm |
  |---|---|---|---|
  | `"l"` | ~7% | v9, 53×53 | 0.377 mm |
  | `"m"` *(current)* | ~15% | v10, 57×57 | 0.351 mm |
  | `"q"` | ~25% | v13, 69×69 | 0.290 mm |
  | `"h"` | ~30% | v15, 77×77 | 0.260 mm |

  Worth knowing which way to move: **`"q"` now costs exactly the density the
  old payload already printed at** (0.290 mm), so the shorter payload could
  be spent on *more* damage tolerance instead of a coarser code — a
  reasonable trade for stickers that get handled, scuffed and part-peeled.
  `"l"` goes the other way if a printer needs more margin. The field list is
  the lever if the sticker has to be smaller still.
- **Scannable by anything.** The code holds plain text, so any phone camera
  shows the whole record with no app, no login and no network. The flip side
  is that anyone who can see the sticker can read it; backend/README.md
  spells out what that exposes.
- The selection is passed **in grid order**, so the printed sheet follows
  the list on screen.

## Serial numbers are unique: one serial, one device

A serial number is stamped on a single piece of hardware, so the same one on
two assets means one of them is wrong. The register may not hold a serial
twice, and there is **no override** — "save it anyway" is how a register
ends up with two rows for one laptop and no row for another.

`lib/serials.js` holds the client's half: `serialKey()` normalizes a serial
the way the server does (`lower(trim(srl))`, so `  h6rp9g3 ` and `H6RP9G3`
are the same device), `findSerialOwner()` finds who has it, and
`serialTakenMessage()` writes the refusal in terms the operator can act on —
an Asset ID and a machine name to go and look at, not "duplicate".

Where it bites:

- **Data Entry and the edit modal** — `validateAsset(values, { register,
  selfId })` in `lib/schema.js` puts the message under the Srl No. field.
  `selfId` is what stops an asset being read as clashing with the serial it
  already has.
- **The scan queue** — a duplicate barcode is refused and the banner names
  the holder. The modal also tracks serials saved during the current queue,
  because `assets` is deliberately not refreshed between scans; without that
  the same barcode could go onto two assets in one run.

**A blank serial never collides** — assets routinely arrive from a bulk
upload without one, and any number may be waiting.

All of this is a courtesy, not the constraint: the server refuses a reused
serial with `422` whatever the browser does, and a UNIQUE index in the
database refuses it whatever the server does. See backend/README.md's
"Serial numbers are unique" for the enforcement that actually counts.

Selection lives on the ids, so it survives sorting, filtering and paging.
The queue follows the grid's current sort order, so sorting by Site or Srl
first means scanning proceeds in roughly shelf order.

## Barcode scanning (Srl No.)

The **Srl No.** field on Data Entry (and in the edit modal) accepts input
from a handheld USB/Bluetooth barcode reader as well as the keyboard. Click
**Scan** next to the field, then scan — the field is focused, highlighted
while it waits, and shows a brief "Scanned" confirmation. You can also just
click into the field and scan without arming it first.

Almost all barcode readers are "keyboard wedge" devices: they type the
barcode's characters very fast and then send a terminator, Enter by default.
So the work isn't capturing the scan — the field only needs focus — it's
stopping that trailing Enter from submitting an 18-field form from its first
field. `lib/scanDetect.js` decides that from keystroke timing: characters
arriving ≤35ms apart are machine-fed, and after 3 such characters (or any
time **Scan** was clicked) the Enter is swallowed instead of submitting.
Typing a serial by hand and pressing Enter still submits the form exactly as
before.

Two notes:

- **Tab-terminated readers** are supported too; Tab is allowed through, so
  focus advances to the next field as you'd expect.
- **Making another field scannable** takes one word: add `scannable: true`
  to that column in `lib/schema.js` and `AssetForm` renders the
  barcode-aware input for it. Nothing else needs to change.

This is for hardware readers. For the device camera see *Scanning with the
camera* above — it is wired up on Find an Asset, and `QrScanner` is a
standalone component so the Link Peripherals field can take it next.

## Bundle notes

SheetJS (~424 kB) is only needed for Excel import/export, so `lib/parser.js`
and `lib/exporters.js` load it with a dynamic `import()`. It lands in its own
chunk and is fetched the first time someone imports or exports a file,
keeping it out of the initial load.

The vendored jsQR (~130 kB, 47 kB gzipped) is split the same way by
`lib/qrDecode.js`, and is fetched only when someone opens the camera on a
browser without `BarcodeDetector`. The initial bundle is unchanged by it.

## Known limitations

- No automated frontend test suite; verification so far is the production
  build, oxlint, and HTTP-level checks of the dev server and the API contract.
- No browser was available in the environment this was built in, so the
  rendered layout, dark mode and the no-scroll dashboard have been checked
  structurally and by code review, not visually.

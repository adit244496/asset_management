# IT Asset Engine

A production system for AmbujaNeotia IT's asset register, replacing the
single-page localStorage prototype in [`asset-management-console/`](asset-management-console/)
with a real client/server application: a **PostgreSQL-backed Python (Flask)
API** and a **React + Vite frontend**, with required login and two roles
(`admin`, `user`).

Both halves are structured to match `E:\project_catalog\catalog1` — one of
the user's other projects — so this repo is maintained the same way as the
rest of their portfolio: Flask + Blueprints + `app/api/` + `app/core/` on the
backend, React + Vite + `src/pages` + `src/components` + plain CSS per
component on the frontend. The backend started as FastAPI and the frontend as
vanilla JS + Tailwind; both were restructured afterwards. The wire contract
(every route, JSON shape and role rule in `docs/API_CONTRACT.md`) never
changed through either restructuring, and neither did the feature set. The
visual design language did: it was carried over unchanged through both
restructurings, then deliberately revamped — white cards on a soft grey
canvas, wide radii, soft shadows, a light sidebar and a violet accent. See
`frontend/README.md` § Design system.

```
docs/API_CONTRACT.md         Source of truth: data model, every API endpoint,
                              role permissions, directory layout for both sides.
backend/                     Flask + PostgreSQL + JWT auth. See backend/README.md.
frontend/                    React + Vite SPA. See frontend/README.md.
Asset.xlsx                    The source register the live data was imported
                              from. Not read by the app at runtime — kept as
                              the reference export the importer was built and
                              tested against.
start-dev.ps1                 Starts backend + frontend for local dev and
                              health-checks both before reporting ready.
stop-dev.ps1                  Stops just this repo's dev servers.
```

## How the frontend reaches the API

The browser only ever talks to one origin. The app calls the relative path
`/api`, and that is forwarded to the Flask backend by Vite's dev-server proxy
in development (`frontend/vite.config.js`) and by whatever serves the built
bundle in production — IIS, or nginx using `frontend/nginx.conf`.

That is worth knowing because of what it rules out: no backend host or port is
compiled into the JS bundle, so moving the backend never means rebuilding the
frontend, and CORS is not involved at all in the normal setup — there are no
preflights, and a stale `CORS_ORIGINS` list on the backend cannot break the
app. In development exactly one place knows the backend's port: the proxy
target in `vite.config.js`, overridable with `API_PROXY_TARGET` (and
`start-dev.ps1 -BackendPort <n>` sets it for you).

## What changed from the prototype, and why

The prototype ([`asset-management-console/README.md`](asset-management-console/README.md))
was explicit that it was a client-only demo: all data lived in one browser's
`localStorage`, nothing was shared between users, and there was no login. This
system replaces that with:

- A real **PostgreSQL** database, so the register is shared across every user
  and machine, instead of one browser's `localStorage`.
- A **Flask** backend (Blueprints + decorator-based auth, structured to match
  the user's other projects — see "Backend structure" below) that owns all
  reads/writes, enforces validation, and is the single source of truth — the
  frontend is a client of it, not a database in a browser tab.
- **Login with two roles**, `admin` and `user` — see the permission table in
  [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md#2-roles--permissions). This
  was a judgment call since you only said "two roles, user and admin" without
  specifying what each could do: `user` can view everything and create/edit
  assets; `admin` can additionally delete assets, bulk-import, clear all
  data, and manage other users. It's enforced in one place on each side, so
  it's easy to loosen or tighten later.
- The same three screens (Dashboard, Data Entry, Report Section) **plus a
  new admin-only User Management screen**, rebuilt as a **React + Vite** SPA
  but with the same information architecture, schema-driven forms, and
  filterable report grid as the prototype.
- A **light/dark theme toggle** in the sidebar: it follows the OS setting by
  default, and an explicit choice is remembered across sessions.

Everything else — the 18-column asset schema, the Excel/CSV bulk-import
behavior, the dashboard's KPI tiles and 6-chart no-scroll layout, the
per-column filters and CSV/Excel export in the Report Section — was ported
over deliberately unchanged in behavior.

## Frontend structure

`frontend/` follows `E:\project_catalog\catalog1\frontend`'s conventions:
React + Vite, `src/pages` + `src/components` with a matching plain-CSS file
per component, an axios instance in `src/api.js` with JWT and 401
interceptors, `lucide-react` icons, and oxlint. Cross-cutting state lives in
three contexts (`AuthContext`, `AssetsContext`, `ThemeContext`) and the
schema/parsing/chart/export logic in `src/lib/`.

The design language was carried over from the previous build rather than
restyled: the palette lives as CSS custom properties on `:root` in
`src/index.css`, with `[data-theme='dark']` overriding them, so both themes
come from one place. See `frontend/README.md` for the full layout.

## Backend structure

`backend/` follows the same `app/api/` + `app/core/` + top-level
`crud.py`/`database.py`/`models.py`/`main.py` layout, Flask/Blueprint style,
and decorator-based auth (`@token_required`, `@role_required`) as
`E:\project_catalog\catalog1\backend` — kept consistent with how the user
maintains their other IT projects. It started life as a FastAPI backend and
was restructured to this shape afterward; `docs/API_CONTRACT.md` (the wire
API — routes, JSON shapes, role rules) did not change in that restructuring,
only the implementation. One deliberate difference from FastAPI's
auto-migrating dev loop: this backend has no migration tool (matching
catalog1), creating its schema via `Base.metadata.create_all()` at startup —
see `backend/README.md` "Schema management" for the trade-off that implies.

## Who did what: the Activity Log

`/activity`, **superadmin only**. Every action by every profile, newest first
— sign-ins (including failed ones), account and profile changes, password
resets, master-data edits, imports, bulk edits, and every field change to the
registers. Exports to CSV or Excel from one button, and to a PDF report.

Two things about it are deliberate and worth knowing before changing it:

- **Entries are written by an `after_request` hook, not by each route.** A
  route that forgets to log itself is the normal way an audit trail goes
  quietly incomplete, so nothing is trusted to remember. A route added next
  year is recorded without its author doing anything.
- **It is append-only with no edit or delete route, including for a
  superadmin.** A record its subject can change is not evidence of anything.

The feed is a union of `activity_log` (actions) and the existing
`asset_events` (register changes) — complete on screen, stored once. See
`docs/API_CONTRACT.md` §7a.

## New entries wait in Verification

`/verification`, **superadmin, admin and verifier** (a verifier may Verify,
Edit and Send back, but not Discard). Everything added from Data Entry —
typed into the form or imported from a spreadsheet — starts *pending* and is
in no other list: not the Report, the Inventory, the Dashboard, the exports,
History, a lookup or the assistant. A verifier then, per entry or for a
selection:

- **Verify** it — it joins the register and appears everywhere;
- **Edit** it — correct it without it entering the register;
- **Send back** it with a reason — it stays in Verification, marked, until it
  is corrected (which puts it back in the queue) or discarded;
- **Discard** it — removed without ever entering the register; its trail is kept.

Each decision is in the item's own history and the Activity Log. Records that
existed before this section were marked verified when the columns were added.

Two things worth knowing before changing it:

- **The hiding happens in one place, `crud.list_assets`**, which every list,
  count, export and the assistant read from — so a screen added later cannot
  forget it. Lookups and History filter the same way.
- **Who may verify is `roles.VERIFY_ROLES`**, separate from who may write. The
  *verifier* profile holds it, plus `EDIT_ROLES` (the single-record Edit) —
  and nothing else. `VERIFY_NEW_RECORDS=false` in `backend/.env` turns the
  step off. See `docs/API_CONTRACT.md` §2 and §7c.

## The in-app assistant

A floating **Assistant** button on every signed-in page opens a panel with two
tabs:

- **Guide** — step-by-step how-tos, filtered to what the signed-in profile can
  do. Needs nothing outside this server, so it always works.
- **Ask** — an AI assistant (Google Gemini by default; Claude optional) that answers questions
  about the register ("how many laptops are in stock?", "who had AMB000123
  before?") and about using the app. It has two modes, switched at the top of
  the panel:
  - **Answer only** — looks things up and explains. Every profile.
  - **Can make changes** — admins and superadmins only. It can *prepare* an
    edit or a transfer as a card with **Confirm / Decline**. Nothing changes
    until Confirm, and Confirm makes the ordinary request for that change, so
    it gets the same permission check, validation, history entry and Activity
    Log entry as doing it by hand. It cannot scrap, restore, delete, import or
    manage accounts at all.

**Scope** is enforced three ways: its instructions keep it to IT Asset Engine
(it declines anything else in one sentence); it has no tools that reach
outside the app — no web search or fetch, only this register; and every tool
runs with the asking person's rights.

**Everything is logged**: each question (its opening words), each mode switch,
each Confirm/Decline appears in the Activity Log under *Assistant*;
conversations are kept per user in `assistant_conversations`.

**Turning the AI on**: `ASSISTANT_PROVIDER` in `backend/.env` picks the AI —
`gemini` (default: set `GEMINI_API_KEY` from aistudio.google.com, model
`GEMINI_MODEL`) or `anthropic` (set `ANTHROPIC_API_KEY`, model
`ASSISTANT_MODEL`) — then restart the backend. Without a key the Ask tab says
it isn't set up and the Guide still works. Questions, and the register rows the
assistant looks up to answer them, are sent to that provider. On Google's free
tier, Google may use prompts to improve its products; enable billing on the
Google Cloud project for the paid tier, where it does not.

The two providers share everything but the API call: `app/assistant/engine.py`
runs the tool loop, `claude.py` and `gemini.py` only translate to and from each
API's format. A conversation held with one is not continued on the other — the
panel starts a new one after a switch.

## Quick start (local development)

First-time setup:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env            # then edit DATABASE_URL, SECRET_KEY, ADMIN_PASSWORD
cd ..\frontend
npm install
cd ..
```

Then, every time — one command from the repo root:

```powershell
.\start-dev.ps1        # starts whatever isn't running, waits until both answer
.\stop-dev.ps1         # stops just this repo's dev servers
```

It reuses an already-healthy backend instead of starting a second one, and if
something is wrong it says which thing (missing venv, missing `.env`, port
held by another process) rather than leaving you with a dead page. Use
`-BackendPort` / `-FrontendPort` to move either side; nothing else needs
changing, because the frontend proxies `/api` rather than hard-coding a port.

To run them by hand instead, in two terminals:

```bash
cd backend   && flask --app app.main run --port 8000
cd frontend  && npm run dev
```

Open `http://localhost:5173` and sign in with one of the four accounts
seeded on first start — `superadmin`, `admin`, `verifier` or `viewer`, all
starting on the `ADMIN_PASSWORD` you set in `backend/.env` (copy
`backend/.env.example`; there is no default). Each is asked to set its own
password at its first sign-in. Use `superadmin` for the walkthrough; it is
the only one that can delete a record permanently or clear all data.
Then use the
sidebar's **Data Entry → Bulk Upload** to import [`Asset.xlsx`](Asset.xlsx)
and populate the dashboard. (Data Entry also offers a blank **Excel
template** with a Field Guide and worked examples, if you would rather start
from an empty sheet.)

Full details (env vars, migrations, tests, CORS) are in
[`backend/README.md`](backend/README.md) and
[`frontend/README.md`](frontend/README.md).

## Deployment

Deployment is plain processes plus the already-installed PostgreSQL server —
there is no container step:

1. **Database** — PostgreSQL. Point `DATABASE_URL` in `backend/.env` at it;
   the app creates its database, tables and initial admin user on first
   start, so there is no manual setup step. Remember that the password is
   part of a URL and must be percent-encoded (`@` → `%40`).
2. **Backend** — run under **waitress**, not the Flask development server
   and not gunicorn (which is POSIX-only and won't run on Windows):

   ```powershell
   cd backend
   .venv\Scripts\python.exe -m waitress --host=0.0.0.0 --port=8000 app.main:app
   ```

   Register that as a Windows service with NSSM so it survives reboots —
   see `backend/README.md` for the exact commands.
3. **Frontend** — `npm run build` in `frontend/` produces a static bundle in
   `frontend/dist`. Serve it with IIS or nginx, which needs **two** rules:
   proxy `/api` to the backend, and rewrite unknown paths to `index.html`
   (the app uses real URLs like `/report` and `/users`, so without the
   rewrite a refresh or a pasted link 404s). `frontend/nginx.conf` shows
   both; IIS needs the equivalent URL Rewrite rules.

Before anyone besides you can reach it: set a real random `SECRET_KEY`,
change `ADMIN_PASSWORD`, and put it behind HTTPS — none of the tokens or
passwords in this system are safe over plain HTTP on a real network. You do
not need to touch `CORS_ORIGINS` as long as the frontend and API are served
from the same origin, which the `/api` proxy above arranges.

## Verification status

Both halves were built and independently smoke-tested during development
(pytest suite for the backend, and a live run of the frontend's actual API
client code against the actual backend — see each folder's README for what
was exercised and how). I additionally ran the backend standalone against a
throwaway SQLite database from a clean checkout and confirmed: health check,
admin login and seeding, `GET /api/assets` returning the expected shape, the
CORS header matching the frontend's origin, and a `user`-role account
correctly getting `403` on an admin-only action (clearing all data).

After the Flask restructuring, the same checks were repeated against the new
implementation — the 24-test pytest suite (ported to Flask's test client)
passes, and a live run confirmed health, login, CORS, asset creation with
`srl` auto-assignment, `GET /api/auth/me`, the admin user-management
listing, bulk import, and role enforcement (`403` for `user`, `204` for
`admin`) all still match `docs/API_CONTRACT.md` exactly — the unmodified
frontend was pointed at the new backend and required no code changes.

After the React rewrite, the frontend was verified by: a clean production
build (`npm run build`), `oxlint` with no errors, the Vite dev server
transforming every module in the app without error, and an API-level check
from the dev server's own origin confirming the backend returns the right
CORS headers for it (and correctly refuses an origin that isn't allowed).

The system now runs on **real PostgreSQL** (18.4, the server already
installed on this machine) rather than the SQLite stand-in used during
development, and that was verified end to end through the frontend's own
origin: the database being created automatically on first start, both tables
and the seeded admin, sign-in, asset create/read/update/delete, `srl`
auto-assignment, rejection of a blank required field, bulk import with
de-duplication, and role enforcement (a `user` account getting `403` on
delete and on user management) — with the resulting rows confirmed directly
in the `asset_management` database.

**Still not verified, and worth doing before relying on this in production:**
a real browser check of the frontend (layout, dark mode, the no-scroll
dashboard at actual screen sizes, clicking through each screen, a scan from
a real barcode reader, and a printed sheet of QR labels). No browser, browser
automation, barcode hardware or printer was available in the build
environment, so the frontend checks so far are build-, lint- and HTTP-level
rather than rendered ones.

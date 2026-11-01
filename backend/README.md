# IT Asset Engine — Backend

Flask + PostgreSQL (SQLAlchemy) + JWT auth backend for IT Asset Engine.
Built against `../docs/API_CONTRACT.md` — that document
is the source of truth for every endpoint shape, the 18-column asset model,
and the role permission table; this README only covers how to run and
operate this implementation.

**Structure note:** this backend was restructured from an earlier FastAPI
implementation to match `E:\project_catalog\catalog1\backend`'s layout and
patterns (Flask + Blueprints + decorator-based auth, `app/api/` +
`app/core/` + top-level `crud.py`/`database.py`/`models.py`/`main.py`) — one
of the user's other projects, kept as the house style for consistency across
their IT project portfolio. The wire API (every route, JSON shape, status
code, and role rule in `../docs/API_CONTRACT.md`) is unchanged by this —
only the implementation's shape changed, so the frontend required zero
changes.

## Directory layout

```
app/
  main.py         Flask app factory (create_app()): creates the schema,
                  seeds the initial admin user and the master tables, sets
                  up CORS, registers the auth/assets/masters/users
                  Blueprints.
  database.py     SQLAlchemy engine/SessionLocal/Base + @contextmanager get_db()
  models.py       SQLAlchemy models: User, the two registers (Asset and
                  Peripheral, both from RegisterItemBase), and the four
                  master tables (AssetType, AssetStatus, Department, Company)
  registers.py    The register registry: one Register per register (model,
                  counter, ID prefix, the nouns used in messages). Every
                  asset function in crud.py takes one, defaulting to ASSETS
  masters.py      The master-table registry: one MasterSpec per master
                  table (field key, model, labels, bootstrap defaults)
  crud.py         DB query functions, asset-field validation, the
                  master-table helpers, and the camelCase JSON
                  serialization helpers (asset_to_dict, auth_user_dict,
                  me_dict, user_out_dict, master_to_dict) used to build
                  jsonify() responses
  core/
    config.py     Settings (plain class, env vars via python-dotenv)
    security.py   Password hashing (bcrypt) + JWT create/decode (PyJWT)
  api/
    auth.py       Blueprint + token_required/role_required decorators --
                  the one place role permissions are enforced (see "Role
                  permissions" below)
    assets.py     make_blueprint(register) -- CRUD, history, bulk edit,
                  lookup, QR, clear-all and bulk import for ONE register.
                  Built twice: /api/assets and /api/peripherals
    masters.py    Blueprint: the master tables (see "Master tables" below)
    users.py      Blueprint: admin-only user management
tests/            pytest suite (Flask test client, throwaway SQLite DB)
requirements.txt
.env.example
```

## Database: PostgreSQL

This backend runs on PostgreSQL, connected through the pure-Python `pg8000`
driver (no build tools needed on Windows). You need a reachable PostgreSQL
server and a role that can log in; you do **not** need to create the database
by hand.

Set `DATABASE_URL` in `.env`:

```
DATABASE_URL=postgresql+pg8000://USER:PASSWORD@HOST:PORT/DATABASE
```

Three things to know:

- **The database is created for you.** On startup `ensure_database_exists()`
  in `app/main.py` connects, and if the target database doesn't exist yet it
  connects to the server's default `postgres` database and issues
  `CREATE DATABASE`. That needs a role with the CREATEDB privilege; if the
  role doesn't have it, the error tells you the exact `psql` command to run
  instead. The tables are then created by `create_all()` and the initial
  admin user is seeded.
- **`DATABASE_URL` is a URL, so the password must be percent-encoded.** `@`
  becomes `%40`, `:` becomes `%3A`, `/` becomes `%2F`, `#` becomes `%23`. A
  password of `p@ss/word` is written `p%40ss%2Fword`. Getting this wrong
  produces a confusing "could not parse" or wrong-host error rather than an
  auth failure.
- **Give this app its own database** rather than pointing it at another
  project's — it creates `users` and `assets` tables and expects to own them.

## Running locally (venv + Flask dev server)

1. Create a virtualenv and install dependencies:

   ```powershell
   python -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in real values — at minimum
   `DATABASE_URL`, `SECRET_KEY` and `ADMIN_PASSWORD`. Never commit `.env`.

3. Start the API:

   ```powershell
   .venv\Scripts\python.exe -m flask --app app.main run --port 8000
   ```

   Or, from the repo root, `..\start-dev.ps1` brings up this backend and the
   frontend together and health-checks both.

   There's no auto-generated docs page (unlike the previous FastAPI version's
   `/docs`) — hit `http://localhost:8000/api/health` to confirm it's up, and
   use `../docs/API_CONTRACT.md` for the routes.

> Avoid `python app/main.py` for day-to-day work. That path runs Flask with
> `debug=True`, which starts the auto-reloader as a second process; killing
> the one you can see leaves the other holding the port, which makes "why is
> the old code still serving?" surprisingly hard to diagnose.

## Deploying (Windows)

The Flask development server is single-threaded and explicitly not for
production. On Windows use **waitress** (already in `requirements.txt`);
`gunicorn` is POSIX-only and will not run there.

```powershell
.venv\Scripts\python.exe -m waitress --host=127.0.0.1 --port=8000 --trusted-proxy=127.0.0.1 --trusted-proxy-headers="x-forwarded-for x-forwarded-proto" app.main:app
```

`--host=127.0.0.1`: only nginx (or IIS) on this machine can reach the API, so
every request comes through HTTPS. `0.0.0.0` would let anyone on the network
call it directly over plain HTTP. The two `--trusted-proxy` options make the
Activity Log record each visitor's own address rather than nginx's
`127.0.0.1`.

ONE waitress process (it serves requests on threads). The daily summary,
renewal reminders and scheduled data export run inside it and claim their
day in the database, so a second process would not double-send -- but there
is no need for one.

To keep it running across reboots and logouts, register that command as a
Windows service with a supervisor such as [NSSM](https://nssm.cc/):

```powershell
nssm install AssetManagementAPI "E:\asset-management-it\backend\.venv\Scripts\python.exe" ^
    "-m waitress --host=127.0.0.1 --port=8000 --trusted-proxy=127.0.0.1 --trusted-proxy-headers=""x-forwarded-for x-forwarded-proto"" app.main:app"
nssm set AssetManagementAPI AppDirectory "E:\asset-management-it\backend"
nssm start AssetManagementAPI
```

The frontend is a static bundle (`npm run build` in `../frontend`, output in
`frontend/dist`). Whatever serves it — IIS, nginx — needs two rules: proxy
`/api` to this backend, and rewrite unknown paths to `index.html` for the
client-side router. `../frontend/nginx.conf` shows both.

Before exposing any of this beyond your own machine, work through
`../docs/DEPLOYMENT_CHECKLIST.md`. The server itself refuses to start on a
missing or placeholder `SECRET_KEY`.

**Whatever runs it, there is no startup command to remember.** `app.main`'s
module-level `app = create_app()` creates the database, the schema and the
admin user at **import** time, so any WSGI server that can import
`app.main:app` brings the whole thing up.

## Schema management: no migration tool

Unlike the earlier FastAPI version (which used Alembic), this backend
creates the database if needed and then its schema directly via
`Base.metadata.create_all()` in `app/main.py`'s `create_app()`, matching how
catalog1's Flask backends are structured (see its `app/main.py`, which does
the same `create_all()` plus a few idempotent
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements to evolve an
already-deployed schema).

**Trade-off worth knowing:** `create_all()` only *creates missing tables* —
it does not add a column to a table that already exists, drop a removed
column, or alter a column's type. So two idempotent steps run straight after
it, both in `app/main.py`:

1. **`ensure_asset_columns()`** — walks `_ASSET_COLUMN_PATCHES` (a list of
   `(column, DDL type, index DDL)`) and `ALTER TABLE ... ADD COLUMN`s
   anything a table is missing, **for every register** (`assets` and
   `peripherals` — the index DDL is rewritten per table, since an index name
   must be unique across the schema). This is catalog1's own pattern. It is
   how `asset_id`, `make`, `availability`, `service_tag` and `is_deleted`
   reached databases that already held assets. **To add a column later:
   declare it on `models.RegisterItemBase` and add a line here** — the model
   alone only covers fresh installs.
2. **`ensure_register_column_order()`** — see below.

Anything beyond adding a column (dropping one, changing a type) still wants
a real migration tool (e.g. Alembic). Not set up today, by design; flagged
here so it's a deliberate choice, not a surprise later.

### Physical column order follows `models.RegisterItemBase`

`ADD COLUMN` can only ever *append*, so each column added by step 1 landed
at the end of the table however the model declared it — `asset_id` and
`make` sat after `updated_by` in pgAdmin/DBeaver rather than next to `srl`.
Neither PostgreSQL nor SQLite can move a column in place, so
`ensure_register_column_order()` rebuilds a register's table when the two
disagree (both registers, each checked on its own):
rename the old table aside, drop its indexes (an index name must be unique
across the schema, and a rename doesn't free it) and rename its primary-key
constraint, create the table fresh from the model's DDL, `INSERT … SELECT`
every row across by name, drop the old one. All in one transaction, which
both engines roll DDL back inside, so a failure anywhere leaves the original
table untouched.

Consequences:

- **`models.RegisterItemBase`'s declaration order is the column order of
  both register tables**, on a fresh install and on an upgraded one alike.
  Moving a column there moves it in the database on the next startup.
- It **refuses to act** — logs and returns — if a table holds a column the
  model doesn't know about (rebuilding would drop its data) or if a previous
  run left `<table>_column_order_backup` behind.
- It is a **no-op once the orders match**, which is every startup after the
  first, and every startup of a fresh install.

`tests/test_column_order.py` covers this against throwaway SQLite databases
shaped like a real upgraded one, including that no row is lost and that
values don't shift by position into the wrong columns.

## Changing the seeded passwords

Three accounts are seeded once, only if the `users` table is empty — one per
profile that can sign in (`app/roles.py`):

| Username           | Profile      | Can                                                   |
| ------------------ | ------------ | ----------------------------------------------------- |
| `$ADMIN_USERNAME`  | `superadmin` | everything, including permanent delete and clear-all   |
| `admin`            | `admin`      | add, edit, import, scrap; masters and users            |
| `viewer`           | `viewer`     | read-only                                              |

(A fourth, `verifier`, is seeded the same way.) All of them start on the
SAME `ADMIN_PASSWORD`, which `.env` must set for that first start — there is
no default in the code, and startup refuses to seed without one. It is a
day-one password to be read out to the owners, and each seeded account is
made to replace it at its first sign-in; it cannot be chosen again as a new
password. To change one afterwards, either:

- **As that account, via the API** — log in, then:

  ```
  PATCH /api/auth/me/password
  { "currentPassword": "...", "newPassword": "..." }
  ```

- **As another admin, via user management** —

  ```
  PATCH /api/users/{id}
  { "password": "..." }
  ```

  An admin can do this for `admin` and `viewer`, but **not** for the
  superadmin: only a superadmin may change a superadmin's account, password
  included (`app/roles.py`, `superadmin_guard_error`). Otherwise the
  profile split would be one password reset deep.

Changing `ADMIN_PASSWORD` in `.env` after these rows already exist has **no
effect** — it's only read when the users table is first seeded.

## CORS / origins configuration

`CORS_ORIGINS` (see `.env.example`) is a comma-separated list of allowed
frontend origins, read in `app/core/config.py` and applied in
`app/main.py`'s `create_app()` via Flask-CORS. It defaults to `*`
(permissive), which is fine for local development but must be tightened to
the real frontend origin(s) — e.g.
`CORS_ORIGINS=http://localhost:8080,https://assets.example.com` — before any
real deployment.

## Profile permissions (enforced server-side)

**`app/roles.py` is the single source of truth.** Routes ask for a
capability via the `@token_required` / `@require_admin` /
`@require_superadmin` decorators in `app/api/auth.py`; that module decides
which profiles hold it. The frontend hiding a button is a UX nicety only —
the server never trusts it.

| Action | superadmin | admin | viewer | assignee |
|---|:--:|:--:|:--:|:--:|
| Sign in | ✅ | ✅ | ✅ | ❌ 403 |
| View records, history, lookup, QR labels | ✅ | ✅ | ✅ | — |
| Create / edit / bulk-edit a record | ✅ | ✅ | ❌ 403 | — |
| Bulk import | ✅ | ✅ | ❌ 403 | — |
| **Scrap** a record (soft, restorable) | ✅ | ✅ | ❌ 403 | — |
| **Restore** a scrapped record | ✅ | ❌ 403 | ❌ 403 | — |
| **Delete a record permanently** | ✅ | ❌ 403 | ❌ 403 | — |
| **Clear all** assets or users | ✅ | ❌ 403 | ❌ 403 | — |
| Read master tables (dropdown values) | ✅ | ✅ | ✅ | — |
| Manage master tables | ✅ | ✅ | ❌ 403 | — |
| Manage user accounts | ✅ | ✅ | ❌ 403 | — |

`require_admin` accepts **superadmin and admin**, so the profile above
inherits everything rather than being listed on every route. The 403 body
names the profile the route wants, not always "admin" — an admin refused
something that needs superadmin should not be told to ask themselves.

A missing/invalid/expired JWT returns `401`; a valid JWT for a profile that
may not do the thing returns `403`.

### Scrapping is not deleting

The words are close, the actions are not, and this is what the top two
profiles are split over:

- **Scrap** — `DELETE /api/{register}/{id}`, `crud.delete_asset`. The row
  stays, moves to status `SCRAP`, keeps its ID and history, and is
  restorable. Scrapping is **admin** -- reversible, so it belongs to the
  profile doing the everyday work. **Restoring is superadmin only**
  (`POST /api/{register}/{id}/restore`): taking a machine out of service is
  routine, putting one back is a decision a level up.
- **Delete permanently** — `DELETE /api/{register}/{id}/permanent`,
  `crud.purge_asset`. The row is gone. **Superadmin**, and additionally
  password-confirmed. A separate route rather than a flag, so it cannot be
  reached by adding a parameter to a request a client already makes.

A purge **keeps the audit trail** and appends a `purged` event naming the
actor — a register whose delete erased the evidence of the delete could not
answer the one question worth asking afterwards. It also **does not roll the
ID counter back**, so no later record inherits the purged one's trail.

### `assignee`: a name, not an account

617 of the 620 accounts in this register were created in bulk from the
Assigned User column of a spreadsheet, all on one shared password, and none
had ever signed in. That column says who *holds* a machine — it was never a
statement about who may use this app. So those records are now `assignee`,
and **assignees cannot authenticate**: `login()` refuses them after
verifying the password, and `token_required` re-checks the stored row on
every request so a demotion ends a session already in flight.

The shared default password therefore protects nothing, because it unlocks
nothing.

An assignee's profile is **one-way** (`roles.role_change_error`). Demotion
to assignee is allowed; promotion out of it is refused with a 422, because
editing 617 directory entries into candidates for an account is exactly what
the profile exists to prevent. Their other fields stay editable — the names
came out of a spreadsheet and some are misspelled.

Holding a login and being an assignee are **not** mutually exclusive:
`Asset.user` is text, not a foreign key, so an admin can have assets issued
to them without it touching their profile.

Accounts also carry an **email** and a **location**, both optional and both
recovered from the columns beside the person's name in the register
(`crud.backfill_user_details`, at startup; `locations_by_person` /
`emails_by_person` on upload). Only ever fills a blank, so a value an admin
typed always wins, and a name whose rows disagree gets nothing rather than a
guess — two people here hold assets at two locations each, and neither is
guessed at.

## In stock releases the holder

"In stock" means **nobody has it**, so a record whose status says so must not
still carry the name of whoever last did. `crud._apply_asset_fields` blanks
`user` and `email` whenever the resulting status matches
`is_in_stock` — the same place the derived columns are recomputed, and the
one point create, update, bulk edit and import all pass through. No route
can skip it.

Without it the Inventory screen lists spare machines beside people who no
longer hold them, and the register quietly disagrees with itself about who
has what.

- **The status wins.** A payload carrying both `IN STOCK` and a new
  Assigned User is a contradiction; the half that says nobody has it is the
  half that means something.
- **It is recorded.** `update_asset` snapshots before applying, so the
  release lands in the history as `user: ABHIRUP DUTTA -> empty` alongside
  the status change. Somebody looking at a spare laptop can see who had it.
- **Coming back out of stock invents nobody.** The previous holder gave it
  up; the register does not know who is taking it, so the field stays blank
  until someone says.
- **Only stock does this.** SOLD, SCRAP and LATER ADDED leave the holder
  alone — a sold asset's last custodian is still a fact worth keeping.

### …so Assigned User stops being required in stock

It is a required field, and this blanks it. `validate_asset_fields` therefore
drops `user`/`email` from the required list when the effective status is in
stock — the status in the payload if it carries one, otherwise the record's
own (`current_status`, passed by the PATCH route). Without that, re-saving a
spare laptop would be refused for the blank this rule itself created.

The requirement exists to stop an asset being entered with no custodian.
Something on a shelf legitimately has none.

## Transfer: moving a record to a place AND a person

`POST /api/{register}/{id}/transfer` (admin and above,
`api/assets.py::transfer_asset`).

Location and Assigned User used to be two fields on one edit form, so
nothing connected them: an asset could end up at ECOHUB 4A assigned to
somebody who sits at RAICHAK, and nothing noticed. This route takes both
together and checks they agree before writing either.

The person is identified by **account id**, not by a typed name. That is
what makes the check possible at all — the account is the thing that knows
where its owner sits — and it is also what stops the name and email on the
record drifting away from the account they describe: both are copied from
it.

`crud.transfer_location_error` is the rule, and what it does NOT flag
matters as much as what it does:

- Compared case- and padding-insensitively. The two strings come from
  different places — one typed into a spreadsheet, one picked from the
  master list — so `Ecospace 4B` vs `ECOSPACE 4B` is the same desk, not a
  mismatch.
- A person with **no location on file is never a mismatch**. 86 accounts
  have none; refusing them would make this unusable for exactly the people
  an admin most needs to sort out.
- A mismatch is a **422 with nothing written**, not a partial move. Applying
  the location and refusing the assignment would leave the record in the
  inconsistent state this exists to prevent.
- `allowElsewhere: true` overrides it. People do change desk and the
  register catches up afterwards — but it has to be asked for.

A person's own location is **not** changed by a transfer. Issuing someone an
asset says where the asset is, not where they sit.

### A peripheral in use transfers onto an ASSET

`crud.peripheral_transfer_mode` decides which kind of move a peripheral
takes, from its status:

- **in use** → it is plugged into a machine, so "where is it" is answered by
  *which machine*. The destination is an `assetId`, and the peripheral's
  location and floor are **copied from that asset** rather than chosen.
  Choosing them separately is what let a keyboard sit at ECOSPACE 4B while
  the laptop it was on moved to RAICHAK.
- **anything else** (in stock, sold, later added) → the plain location move.
  Only `in use` switches the mode, which is the safe direction: a status
  this rule has never seen behaves the way it always did. Matched on shape
  (`in use` / `IN USE` / `in-use`), because the register spells statuses
  inconsistently — `In Use` on assets, `IN STOCK` in the same list.

The attachment is made through `crud.link_peripherals` **from the asset's
side**, passing that asset's existing links plus this one. That is not a
detour: it is where the one-at-a-time rule lives (an exclusive type moves
off whatever it was on, a shared printer is added and stays) and where both
sides' history is written. Re-implementing either would be a second copy of
the rule to keep in step.

Sending a `location` for an in-use peripheral is a 422 naming what to do
instead; sending an `assetId` for one that is not in use is ignored. To put
an in-use peripheral back on a shelf, set its status to IN STOCK first.

### Upgrading from the two-role world

`main.migrate_user_roles()` maps the retired `user` role to `assignee` at
startup, idempotently, logging at WARNING. The direction is deliberately the
safe one — it takes access away. Anyone who needs to sign in is given a
viewer, admin or superadmin account explicitly, which leaves a record of the
decision. On a fresh install the seeded account is a **superadmin**: it is
the only account there is, and an install whose sole account cannot reach
the superadmin-only actions could never create one that can.

**Session-expiry 401s are marked.** `token_required` includes
`"code": "invalid_token"` in its `401` bodies; no other `401` does. Some
routes answer `401` for a reason of their own — a wrong current password
when changing it, a mistyped confirmation password on "Clear all data" —
and the frontend must show those as an error on the screen rather than
signing the user out. It keys on that marker, not on the status code, so
only the decorator that can actually judge the session ends it.

Master-table reads are open to every profile that can sign in, because every
asset form needs them to fill its dropdowns and a viewer's grid filters read
the same lists. Editing, renaming, retiring and deleting master values are
admin and above.

## Two registers: assets and peripherals

`/api/assets` and `/api/peripherals` are the same endpoint set over two
separate tables. **One implementation, mounted twice**, not two copies:

- **`models.RegisterItemBase`** is an `__abstract__` model holding every
  column. `Asset` and `Peripheral` are empty subclasses that differ only in
  `__tablename__`. Same pattern, and the same reasoning, as `MasterBase` and
  the four master tables: genuinely separate tables with identical structure,
  either free to grow its own columns later, and clearing one cannot touch
  the other.
- **`app/registers.py`** holds a `Register` per register: the model, the
  counter row, the ID prefix (`AMB` / `PRP`), and the nouns used in
  messages. **Every asset function in `crud.py` takes `register=ASSETS` as a
  default argument**, which is why the whole existing surface — and every
  test written before peripherals existed — meant exactly what it meant
  before.
- **`app/api/assets.py` is a factory.** `make_blueprint(register)` builds
  the route set; it is called twice at import. A route added there appears
  on both, which is the point: the peripheral list is meant to behave like
  the asset list, and two files would drift apart within a month.

Both tables carry `asset_id`, `asset_tag` and so on rather than
`peripheral_id` — one set of attribute names means one implementation of
every read, write, import, export and audit path, and one set of JSON keys,
which is what lets the frontend render either register with the same
components and only swap three labels. The **table name** is what says which
register a row belongs to.

**What crosses the boundary, and why:**

| | Scope | Why |
|---|---|---|
| Serial numbers | **Both** | A serial is a fact about one piece of hardware. `crud.find_item_by_srl` searches both tables on every write path; the per-table UNIQUE index is only half the rule (see below). |
| Scan lookup | **Both** | Someone scanning a label is asking what the device *is*. `?scope=this` narrows it. |
| Master lists | **Both** | A Department is org-wide. `count_assets_using` and `rename_asset_values` cover both, or a rename would strand half the data. |
| ID numbering | Per register | Own counter row, so clearing one cannot renumber the other. |
| History | Per register | One `asset_events` table with a `register` discriminator — the trail is the log *of* the registers, not part of either, and "every change, newest first" is one query rather than a union. |
| Clear-all | Per register | Emptying the peripheral list says nothing about your 631 assets. |
| Import duplicate detection | Per register | A keyboard and a laptop can share a description and a user without either being a re-upload. |

`tests/test_peripherals.py` tests the boundary specifically — not that each
endpoint works, which the asset suite already covers against the same code,
but that the two registers stay apart where they should and share what they
should.

### Linking peripherals to an asset

A laptop has a mouse, a keyboard and a dock plugged into it. The asset's
Report Section column is **Linked Peripherals** and shows their serial
numbers — but the relationship is stored in its own table
(`models.PeripheralLink`), and the asset's column is derived from it on read.
Derived rather than copied because **serial numbers are editable and often
blank** on a freshly imported peripheral: a list of them written onto the
asset would be a snapshot that goes stale the moment one is corrected or
filled in.

### Shared and exclusive types

A mouse, a keyboard or a headset belongs to **one machine at a time**. A
printer or a scanner is shared by a **whole floor**. Both have to be
expressible, so:

- The link is a **join table**, which can say either.
- Which kind a peripheral is, is a property of its **type**, recorded as
  **`AssetType.is_shared`** and toggled on the Master Data screen. "Printers
  are shared" is a fact about printers, not about one printer.
- `crud.link_peripherals` enforces it: linking an **exclusive** peripheral to
  a second asset **moves** it off the first; linking a **shared** one
  **adds**, leaving it where it already was.

It started as a single `linked_asset_id` column on `peripherals`, which made
"one peripheral, one asset" structurally true — a genuinely better guarantee
than a rule in a function. That could not survive printers. The trade-off is
stated in `PeripheralLink`'s docstring: exclusivity is now a rule rather than
a shape, and the UNIQUE index can only stop the same pair being recorded
twice. `main.migrate_peripheral_links()` carries existing links across and
drops the old column on first start.

**`is_shared` defaults to false**, and that direction is deliberate: wrongly
exclusive produces an error message telling an admin to tick a box, while
wrongly shared silently permits the same mouse on two laptops. `PRINTER`,
`SCANNER` and `PROJECTOR` (`crud.SHARED_TYPE_SEEDS`) start ticked — set when
the type is first auto-registered (`sync_masters_from_rows`), which is how
types actually appear on a fresh install, and once at startup by
`ensure_shared_types()` for a register that predates the flag. Both are
**defaults on creation, never overrides**: an admin who unticks PRINTER is
not overruled on the next restart. A type nobody has marked, including one
that is not in the master list at all, is treated as exclusive.

### A peripheral has no Assigned User

`user` and `email` are **not part of the peripheral register**
(`crud.NOT_ON_PERIPHERALS`): not in its grid, not on its form, not required,
not exported, and refused if a client sends them. A mouse is used by whoever
is using the laptop it is plugged into — an Assigned User on a keyboard is a
second copy of that fact which goes stale the moment the laptop changes
hands.

The columns still exist in the `peripherals` table, because the two registers
share one model; they are simply never populated or read there.
`_apply_asset_fields` fills the NOT NULL `user` with `''` for a peripheral
rather than letting the insert fail.

Behaviour worth knowing:

- **`linkedPeripheralIds` on create/PATCH replaces the set.** The form sends
  the list it is showing, so a device removed there is unlinked here. One
  meaning for the field, no separate unlink call.
- **Omitted and empty differ.** A PATCH with no `linkedPeripheralIds` leaves
  links alone — moving an asset to another floor is not an instruction to
  unplug its mouse. `[]` unlinks everything.
- **Linking an exclusive peripheral that is already on another asset moves
  it**, and is not refused: a mouse moving between machines is ordinary
  helpdesk work. Both trails record it — the peripheral's with the asset it
  left, and the asset it left with where it went. A **shared** one is simply
  added and stays where it was.
- **Unlinking touches this asset only.** Taking a shared printer off one
  laptop leaves it on the rest of the floor.
- **Switching a type from shared back to exclusive does not retroactively
  unlink anything** — it takes effect the next time one of its peripherals
  is linked, which then collapses it onto that one asset.
- **An id that matches no peripheral is reported, not fatal** (`linkWarning`
  on the response). A bad scan must not cost the operator the rest of the
  form. Scanning an *asset's* label lands here too — an asset is not a
  peripheral.
- **The field is refused on `/api/peripherals`** with a 422 rather than
  ignored: a peripheral plugged into a peripheral is not a thing.
- **A soft-deleted asset keeps its links** (the hardware is still physically
  somewhere, and restoring brings them back); **clear-all frees every
  peripheral**, or they would point at rows that no longer exist.
- **One query per page, not per row.** `crud.linked_peripherals_map()` loads
  the links for a whole listing at once — the asset list is 600+ rows and
  most of them link nothing.

`tests/test_linked_peripherals.py` covers all of the above, including that
correcting a peripheral's serial afterwards changes what the asset's column
shows.

## Asset field validation & the `srl` / bulk-import behavior

**Messages name the column, not the field key.** `crud.FIELD_LABELS` maps
each key to the heading it carries on screen and in the upload template, and
every validation message goes through `field_label()`. This is not cosmetic:
"assetTag is required" named something that appears nowhere in the person's
spreadsheet — and read as the manufacturer's *service tag*, which is a
different thing entirely and not even a column. It now says **"Computer /
Asset Name is required"**, which points at the cell to fix. The map mirrors
`frontend/src/lib/schema.js`, and `tests/test_field_labels.py` pins the
exact strings so the two cannot drift apart silently.

- Required fields (`type`, `assetTag`, `model`, `description`, `status`,
  `user`, `location`, `company`) must be non-empty strings on create and on
  every bulk-import row. On `PATCH`, a required field is only checked if the
  request actually includes it — you can't submit it blank, but omitting it
  (to leave it unchanged) is fine.
- **`site` is not in that list, and is not typed at all.** It is derived
  from `location` (`crud.derive_site`) and is in `SERVER_ASSIGNED_KEYS`, so
  a value sent for it is ignored. See *One place field* below.
- A bulk-import row is validated **against its own register**. Passing
  `register` there is not cosmetic: without it a peripheral upload was
  checked against the asset list and every row was rejected for a missing
  Assigned User — a column peripherals do not have (`NOT_ON_PERIPHERALS`).

### One place field, not two

The form used to ask for a Location (free text) *and* a Site (a dropdown),
which is two answers to "where is it" that could disagree — and in the live
register they do: 17 locations sit under more than one site, and codes like
`CCPT`, `CCHD` and `CCRP` don't contain their site name at all.

So there is one field now. **Location carries the site vocabulary** — its
dropdown offers the values Site used to (`optionsFrom: 'site'` in
`frontend/src/lib/schema.js`) — and **`derive_site` copies it onto Site** on
every write, at the same point `make`, `availability` and `service_tag` are
derived. The two can no longer disagree, and the trail records both when an
asset moves.

Two details worth knowing:

- **A save with no location keeps the site already recorded.** The 629 rows
  imported before this have locations that are not site names
  (`ECOSPACE 4B`), and a `PATCH` that does not mention location must not
  wipe the site they have.
- **Existing rows are not rewritten.** Their Location and Site stay exactly
  as recorded until someone edits one. Editing an old row and saving will
  set Site from whatever Location then holds — so a row left at
  `ECOSPACE 4B` gets Site `ECOSPACE 4B` unless a clean value is picked. The
  dropdown keeps the legacy value selectable precisely so nothing is lost by
  accident, but it is the moment to choose a real site.
- `email`, if present and non-blank, must match a standard email pattern.
- `dop` / `warrantyEnd` / `insuranceEnd` / `assignedDate`, if present and non-blank, must be `yyyy-mm-dd`.
- `assignedDate` is set by the server to today when the asset's `user`
  becomes a different person (or a peripheral is linked onto an asset), and
  cleared when nobody has it; a value sent in the same write is kept
  instead, so a hand-over can be back-dated (`crud.note_assigned_date`). It
  replaced Date of Joining (`doj`), which moved onto the user record as
  `date_of_joining` (`crud.move_joining_dates_to_users`, run once).
- `srl` is the device's **serial number**: free text, optional, and left
  exactly as supplied — including blank. It is **not** auto-numbered (that
  behaviour was removed; see "Asset IDs" below). A bulk-imported row
  commonly has no serial number, and it is scanned or typed in later.
  Free text rather than an integer column because legacy rows carry
  non-numeric values in it. It is also **unique across the register** — see
  the next section.
### The master list's spelling is what gets stored

Master matching has always ignored case, so a file saying `Marketing`
matched the master row `MARKETING` and no second master row was created.
But the **asset** kept whatever the spreadsheet said — and everything that
groups by the literal string (the dashboard's charts, the Report Section's
column filters) then saw two departments. On the live register that was
**71 assets across 5 department pairs**: `MARKETING` (36) beside `Marketing`
(1), `BUSINESS DEVELOPMENT` (17) beside `Business Development` (1), and so
on.

`crud.canonicalise_master_values` rewrites each mastered value to the master
row's own spelling before it is written, on **every** path — create, edit,
bulk edit and import. The form already sends the exact value it was offered,
so it is a no-op there; it is the API and the spreadsheet that could
otherwise introduce a variant.

A value the master lists do **not** have is left exactly as written. It is
either about to be registered in that spelling or about to cost its row a
place, and quietly changing it would be guessing.

An import reports what it rewrote, once per value rather than once per row:

```
"normalised": { "department": [ { "from": "Marketing", "to": "MARKETING" } ] }
```

This is a rule about *future* writes. The 71 rows already in the register
keep their spelling until something touches them.

### No duplicate masters or users, whatever the case or padding

- **Masters** — `crud.find_master_by_name` compares
  `lower(trim(name))` on both sides, so `laptop`, `LAPTOP` and `  Laptop  `
  are one value. Enforced on create, on rename, and in the bulk-add box.
  The database's own UNIQUE index is case-*sensitive*, which is why this
  exists at all.
- **Users** — `crud.find_user_by_username` does the same for accounts, and
  the create route uses it. `get_user_by_username` stays **exact** and is
  what signing in uses: the duplicate check widens, authentication does not.
  Bulk account creation from the Assigned User column was already safe —
  `derive_username` lowercases and the taken-set is lower-cased.

### Values the master lists do not have

A mastered value — Asset Type, Status, Department, Company or **Location** —
that no master row has used to register itself silently. That is right the
first time a legacy register is loaded, when the unknown values *are* the
master lists, and wrong every time after: an unrecognised department is
usually a typo, and a typo that registers itself becomes an option in
everybody's dropdown.

So the importer reports them and is told what to do:

```
POST /api/assets/bulk   { "rows": [...], "unknownMasters": "include" | "reject" }
  -> { ..., "unknownMasters": { "department": ["RISK"], "location": ["NOWHERE"] },
            "unknownMastersMode": "include" }
```

- `"include"` — register them, as before. **The default**, so an API caller
  that has never heard of this keeps working.
- `"reject"` — skip those rows, naming the field and the value
  (`not in the master data: Department 'RISK'`), and add nothing to any
  master table.

Rejecting is **per row, not per file**: one typo must not cost the other
four hundred rows their place. The unknown values are reported whichever
mode ran, so the caller can say what it just registered — or what it
rejected and what to add in Master Data to let it in.

"Unknown" is decided once, from the master tables as they were when the
upload started (`crud.master_value_index`), so the same value in rows 1 and
400 is reported once and treated identically both times.

The upload screen asks before sending — it computes the same set in the
browser (`lib/unknownMasters.js`) and puts the question with the actual
values in it, because "3 departments are not in the master data" is
unanswerable where "RISK, LEGAK, PROCUREMENT" is obviously two real
departments and a typo. The server checks again on what it receives; the
browser's copy buys the question, not the rule.

- `POST /api/assets/bulk` never hard-fails the whole batch on one bad row.
  Each row is validated independently; a row that fails validation is
  skipped and reported, valid rows are still imported. Rows already in the
  register are skipped too — see "Duplicate detection" below. The response
  is
  `{ "added": N, "skipped": N, "total": N, "errors": [...], "warnings": [...] }`
  — both lists hold `{row, reason}` entries keyed by the 0-based index into
  the posted `rows` array. `errors` covers rows that did **not** go in
  (validation failure or duplicate); `warnings` covers rows that **did** go
  in after a cell was cleared (below). Both are additive beyond the minimal
  contract shape, so a client reading only `added`/`skipped`/`total` is
  unaffected. The frontend turns `errors` back into a **downloadable upload
  file** of just the rejected rows — see "Bulk upload" in
  frontend/README.md — which is why each entry carries the row index rather
  than only a message.

## Serial numbers are unique: one serial, one device

A serial number is stamped on a single piece of hardware, so the same one on
two records means one of them is wrong — a mis-scan, a copied row, or a
machine entered twice. Left unchecked it is a quiet kind of wrong: the
register looks complete while two rows point at one laptop and some other
laptop has no record at all. So `srl` may not be reused.

**Across both registers.** Which list a device is filed under has nothing to
do with the number stamped on it, so a serial held by an asset cannot be
taken by a peripheral or the other way round.

Matching is **case-insensitive and ignores padding** (`lower(trim(srl))`),
so `  h6rp9g3 ` and `H6RP9G3` are recognised as the same device.

**A blank serial is exempt.** It isn't a value, so it never collides — any
number of assets can sit waiting for theirs to be scanned in, which is the
normal state right after a bulk upload.

Enforced in three places, because "unique" is only true if every way in
agrees:

1. **`crud.duplicate_srl_error()`** on `POST` and `PATCH`, and per row
   inside `crud.bulk_import_assets()`, all reaching
   `crud.find_item_by_srl()`, which searches **both** tables. This is the
   layer that produces a message naming the register, the ID and the asset
   tag already holding the serial — the others only say no.
2. **A partial UNIQUE index** on `lower(trim(srl))`, one per register
   (`main.ensure_srl_unique_index`; `ix_assets_srl_unique`,
   `ix_peripherals_srl_unique`). This is the actual guarantee *within* a
   register: it holds for any code path, including two writes landing at the
   same instant, which no application check can catch. An index cannot span
   two tables, so the cross-register half of the rule rests on layer 1
   alone — worth knowing, because it is the one part of this that a direct
   database write could get past.
3. **`lib/serials.js`** in the frontend, so the operator is told before the
   round trip rather than after it.

Details worth knowing:

- **A deleted (SCRAP) asset keeps its serial** and still blocks reuse: the
  record still refers to that hardware, and a different device cannot have
  had its serial. The error message says the holder is deleted, so the
  operator can clear it there if the device really is being re-registered.
  Clearing a serial (`PATCH` with `srl: ""`) frees it immediately.
- **`dedupeKey: "none"` does not switch this off.** That setting turns off
  duplicate-*row* detection; it is not permission to put one serial on two
  devices.
- **Within one uploaded file**, the first row to claim a serial gets it and
  later rows are reported against it by row number.
- **The index is skipped, not fatal, on a register that already has
  duplicates.** A register that predates this rule may hold them (test
  values from a trial run, or a device entered twice). Failing to start over
  data that has been fine all along would be the wrong trade, so
  `ensure_srl_unique_index()` names the offending serials in the log,
  startup continues, and the index appears on its own the next start after
  they are resolved. New duplicates are refused by layer 1 throughout.
- The existence check asks the catalog directly rather than using
  SQLAlchemy's inspector, which **cannot reflect an expression-based index**
  — it warns and omits it, which would make the index look absent forever
  and retry the CREATE on every startup.

`tests/test_serial_unique.py` covers all of it: create, PATCH, self-edit,
freeing and moving a serial, deleted holders, the three bulk-import cases,
and the index refusing a duplicate written behind the API entirely.

### Bulk import is lenient about optional fields

A missing **required** field still costs the row its place. A malformed
**optional** field — `email`, `dop`, `warrantyEnd`, `assignedDate` — does not: the offending cell
is cleared (`crud.sanitize_optional_formats`), the row is imported, and the
cleaning is reported in `warnings`. Manual `POST` / `PATCH` remain strict:
someone typing into the form should be told to fix the value, not have it
dropped for them.

This is not a hypothetical nicety. It was found by tracing real data loss:
the reference register writes the literal text `SOLD` into the Email ID
column of every sold asset, and the old strict rule therefore rejected
**all five sold assets** out of a 695-row import. They never reached the
database, so they were absent from the report grid, the dashboard's
Sold/Disposed tile, and the Status master list — with nothing in the UI
explaining why, because the `errors` array was returned but never
displayed. Losing an entire asset record over a junk value in a field that
was not even required is far more destructive than dropping the one cell,
especially when the surrounding columns (Status, Site, Comments) carry the
same information. The frontend's Bulk Upload panel now renders both lists.

## Deleting an asset: soft delete to SCRAP

`DELETE /api/assets/{id}` does not remove the row. It sets `is_deleted`,
moves the asset to status **`SCRAP`**, and derives `availability` to
`INACTIVE`. The record keeps its Asset ID, its history and its place in the
register, and is still returned by `GET /api/assets` — the Report Section
is the record of what the register holds.

**The status change is what takes it out of circulation.** Everything that
reasons about status skips scrapped assets: the Dashboard filters them out
before computing any tile or chart, so a deleted laptop stops counting
toward the fleet total and its old status no longer inflates "In Use".

**`SCRAP` is reserved.** `crud.reserved_status_error()` rejects it from
every client path — create, `PATCH`, and bulk-imported rows — with `422`,
so deletion is the only way an asset can reach it. An asset that *already*
holds the status may resubmit it, because the edit form posts the whole
record including its current status; without that exception a deleted
asset could never be corrected.

It also exists in the Status master table as a **retired** row, so the
entry form (which offers active master values only) never lists it while
the Master Data screen still documents what it means.
`crud.ensure_reserved_statuses()` inserts it at startup if missing, and
never reactivates a row an admin has touched.

**Why the flag as well as the status.** `availability` is recomputed from
`status` on every write, so without a persisted `is_deleted` an edit to a
deleted asset would derive `ACTIVE` again and silently undelete it. The
flag also lets the UI tell a deleted asset from one that is merely
`INACTIVE` because it was sold.

A deleted asset still occupies its service tag **and its serial number**, so
re-importing its row is still skipped as a duplicate and the device cannot
be entered as a second record. Restoring it is the way back.
"Clear all data" (`DELETE /api/assets`) is unaffected — that really does
remove every row.

### Restoring: `POST /api/assets/{id}/restore`

Deleting used to be one-way. It overwrote `status` with SCRAP, so deleting
the wrong asset left a record stuck at SCRAP with its real status gone —
and still holding its serial, so the device could not be entered again
either.

`delete_asset()` now keeps the status it replaced in **`previous_status`**
(and in the history), and `restore_asset()` puts it back: `is_deleted` goes
false, the status returns, `availability` is recomputed. **Superadmin
only** — deliberately a level above the admin who scraps, so a machine taken
out of service cannot be put back by the same person who took it out. An
admin's attempt is refused (403) and recorded in the Activity Log.

- A `status` in the request body **overrides** the remembered one.
- It is **required** for an asset deleted before `previous_status` existed —
  there is nothing recorded for those, and inventing a status would be
  worse than asking. `crud.restore_status_error()` says so with `422`, and
  the Report Section prompts for one.
- Restoring **to SCRAP is refused** — that is the deleted state itself.
- The Asset ID does not change: the row never left, so nothing renumbers.
- Both the delete and the restore appear in the history with the status
  either side of them.

`tests/test_restore.py` covers the round trip, the legacy no-status case,
the refusals, and that a restored asset still holds its serial.

## History: what happened to an asset

`created_by` / `updated_by` on the asset hold only the **most recent** write.
Everything before it was overwritten, which left the questions a register is
actually asked — who had this laptop before, when did it move site, why is
it SCRAP — unanswerable from the data.

`models.AssetEvent` (table `asset_events`) is the trail. Two ways to read
it, both open to either role:

- **`GET /api/assets/{id}/history`** — one asset's events, newest first,
  with the asset itself alongside them so the detail page renders its header
  from one request. Backs the History detail page and the edit modal's panel.
- **`GET /api/assets/history`** — **one row per asset** that has history,
  most recently changed first, with `q` / `action` / `actor` / `field` /
  `from` / `to` filters and `limit`/`offset` paging. Backs the History list.
  Registered as a **static rule** so Werkzeug matches it ahead of `/{id}`.

**Why the list groups by asset.** A flat feed of every event is the obvious
shape and the wrong one: a register of any age produces thousands of
individual changes, the same asset repeats down the page, and the question
people actually arrive with ("what has happened to this laptop?") gets
harder rather than easier. So the list reads like the asset list — an asset
per row, with how many changes it has and what the latest one was — and the
trail itself is one click away on its own page.

Each row carries its **latest matching** event and a count of **matching**
changes, not simply its latest: under `action=deleted` a row must summarise
the delete it was found by, not whatever happened to the asset afterwards.
`crud.list_history_by_asset()` does that with a `row_number() OVER
(PARTITION BY asset_pk ...)` window function rather than fetching every
event for the page and reducing in Python — a heavily edited asset can carry
hundreds and none but the newest would be used. Supported by PostgreSQL and
by SQLite since 3.25 (verified against both). The change counts are a second
query scoped to the page's assets, so it stays small however big the table
gets.

Filtered and paged **in the database**, unlike `GET /api/assets`, which
returns everything for the frontend to filter. The register has a known
size; this table grows with every edit anyone makes and has no ceiling, so
shipping all of it to the browser would get slower every week the app is
used. `limit` is clamped to 500 so a caller cannot ask the server to build
an unbounded response, and the asset is **outer** joined, so an event whose
asset has since gone still appears rather than vanishing from the trail.

**Shape: one row per changed field** for an edit, and one field-less row for
a whole-asset event (`created`, `imported`, `deleted`, `restored`). So
"Department: ACCOUNTS → FACILITY" is directly queryable, without writing
twenty near-identical rows every time an asset is created.

Written at the same choke points that apply the change — `create_asset`,
`update_asset`, `delete_asset`, `restore_asset`, `bulk_import_assets`,
`update_assets` — all through `record_event()` / `record_field_changes()`,
so a write path cannot quietly skip it. The events are added to the caller's
session and carried by its commit, so an event can never survive a change
that was rolled back.

What is deliberately **not** recorded:

- **Derived columns.** `make`, `availability` and `service_tag` are
  recomputed from model, status and description on every write, so logging
  them would double every entry with a consequence of the line above it.
- **`asset_id`.** It shifts whenever an earlier asset is deleted — that is
  renumbering, not a change to this asset. The ID as it stood *is* stored on
  each event (`asset_number`), so an old entry stays readable against what
  was on screen at the time.
- **A save that changed nothing.** A re-submitted form writes no rows.
- **Blank versus absent.** Clearing an already-empty optional field is not a
  change; both compare as no value.

Append-only: nothing updates or deletes a row. The single exception is
"Clear all data", which empties the register and takes the history with it —
every event there describes an asset that no longer exists, and the next
upload immediately reissues those Asset IDs to different machines.

There is **no foreign key** to `assets.id`, for the same reason the master
tables have none: a constraint that can reject a write to the audit trail
would mean losing the record of what happened rather than the other way
round.

**History starts when this was added.** An asset untouched since then shows
nothing, which the UI says rather than implying nothing ever happened.

`tests/test_history.py` covers what is recorded, what isn't, and that a
bulk-imported event points at its own asset (Asset.id is assigned by the
flush, so an event written too early would point at nothing).
`tests/test_register_history.py` covers the list: one row per asset however
often it changed, the summary describing the *matching* change under a
filter, paging that neither repeats nor drops an asset, the clamp, and that
the static route is not read as an asset whose id is "history".

## Finding one asset: `GET /api/assets/lookup`

Turns whatever was put in front of a reader into the record: a scanned QR
label from this app, a scanned or typed serial number, a service tag, a
computer name off a sticker.

**Reducing a scan to an identifier.** A 2D reader in keyboard-wedge mode
types the *whole* multi-line QR payload — or stops at the first newline,
depending on configuration. Both have to work, and both start with the Asset
ID, so `crud.parse_lookup_query()` takes the first line when it looks like
one. It also falls back to a `Srl:` or `Tag:` line, so a scan of some other
system's label that happens to carry one still resolves. The token it
settled on comes back in `query`, so the UI can say what it actually
searched for rather than echoing a wall of scanned text.

**Order is the whole design.** Asset ID, then serial number, then service
tag, then computer name — strongest first, so a value that could be two
things resolves to the more specific one. `tests/test_lookup.py` pins that
with an asset whose computer name is another asset's Asset ID.

**Computer names are not unique** (13 are shared by genuinely different
machines in the reference register), so that match may return several and
the response says so rather than silently picking one. A partial name match
is offered last for a half-readable sticker, labelled `assetTagPartial` so
the caller can present it as a guess.

**A deleted asset is still findable.** Scanning a machine that turns out to
be scrapped must show it — that is the answer the person needs, not "not
found".

## Login accounts from a bulk upload

`POST /api/assets/bulk` with `createUsers: true` also creates a `user`
account for each person named in the **Assigned User** column. That column
already holds the roster, so it saves entering several hundred people by
hand — but it was written to identify each asset's custodian, not to be an
identity source, and the difference shows. Measured against the reference
register (582 distinct values):

**First names are not unique — so usernames are `first.last`.** 84 first
names are shared, covering 224 of 582 values; seven different people are
called AMIT. Usernames are unique in the database, so a first-name rule
would have given one Amit an account and silently merged or dropped the
other six. The dotted form is uniform for everyone, and adding another Amit
later never disturbs an existing username. A genuine full-name clash falls
back to `first.last2`.

**Not every value is a person.** `SOLD TO PAWAN KUMAR JAIN`, `KSS OFFICE`,
`SERVICE-ECOSPACE`, `ACCOUNTS AUDITOR06` all appear. Those are skipped —
and **reported, never silently dropped**, because it is a heuristic and an
admin may know better. 12 of 582 are skipped on the real data.

**Two shapes needed real handling**, both found by running this over the
live register rather than by reasoning about it:

- A **job title tacked onto a name** — `ROHIT GHOSH IT TRAINEE`. The surname
  comes from the last word, so left alone this produced `rohit.trainee`;
  treating "trainee" as a non-person instead denied accounts to five real
  employees. The title is stripped (`_TITLE_WORDS`) and the person kept.
- A **role outside the bracket and the person inside it** —
  `AUDITOR [SHIV PRAKASH DADICH]`, `DEO1 [RAJU SARDAR]`. Taking the outside
  would give the role a login and the person none. `clean_person_name()`
  prefers the outside, and falls back to the bracketed text when the outside
  is a role — while still discarding a bracketed *note*, as in
  `SAMRAT PAL [RESIGEND]`.

### The shared password is not a way in

Every account is created with `NEW_USER_DEFAULT_PASSWORD` and
`must_change_password = true`. While that flag holds, `token_required`
refuses **every endpoint** except `GET /api/auth/me` and
`PATCH /api/auth/me/password` with `403` and
`code: "must_change_password"`. So the shared password reaches the
change-password screen and nothing else, and stops working for each person
the moment they choose their own. Re-entering the shared default as the
*new* password is refused too — otherwise the requirement is satisfied by
retyping what everyone already knows.

Enforced in the decorator, not the frontend: a hidden screen is not a
permission. Accounts that predate this have the flag `false`, so nobody is
locked into a change-password screen on their next sign-in.

**Off unless asked for.** An upload's job is to load assets; several hundred
sign-ins appearing as a side effect is not something to discover afterwards.
The response carries `accounts: { created, skipped, defaultPassword }` —
null when it wasn't requested — and existing accounts are never touched:
not renamed, not reset, not reactivated.

`tests/test_users_from_upload.py` covers the name shapes, the collision
case, and that a new account can sign in and reach nothing.

## QR labels: `POST /api/assets/qr`

Labels for the records selected in the Report Section, in either register.
The response carries the code plus the fields the sticker prints beside it —
the register ID and the serial number — so a scratched or smudged sticker is
still identifiable by eye. The printed geometry is the frontend's business;
see `frontend/README.md`.

**Generated on the server** (`app/qrcodes.py`, [segno](https://pypi.org/project/segno/),
pure Python, no native dependency). Two reasons: the payload is built from
the authoritative record rather than from whatever copy the browser is
holding, and QR encoding — Reed-Solomon, masking, format-info bit packing —
is not worth hand-writing.

**The code carries the data, not a link — which is what makes it
universal.** Any phone camera or scanner app decodes plain text and shows
it: no app, no login, no network, no connection to this system. A URL would
only work for someone who can reach the server and is signed in, which is
precisely not the person standing in a store room holding the laptop. The
trade-off is that a code is a **snapshot** — reprint the label if the asset
is reassigned.

**The code carries what stays true of the machine.** Which device it is
(register ID, name, model, serial, service tag, type), what it is (type,
status), and who bought it and when (department, company, PO, purchase,
warranty, joining date, notes). Two groups are deliberately left out:

- **Who has it** — the assigned user, and their email. A sticker is a
  snapshot and a machine is reassigned far more often than it is
  relabelled, so a carried name goes wrong sooner than anything else on the
  label. It is also the one field that is a fact about a *person* rather
  than about the machine, on a code anyone who can see the sticker can read
  — including someone with no business knowing whose laptop it is.
- **Where it is** — site, floor, location. Same reason: the sticker travels
  with the machine, so the moment it is carried to another desk the
  placement printed on it is a lie.

The register answers both live, and correctly. Both were carried until a
label was looked at and the printed placement was already out of date.

**Dropping them made every sticker easier to scan.** A QR's module count
grows with its payload, and measured over all 629 assets:

| | worst case | at the printed 20 mm |
|---|---|---|
| carrying them | v13, 69×69 | 0.290 mm per module |
| as it is now | v10, 57×57 | **0.351 mm** (+21%) |

All 629 got coarser and the spread moved from v10–13 to v7–10. Both figures
are under the 0.5 mm rule of thumb usually quoted for handheld imagers, so
they were verified by decoding rather than assumed; frontend/README.md has
the test, the error-correction trade-off table and the caveats.

**Free text is capped** (`MAX_FREE_TEXT`). `comments` allows 2000
characters, and one verbose note would push that asset's code past any
usable sticker size — discovered only at the printer. Today's longest note
is 47 characters, so the cap cuts nothing; it is there so that cannot change
silently.

**Anyone who can see the sticker can read it.** That follows directly from
the code being universally scannable, so what goes in is a standing
decision, not an accident. A passer-by with a phone now gets the device's
identity, its department, its company and its PO number — but no name, no
address and no room. Narrow it further by dropping fields from
`qr_payload()`.

`MAX_CODES` (250) caps one request: each label is several kB of SVG, and an
unbounded selection would build a response of many megabytes.

**Verified by decoding, not by inspection.** Every label in the live
register round-trips to its exact payload: **629/629**, rasterised onto the
dot grid a 300 dpi printer lays down at 20 mm and decoded with the same
jsQR the app's camera scanner uses (`frontend/src/vendor/jsqr/`). The
densest still reads at 15 mm, at 203 dpi, and with the quiet zone cut to
1 mm. An earlier run of the same check against the longer payload used
[zxing-cpp](https://pypi.org/project/zxing-cpp/) and also passed 631/631,
while OpenCV's `QRCodeDetector` managed 579/631 on those images — a known
quiet-zone weakness of that detector rather than a fault in the codes.

Those runs need a rasteriser and a decoder, so they are done when the
payload changes rather than kept as a test dependency.
`tests/test_qr_codes.py` covers the part this app owns: which fields go in,
which are deliberately kept out, that blanks are omitted, that shortening
the payload really does coarsen the code, and the endpoint's contract.

## Bulk edit: `PATCH /api/assets/bulk`

One change applied to many assets — a floor move, a department transfer, a
batch coming back into stock. The Report Section already had multi-select
for the scan queue; this reuses it.

Same permission as editing one asset (**both roles**): a relocation is
exactly the work a `user` account is for, and doing it forty times one modal
at a time is what makes people keep a private spreadsheet instead.

The rule that makes it safe to use: **a blank value is dropped, not
written**. An untouched box in the bulk form means "leave it alone", never
"empty this on forty assets" — emptying Department across a selection by
tabbing past a box is far easier to do than to notice. There is deliberately
no way to clear a field in bulk; the single-asset editor still can.

Also refused or ignored:

- **`srl`** — a serial identifies one device, so one value across many
  assets is never right. `422` pointing at the scan queue.
- **Server-assigned keys** (`assetId`, `make`, `availability`,
  `previousStatus`) — dropped, like everywhere else.
- **`SCRAP`** — reachable only by deleting, one asset at a time.
- **Deleted assets in the selection** — skipped and counted, so their fields
  don't drift out of step with their SCRAP status.

A validation failure rejects the **whole batch** rather than half-applying
it; this is one transaction, unlike bulk import, where per-row leniency is
the point. The response separates `updated` from `unchanged` (assets that
already held the value) so the count on screen adds up, and reports
`skippedDeleted` and `notFound`.

`tests/test_bulk_edit.py` covers all of it, including that blanks don't
clear and that a bad value leaves every asset untouched.

## Warranty / AMC (`warranty_end`)

An optional `yyyy-mm-dd` column, validated and cleaned exactly like `dop`
and `assigned_date`, and **never derived from the purchase date** — a warranty length
is a contract term the register cannot infer. An asset without one reads as
"not recorded", never as "in warranty".

The states and the dashboard counts are computed client-side in
`frontend/src/lib/warranty.js` (there is no server-side duplicate of the
rule). It also derives **age from `dop`**, which the register already has
for most assets — so "how much of the fleet is over five years old" is
answerable with no new data entry, while the warranty numbers fill in as
dates are added. Being a plain schema column, it appears in the entry form,
the Report Section, the exports and the upload template automatically.

## Duplicate detection on bulk import

Uploading the same file twice used to append a complete second copy of it.
Duplicate checking is now **on by default** — `dedupeKey` omitted or `null`
means "skip anything already in the register", decided in two layers:

1. **Service tag.** `derive_service_tag()` extracts the bracketed token
   that real registers put in the description — `Dell Latitude 3520
   [570RLG3]` — into the indexed `service_tag` column. It is the device's
   own identity, so a row is recognised even if other cells were edited
   since the last upload. ~99% of rows in the reference register carry one.
2. **Whole-row content.** For rows with no service tag, `content_fingerprint()`
   compares every field the file supplies (case- and padding-insensitive,
   excluding the server-assigned columns so an incoming row can match a
   stored one at all). Only an exact match counts as already present.

The register is read **once per import** and shared by the duplicate check
and the serial-number check, which both need every asset — it used to be
scanned twice. `DuplicateIndex` builds both maps from that load and registers each
accepted row as it goes, so a file that repeats a row internally imports it
once.

**Why not Computer / Asset Name.** It is the obvious key and it is wrong
for this data: 13 Computer names in the reference register belong to
genuinely different machines (different models, service tags and users), so
matching on it drops real assets — a 632-row file loads as 618. It is still
selectable as an explicit `dedupeKey`, labelled unsafe in the UI. Neither
layer above can confuse two different machines.

Other `dedupeKey` values: `"none"` imports everything including duplicates;
a field key (`assetTag` / `srl` / `poNo`) does the legacy single-column
match.

`service_tag` is deliberately **not** part of the frontend schema, so it
adds no column to the Report Section or the exports. Existing rows are
backfilled at startup by `crud.backfill_service_tags()`, scoped to
descriptions containing a bracket so it is idempotent.

## Asset IDs

Every asset carries an `asset_id` — `AMB` + 6 digits, starting at
`AMB000001` — which is the register's own identifier, as opposed to `srl`
(the serial number on the device) or `id` (the internal uuid).

**Always contiguous: 1..N with no gaps.** Deleting an asset shifts every
later one down to close the hole (`compact_asset_ids()`, called from
`delete_asset()`), so the sequence never has a break in it. Relative order
is preserved — assets keep their sequence, they just close up. The same
function runs once at startup, so a register that already has a gap heals
itself, and it parks the counter at N+1.

Renumbering runs in **two phases** — every affected row is parked on a
temporary value, then settled on its final one — because `asset_id` carries
a UNIQUE index and a single-pass shift would transiently collide the moment
a new number matches one another row still holds.

**What this trades away.** An Asset ID is *positional*, not permanent: when
something earlier is deleted, a number moves to a different asset. So a
printed label tracks a position in the register rather than one fixed
machine, and an Asset ID quoted in a ticket or an exported report can refer
to a different asset later. That is a deliberate choice, made because the
register is read as an ordered list and gaps in it were not wanted. If
permanence ever matters more than tidiness, the service tag
(`service_tag`) is the stable per-machine identifier and does not move.

Numbers still come from a stored counter row (`models.Counter`, table
`counters`) rather than `max(asset_id) + 1`, so allocation stays correct
when the register is empty.

**"Clear all data"** empties the table and calls
`reset_asset_id_counter()`, so the bulk upload that follows repopulates an
empty database from `AMB000001`. The reset is scoped to assets — master
tables and user accounts are untouched.

It is **password-confirmed**: `DELETE /api/assets` requires
`{"password": "..."}` in the request body, checked against the caller's own
account hash with `verify_password`. Missing or blank gives `400`, a
mismatch gives `401`, and in both cases nothing is deleted. Admin role is
still required and is checked first, so a non-admin gets `403` even with a
correct password. This is the one irreversible action in the app — a
per-asset delete keeps the record — so it asks for something only the
account holder can supply rather than relying on a dialog nobody reads. A
DELETE carrying a body is unusual but legal, and it keeps the endpoint
where clients already expect it.

**Cost note.** Every delete rewrites the Asset ID of each asset after the
deleted one, so deleting the first of N assets is an N-row update. That is
comfortable at this register's size (hundreds); at tens of thousands it
would want the targeted shift instead of a full compaction.

`next_asset_id()` bumps the counter inside the caller's transaction (so a
failed insert cannot burn an ID) under `SELECT ... FOR UPDATE` on
PostgreSQL. A counter table rather than a PostgreSQL `SEQUENCE` so the same
code runs against the SQLite database the tests use.

**The server owns the value.** `assetId` is in `crud.SERVER_ASSIGNED_KEYS`,
so a value sent by a client is ignored on create, on `PATCH`, and in a
bulk-imported row. Re-importing a file exported from this system does not
bring its old IDs back — which is what makes the rules above hold through
the importer too.

**Existing databases** are migrated at startup, in two idempotent steps:
`main.ensure_asset_columns()` adds the column and its unique index to an
`assets` table that already exists (`create_all()` only ever creates whole
tables, never columns — see "Schema management" below), then
`crud.backfill_asset_ids()` numbers the existing rows oldest-first, ties
broken on numeric `srl`, so an established register is numbered in the
order it was originally entered.

## Derived columns: `make` and `availability`

Neither is ever entered by hand. Both are recomputed from another column on
every write, in `crud._apply_asset_fields` — the single point create,
`PATCH` and bulk import all go through, so neither can be left stale by a
caller that forgot:

| Column | Rule |
|---|---|
| `make` | first word of `model`, uppercased |
| `availability` | `INACTIVE` if the status contains `SOLD`, else `ACTIVE` |

**Why uppercase.** The register writes the same manufacturer both ways —
"Lenovo ThinkPad" and "LENOVO THINKPAD", "Dell Latitude" and "DELL
LATITUDE". Taking the literal first word would make LENOVO and Lenovo two
different makes in every filter, chart and export. Uppercasing also matches
how the register spells its other categorical values (LAPTOP, ECOSPACE).

**Recomputed from the row, not the payload**, so a `PATCH` that changes
only `model` still moves `make`, and selling an asset flips `availability`
without touching anything else.

**Never accepted from a client.** Both sit in `crud.SERVER_ASSIGNED_KEYS`
alongside `assetId`, so a value in a request body or an imported file is
ignored. This is load-bearing with real data: the reference register has
its own Make column in which six rows contradict their model (four MacBook
Pros and a Sony recorded as "HP", an HP recorded as "Lenovo"), and the
derived value is the correct one.

Existing rows are caught up at startup by `crud.backfill_derived_fields()`
after `main.ensure_asset_columns()` adds the columns — both idempotent.

## Master tables

Four asset fields are backed by their own table rather than a hard-coded
list: **Asset Type** (`asset_types`), **Status** (`asset_statuses`),
**Department** (`departments`) and **Company** (`companies`). They're four
physically separate tables with identical structure, defined once as
`models.MasterBase` (`__abstract__`, so SQLAlchemy copies its columns onto
each subclass) and tied to their field keys by `app/masters.py`. One
Blueprint serves all four — `/api/masters/<category>`, where `<category>`
is `type` | `status` | `department` | `company`. Full endpoint list in
`docs/API_CONTRACT.md` §7.

Columns: `id`, `name` (the literal value stored on the asset),
`description` (admin-facing note), `sort_order` (dropdown order),
`is_active`, `created_at`, `updated_at`.

**The asset columns are plain strings, not foreign keys.** That is
deliberate: the register is routinely bulk-imported from legacy
spreadsheets whose values predate any master list, and a foreign key would
reject those rows outright. The two sides are reconciled instead:

- **Unknown value on an asset write → registered.** Creating, updating or
  importing an asset whose type/status/department/company isn't in the
  master table adds it there, in the same transaction
  (`crud.sync_masters_from_rows`). This replaced the frontend's old
  per-browser `localStorage` "remembered options", so a value one person
  adds is visible to everyone. Bulk import sweeps the accepted rows once
  rather than per row, and rows that failed validation leave no master
  entry behind. It only ever inserts — a deliberately retired value is
  never reactivated by a later import.
- **Rename → assets rewritten.** `PATCH` with a changed `name` updates
  every asset carrying the old value in the same transaction and reports
  the count as `assetsUpdated`.
- **Delete → refused while in use.** `DELETE` returns `409` with an
  `inUse` count if any asset still references the value. Retire it instead
  (`isActive=false`): it disappears from the asset form's dropdowns while
  existing assets keep the value and stay exportable.

**Bulk add** (`POST /api/masters/<category>/bulk`, admin only, up to 1000
entries) exists so a whole list can be pasted in from a spreadsheet rather
than typed one value at a time. Same rules as the asset importer: one bad
entry never fails the batch, and every skip is reported as
`{row, reason}`. A value that already exists is a *skip*, not an error —
pasting a column that partly overlaps the current list is the normal case
— and it never modifies the row it collided with, so a repeat cannot
rename, re-describe, or reactivate an existing value.

**A fresh install creates these tables EMPTY.** The app ships no dropdown
values of its own — an earlier build seeded ~50 hard-coded ones lifted from
one reference spreadsheet, which is the wrong content for any other
deployment. The admin fills them from the Master Data screen (typing,
pasting a column, or uploading a spreadsheet), and any value arriving on an
imported asset registers itself, so a bulk upload populates them as a side
effect.

`crud.seed_masters()` still runs at startup but creates nothing of its own.
It covers one case: a master table that is empty *while the register
already holds assets using it* — an assets-only restore, or an upgrade from
a build that predates these tables. Then the values in use are adopted from
the data. On a genuinely fresh install there are no assets, so it does
nothing; and a table that already has rows is skipped, so an admin who
deliberately empties one is not overruled on the next restart.

The one row the system creates is **SCRAP** in the Status table
(`crud.ensure_reserved_statuses()`), retired so it never reaches the entry
form — a reserved value assigned by deletion, not user data.

Note this is exactly the kind of schema change the "no migration tool"
section below warns about, and it happens to be the easy case:
`create_all()` *does* create missing tables, so the four arrived on the
next restart with no manual step. A change to an existing table's columns
would not have.

**Adding a fifth master table** (e.g. for Site): add the model to
`models.py` (`class Site(MasterBase): __tablename__ = "sites"`) and one
`MasterSpec` to `MASTER_SPECS` in `masters.py`. No new endpoint, no CRUD
code, and no frontend change — the Master Data screen builds its tabs from
whatever `GET /api/masters` reports.

## User deletion: soft-delete

`DELETE /api/users/{id}` is implemented as a **soft-delete**: it sets
`isActive=false` rather than removing the row. This was chosen so that
`assets.createdBy` / `assets.updatedBy` history stays meaningful
(referencing a real, if deactivated, user) and so a mistaken deactivation is
trivially reversible via `PATCH /api/users/{id} { "isActive": true }`. An
inactive user cannot log in (`401` on `/api/auth/login`) and an
already-issued token for an inactive user is rejected on every subsequent
request (`token_required` checks `is_active` on every call).

### Clear all users: `DELETE /api/users`

The counterpart to clearing the asset register, and guarded identically —
the caller re-enters their **own account password**, because it is the same
kind of action: irreversible and one click from a screen they are already
on. A wrong password returns `401` with no `code`, so the frontend shows an
error rather than treating it as an expired session.

**The caller's own account is kept, and that is not a preference.** Sign-in
is the only way into this app, so deleting every row would lock everyone out
permanently, with no route back that does not involve editing the database
by hand. `crud.clear_all_users()` takes the id to keep as a required
argument for that reason.

**Other admins are deleted.** "All" means all; the confirmation dialog says
so explicitly rather than making a quiet exception that leaves someone with
access nobody expected.

**A hard delete, unlike the per-user one above.** The point is to empty the
table — a few hundred rows left behind as inactive would defeat it, which is
exactly the situation a half-finished bulk account import creates. Nothing
is orphaned: `assets.createdBy` / `updatedBy` and `asset_events.actor` are
plain usernames, not foreign keys, so the audit trail survives the account.

`tests/test_clear_users.py` pins all of it, including that the surviving
account can still sign in afterwards.

## Tests

```bash
pytest
```

Tests run against a throwaway file-based SQLite database (see
`tests/conftest.py`, which sets `DATABASE_URL` before any `app.*` module is
imported) so the suite stays fast and needs no database server — everything
it touches goes through SQLAlchemy and is portable across both engines. The
application itself runs on PostgreSQL, and that path has been verified
separately end to end (auth, CRUD, Asset ID allocation, validation, bulk
import de-duplication and role enforcement, with the rows confirmed in the
database). They cover:
login success/failure, `GET /api/auth/me`, changing your own password,
create/list/update an asset as `user`, deleting an asset as `user` (expect
`403`) vs. as `admin` (expect success and a real `204`), clearing all
assets, bulk import with `dedupeKey` (both in-batch duplicates and
duplicates against existing rows), invalid-row handling in bulk import,
Asset IDs (`tests/test_asset_ids.py`: format and sequence, that a deleted
ID is never reused — including after clearing the whole register — that an
asset deleted from the middle is re-registered at the end, that a
client-supplied `assetId` is ignored on create/PATCH/import, and that a
blank `srl` stays blank and can be filled in later), the derived columns
(`tests/test_derived_fields.py`: the two rules, that changing a model moves
the make and selling an asset flips availability, that an unrelated PATCH
leaves both correct, and that supplied/imported values are ignored),
admin-only user management (list/create/duplicate-username/deactivate), and
the master tables (`tests/test_masters.py`: seeding and curated order,
role enforcement, case-insensitive duplicate rejection, retire vs. delete,
the `409` for deleting an in-use value, the rename cascade onto assets, and
auto-registration from both single and bulk asset writes — including that a
skipped import row leaves no master entry behind and that a retired value
isn't revived).

## Non-functional notes

- Passwords are bcrypt-hashed via `passlib`, never logged, never returned in
  any response (`user_out_dict()` / `auth_user_dict()` / `me_dict()` simply
  never include the password hash).
- Malformed request bodies return `400` with a plain-text `detail` message
  (there's no automatic framework-level request validation the way
  FastAPI/Pydantic provided — every route checks its own required fields).
  Asset business-rule validation (required fields, email/date format)
  returns `422` with a list of messages in `detail`.
- Every mutating endpoint requires a valid JWT (`401` otherwise); role-gated
  endpoints return `403` for the wrong role.

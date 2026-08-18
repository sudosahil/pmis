# PMIS — Project Management Information System

A works, procurement and payments system for a state Public Works Department: from
administrative sanction, through tendering and award, to the running account bill and its
payment voucher. Built from the departmental documents in the root of this repository
(project masters specification, the RA bill and miscellaneous bill workflow notes, the
contractor registration form, and the e-Governance platform deck).

---

## Running it

Two processes. Node 20 or newer.

```bash
# API — http://localhost:4000
cd app/server
npm install
npm run db:seed      # creates data/pmis.db and fills it with a working department
npm run dev

# Web client — http://localhost:5173 (proxies /api to the server)
cd app/client
npm install
npm run dev
```

Then open <http://localhost:5173> and sign in. Every demonstration account uses the
password **`Pmis@12345`**:

| Username | Role |
| --- | --- |
| `admin` | System Administrator |
| `md.rao` | Managing Director |
| `ce.sharma` | Chief Engineer |
| `se.iyer` | Superintending Engineer |
| `ee.kumar` | Executive Engineer, North Gandhinagar Division |
| `aee.singh` | Assistant Executive Engineer |
| `ae.reddy` | Assistant Engineer |
| `ac.nair` | Account Clerk |
| `as.gupta` | Account Superintendent |
| `aao.menon` | Assistant Accounts Officer |
| `cao.desai` | Chief Accounts Officer |
| `auditor.bose` | Auditor (read only) |
| `contracts@shakticonstructions.example` | Contractor |
| `office@gangabuilders.example` | Contractor |

Each account lands on a different dashboard and a different approval inbox, because the
seed drives real approval chains rather than inserting finished records.

The repository root carries convenience scripts that reach into both projects:

```bash
npm run install:all   # install both projects
npm test              # server: vitest, against a throwaway SQLite file
npm run typecheck     # both projects
npm run build         # both projects
npm run db:seed
npm run db:reset      # drops and recreates the database (stop the dev server first)
```

---

## What it does

**Works.** Projects carry a code allotted once and never regenerated (`U-PLAN-KALBURGI-0615`,
the convention from the source documents), a sanction chain, milestones with weightage, and
physical and financial progress. A project breaks into packages, which are what actually get
tendered, awarded and billed.

**Procurement.** Tenders publish with a bill of quantities, take bids within a bidding window,
and run a two-envelope evaluation: financial bids stay sealed until technical evaluation
closes, then bids are ranked L1, L2, L3 and an award issues a Letter of Acceptance. Contractors
register themselves through a public form, are verified by the division office, and then bid
and bill through their own portal.

**Bills.** Running account bills reproduce the departmental form exactly: measurements against
the agreement, present quantity as cumulative less previously billed, the Executive Engineer's
certified admissible amount, ETP charges (establishment, tools & plant, contingency) applied to
that admissible amount, the statutory deduction schedule, net payable in words, and the project
expenditure position. Miscellaneous bills book office, travel, material and contingency
expenditure against government object heads, with the "be specific, not *Misc*" and
GST-invoice-above-threshold rules from the submission guidelines enforced at the boundary.

**Money.** Funds are released against schemes to divisions; divisions request letters of credit
to pay from.

**Approvals.** One workflow engine drives all of it. Every approvable record — project sanction,
tender approval, contractor registration, RA bill, miscellaneous bill, letter of credit — moves
along a chain of steps defined in the database, each step held by a role and scoped to a
division, circle, zone or head office. An officer can approve and forward, reject, return the
file to an earlier step for correction, or pin it to a named colleague. Every movement is
recorded with actor, timestamp and remarks, and shown as a timeline on the record itself.

The administrator designs those chains in the interface: add, rename, reorder and remove steps,
set who acts, in whose jurisdiction, within how many days, and whether they may return or reject.
Chains are versioned, so an edit never disturbs a file already moving — see below.

**Files.** A foldered departmental filing cabinet, plus attachments on individual records.
Uploads are checked against an allow-list of types, stored under a generated name, de-duplicated
by checksum, and served back only as attachments. A folder may be departmental-wide or pinned to
one division, and that decides who can see what is inside it.

**Messages.** Direct chats and group chats for every user, with unread counts, presence, and
notifications for anyone not currently online. Contractors can reach departmental staff but not
each other.

**Live activity.** The administrator and the auditor can watch the system as it is used: who is
online, what each person is doing, how the system answered and how long it took — in plain
words ("Certified RA bill 5"), not raw paths.

---

## How it is put together

```
app/
  server/          Node + Express + TypeScript, SQLite via better-sqlite3
    src/
      routes/      Express routers — auth, method and validation wiring only
      controllers/ Thin request handlers; no business logic
      services/    Business logic; no HTTP awareness
      models/      SQL; no business logic
      middleware/  Auth, zod validation, activity logging, centralised error handling
      config/      Environment, constants, the master registry
      db/          schema.sql, seed, reset
      utils/       Money, code generation, error helpers
  client/          React 19 + Vite + React Router + TanStack Query
    src/
      pages/       One file per screen
      components/  Shared UI, the approval panel, tables, modals, toasts
      api/         Fetch wrapper with silent token refresh
      context/     Session
      styles/      One stylesheet, no framework
```

### Money is never a float

SQLite has no `DECIMAL`, and a bill that is out by a paisa is a bill that gets returned. So
below the HTTP boundary everything is an integer:

- **money** is paise (`₹5,000.00` → `500000`),
- **percentages** are basis points (`2.50%` → `250`),
- **quantities** are scaled by a thousand (`12.345 cu.m` → `12345`).

Conversion happens only in the zod layer on the way in and the presenter on the way out.
`src/utils/money.ts` holds the arithmetic, and `money.test.ts` locks it down — including the
worked example from the source bill form, where 2% + 3% + 4% on an admissible amount of ₹5,000
comes to exactly ₹450.

### One registry for fourteen masters

Zones, circles, divisions, sub divisions, districts, towns, scheme types, schemes, work types,
project categories, banks, ETP charges, deduction types and expense categories are all
described as metadata in `src/config/masters.ts`. One controller, one service and one set of
routes serve all fourteen; the definitions are also served to the client, which renders the
list, the form and the validation from the same description. Adding a master is a data change.

### One workflow engine, and how editing a chain stays safe

Workflow definitions and their steps live in the database. Domain services never import the
engine's internals and the engine never imports a domain service — instead each domain
registers an outcome handler (`registerOutcomeHandler('RA_BILL', …)`) that the engine calls when
a chain finishes, which is what keeps the dependency graph acyclic.

A file always follows the chain that was in force when it was raised. That promise is what makes
the chains editable at all. Definitions are versioned (`code` + `version`, with one `is_current`
row per code), and a structural edit behaves differently depending on what is in flight:

- **Nothing in flight** — the steps are rewritten in place and the version is left alone.
- **Files in flight** — the current version is superseded rather than changed. It keeps its steps
  and its files, a new version becomes current, and everything raised from then on uses it.

Renaming a chain, re-describing it or deactivating it touches no structure and is always allowed.
A chain that has never carried a file can be deleted; one that has must be deactivated instead,
so its history stays readable.

### Two logs, deliberately

`audit_log` is the permanent record of business events, written by the services in the
department's own language: *RA bill certified*, *contractor blacklisted*, *payment recorded*. It
is what an auditor reads.

`activity_log` is the technical log, written by middleware for every authenticated API call:
method, path, status, duration, IP. It is what an administrator watches live to see who is on the
system and what they are doing. Each line carries a readable summary produced by a route table
(`middleware/describe-request.ts`, unit-tested), so the feed reads as sentences rather than URLs.
Polling endpoints are excluded so the log does not fill with its own noise, and entries can be
pruned on a retention window.

### Uploads

Files are buffered in memory, checked against an allow-list keyed on **both** MIME type and file
extension, hashed, then written under a generated UUID name — the name the user typed is metadata
and never touches a path. Downloads go out with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`, and the resolved path is re-checked to be inside the upload
root before any bytes are read. Deleting a record only unlinks the bytes when no other row points
at them.

### Reference numbers

Bill numbers, DBR numbers, tender numbers, LOAs, work orders, LOC numbers and Tally vouchers
are all allotted from an atomic counter table, keyed by division and financial year (the Indian
April–March year). The seed advances every counter past the fixtures it inserts, so the first
record you raise through the UI cannot collide with a demonstration record.

### Security

- Passwords: bcrypt, cost 12. New and reset accounts must change theirs at first sign-in.
- Sessions: short-lived JWT access tokens with rotating refresh tokens, stored hashed.
- Every write is validated by zod at the boundary; every query is parameterised.
- `helmet`, CORS allow-listing, and rate limits on sign-in and on public registration.
- Errors are centralised — clients get a message and a code, never a stack trace.
- Role and geography decide visibility: a division's staff see their division's work, and the
  head-office cadre sees everything.
- Everything that changes a record writes an audit entry.

### The interface

Plain government-office styling, on the assumption that it will be used all day by people who
did not choose it: institutional navy, one accent, high contrast, always-visible field labels,
tabular numerals in every money column, and a status word inside every status badge so meaning
survives a greyscale printout. Bill screens carry a print stylesheet that renders the voucher
alone. Motion respects `prefers-reduced-motion`.

---

## Source documents

The requirements this was built from are five departmental documents. They are **not kept in
version control** — they are the client's originals and stay outside the repository. Place them
in the repository root if you need them alongside the code; `.gitignore` already excludes them.


| File | What it fixed |
| --- | --- |
| `Project Masters_PMIS.docx` | The master data dictionary — every field of all fourteen masters |
| `Work Flow screenshot for RA Bills.docx` | The RA bill chain, the bill form layout, and the ETP worked example |
| `Work Flow screenshot for Mischellanous Bills.docx` | The AC → AS → EE → CAO → Tally chain |
| `Contractor Registration Form and Misc Bill Creation Form.xlsx` | Registration fields, expense categories, government object heads |
| `Atraya_e2e_eGovernance_PPT_v1.0.pptx` | Platform scope and module list |

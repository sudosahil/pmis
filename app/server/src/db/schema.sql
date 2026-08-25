-- ============================================================================
-- PMIS — Project Management Information System
-- Schema for government works, procurement and bill management.
--
-- CONVENTIONS
--   * Money is stored as INTEGER paise (1 rupee = 100 paise). Never floats.
--     The API accepts and returns rupees; conversion happens at the boundary
--     (see src/utils/money.ts and the `rupees` zod helper).
--   * Percentages are stored as INTEGER basis points (2.50% = 250 bps).
--   * Timestamps are TEXT in UTC, ISO-ish 'YYYY-MM-DD HH:MM:SS' via datetime('now').
--   * Dates without a time component are TEXT 'YYYY-MM-DD'.
--   * Every table carries created_at/updated_at; updated_at is maintained by trigger.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. IDENTITY AND ORGANISATION
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  scope         TEXT NOT NULL DEFAULT 'STAFF',   -- STAFF | EXTERNAL | SYSTEM
  hierarchy     INTEGER NOT NULL DEFAULT 0,      -- higher = more senior
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  state_region  TEXT,
  zone_head     TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS circles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  zone_id         INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  authority_level TEXT,                          -- Chief Engineer / Superintending Engineer
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_circles_zone ON circles(zone_id);

CREATE TABLE IF NOT EXISTS divisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  circle_id       INTEGER NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
  head_of_division TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  effective_date  TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_divisions_circle ON divisions(circle_id);

CREATE TABLE IF NOT EXISTS sub_divisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  division_id       INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  jurisdiction_area TEXT,
  reporting_officer TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_divisions_division ON sub_divisions(division_id);

CREATE TABLE IF NOT EXISTS districts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  state_name    TEXT,
  pincode_from  TEXT,
  pincode_to    TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS towns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  district_id     INTEGER NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
  classification  TEXT,                          -- Metropolitan / Municipality / Village
  population      INTEGER,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_towns_district ON towns(district_id);

-- ---------------------------------------------------------------------------
-- 2. CLASSIFICATION AND BUDGET MASTERS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheme_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,                   -- Centrally Sponsored / State Plan
  category      TEXT,                            -- Infrastructure / Social Sector / Education
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schemes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  scheme_type_id  INTEGER NOT NULL REFERENCES scheme_types(id) ON DELETE RESTRICT,
  funding_agency  TEXT,                          -- Central Govt / State Govt / World Bank
  start_date      TEXT,
  end_date        TEXT,
  budget_head_code TEXT,
  objective       TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schemes_type ON schemes(scheme_type_id);

CREATE TABLE IF NOT EXISTS work_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  sector        TEXT,                            -- PWD / Irrigation / Health
  uom           TEXT,                            -- Km / Sq.m / Meters
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_categories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,               -- Major Project / Minor Works
  threshold_value   INTEGER NOT NULL DEFAULT 0,  -- paise; minimum contract value
  approval_authority TEXT,                       -- Chief Engineer / Cabinet Approval
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  short_name          TEXT,
  ifsc_code           TEXT,
  micr_code           TEXT,
  head_office_address TEXT,
  official_contact    TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Establishment, Tools & Plant charge heads recovered from works bills.
CREATE TABLE IF NOT EXISTS etp_charges (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  charge_type         TEXT NOT NULL DEFAULT 'RECOVERY',  -- DEDUCTION | RECOVERY | LEVY
  rate_bps            INTEGER NOT NULL DEFAULT 0,        -- basis points
  basis_of_calculation TEXT,                             -- Gross Bill Value / Admissible Amount
  effective_date      TEXT,
  govt_reference      TEXT,
  account_head        TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Statutory / contractual deductions applied to bills (GST TDS, IT TDS, SD, etc.)
CREATE TABLE IF NOT EXISTS deduction_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  basis         TEXT NOT NULL DEFAULT 'PERCENT',  -- PERCENT | AMOUNT
  rate_bps      INTEGER NOT NULL DEFAULT 0,
  applies_to    TEXT NOT NULL DEFAULT 'RA',       -- RA | MISC | BOTH
  account_head  TEXT,
  is_statutory  INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Miscellaneous expenditure categories mapped to government object heads.
CREATE TABLE IF NOT EXISTS expense_categories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  parent_code       TEXT,
  govt_object_head  TEXT,                         -- OE / DTE / M&S / Hospitality
  bill_category     TEXT NOT NULL DEFAULT 'PROJECT_EXPENSE',
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expense_categories_parent ON expense_categories(parent_code);

-- ---------------------------------------------------------------------------
-- 3. CONTRACTORS (vendor master + self-registration)
-- ---------------------------------------------------------------------------

-- The departmental Schedule of Rates. Every BOQ item is priced against one of
-- these, so an agreed rate can always be compared with the sanctioned rate.
-- The Schedule of Rates: the government's approved baseline price for every
-- item of work. It is what an estimate is priced from, what a bid may not
-- exceed, and what a running bill is verified against.
CREATE TABLE IF NOT EXISTS schedule_of_rates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,             -- SR item number, e.g. 4.11.2
  name           TEXT NOT NULL,                    -- the item of work, as printed in the SR
  chapter        TEXT,                             -- e.g. Earthwork, Concrete, Pipeline
  uom            TEXT NOT NULL DEFAULT 'Nos',
  rate           INTEGER NOT NULL DEFAULT 0,       -- paise
  sr_year        TEXT NOT NULL DEFAULT '2024-25',  -- the SR edition this rate belongs to
  effective_date TEXT,                             -- when the rate took effect
  govt_reference TEXT,                             -- the circular or order that set it
  status         TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schedule_of_rates_chapter ON schedule_of_rates(chapter);
CREATE INDEX IF NOT EXISTS idx_schedule_of_rates_year ON schedule_of_rates(sr_year);

-- Every movement of a Schedule of Rates line, kept permanently.
--
-- A rate is a financial control: an agreement signed against the old rate and a
-- bid rejected against the new one both have to be explicable years later. So
-- the row is never simply overwritten — the previous value is written here
-- first, alongside the circular that authorised the change. The item's code and
-- name are copied rather than joined, so the history still reads after the
-- master row itself is gone.
CREATE TABLE IF NOT EXISTS schedule_of_rate_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sr_item_id     INTEGER REFERENCES schedule_of_rates(id) ON DELETE SET NULL,
  sr_code        TEXT NOT NULL,
  sr_name        TEXT NOT NULL,
  chapter        TEXT,
  uom            TEXT,
  change_kind    TEXT NOT NULL,   -- CREATED | RATE_REVISED | EDITION_CHANGED | RENAMED | STATUS_CHANGED | DELETED
  old_rate       INTEGER,         -- paise; null when the item was created
  new_rate       INTEGER,         -- paise; null when the item was deleted
  old_sr_year    TEXT,
  new_sr_year    TEXT,
  old_status     TEXT,
  new_status     TEXT,
  effective_date TEXT,
  govt_reference TEXT,
  remarks        TEXT,
  changed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sr_history_item ON schedule_of_rate_history(sr_item_id);
CREATE INDEX IF NOT EXISTS idx_sr_history_code ON schedule_of_rate_history(sr_code);
CREATE INDEX IF NOT EXISTS idx_sr_history_kind ON schedule_of_rate_history(change_kind);
CREATE INDEX IF NOT EXISTS idx_sr_history_changed_by ON schedule_of_rate_history(changed_by);

CREATE TABLE IF NOT EXISTS contractors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  contractor_type     TEXT,                       -- Proprietorship / Partnership / Pvt Ltd
  registration_class  TEXT,                       -- Class A / B / C
  registration_no     TEXT,
  eproc_no            TEXT,
  pan                 TEXT NOT NULL,
  gstin               TEXT,
  contact_person      TEXT,
  email               TEXT NOT NULL,
  phone               TEXT,
  building            TEXT,
  street              TEXT,
  area                TEXT,
  city                TEXT,
  state               TEXT,
  country             TEXT DEFAULT 'India',
  zip_code            TEXT,
  bank_id             INTEGER REFERENCES banks(id) ON DELETE SET NULL,
  bank_branch         TEXT,
  bank_account_no     TEXT,
  bank_account_type   TEXT,                       -- Savings / Current
  ifsc_code           TEXT,
  tds_rate_bps        INTEGER NOT NULL DEFAULT 200,
  is_blacklisted      INTEGER NOT NULL DEFAULT 0,
  validity_date       TEXT,
  registration_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | VERIFIED | APPROVED | REJECTED
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  remarks             TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contractors_bank ON contractors(bank_id);
CREATE INDEX IF NOT EXISTS idx_contractors_status ON contractors(registration_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractors_pan ON contractors(pan);

-- ---------------------------------------------------------------------------
-- 4. USERS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  employee_code   TEXT,
  designation     TEXT,
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  phone           TEXT,
  zone_id         INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  circle_id       INTEGER REFERENCES circles(id) ON DELETE SET NULL,
  division_id     INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  sub_division_id INTEGER REFERENCES sub_divisions(id) ON DELETE SET NULL,
  contractor_id   INTEGER REFERENCES contractors(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | INACTIVE | LOCKED
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_login_at   TEXT,
  last_seen_at    TEXT,                             -- refreshed by the activity middleware
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_code);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_users_division ON users(division_id);
CREATE INDEX IF NOT EXISTS idx_users_circle ON users(circle_id);
CREATE INDEX IF NOT EXISTS idx_users_zone ON users(zone_id);
CREATE INDEX IF NOT EXISTS idx_users_sub_division ON users(sub_division_id);
CREATE INDEX IF NOT EXISTS idx_users_contractor ON users(contractor_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  detail      TEXT,
  ip_address  TEXT,
  request_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ---------------------------------------------------------------------------
-- 5. WORKFLOW ENGINE (shared by projects, tenders, bills, LOC, registrations)
-- ---------------------------------------------------------------------------

-- A chain is versioned. Editing the steps of a chain that has files in flight
-- supersedes the row rather than mutating it, so a file always finishes on the
-- chain that was in force when it was raised.
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  is_current   INTEGER NOT NULL DEFAULT 1,        -- exactly one current row per code
  name         TEXT NOT NULL,
  entity_type  TEXT NOT NULL,                     -- PROJECT | TENDER | RA_BILL | MISC_BILL | ...
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  superseded_at TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definitions_current
  ON workflow_definitions(code) WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS workflow_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  role_code     TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  scope         TEXT NOT NULL DEFAULT 'DIVISION', -- DIVISION | CIRCLE | ZONE | GLOBAL
  sla_days      INTEGER NOT NULL DEFAULT 3,
  allow_return  INTEGER NOT NULL DEFAULT 1,
  allow_reject  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (definition_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_definition ON workflow_steps(definition_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_role ON workflow_steps(role_code);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id     INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  entity_type       TEXT NOT NULL,
  entity_id         INTEGER NOT NULL,
  entity_ref        TEXT,                         -- human readable label for the inbox
  title             TEXT,
  amount            INTEGER NOT NULL DEFAULT 0,   -- paise; shown in the approval inbox
  current_step_id   INTEGER REFERENCES workflow_steps(id) ON DELETE RESTRICT,
  assigned_role     TEXT REFERENCES roles(code) ON DELETE SET NULL,
  assigned_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS | APPROVED | REJECTED | CANCELLED
  division_id       INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  circle_id         INTEGER REFERENCES circles(id) ON DELETE SET NULL,
  zone_id           INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  initiated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_at            TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wf_instances_definition ON workflow_instances(definition_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_entity ON workflow_instances(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_step ON workflow_instances(current_step_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_assignee ON workflow_instances(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_inbox ON workflow_instances(status, assigned_role, division_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_initiator ON workflow_instances(initiated_by);
CREATE INDEX IF NOT EXISTS idx_wf_instances_division ON workflow_instances(division_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_circle ON workflow_instances(circle_id);
CREATE INDEX IF NOT EXISTS idx_wf_instances_zone ON workflow_instances(zone_id);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id   INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_id       INTEGER REFERENCES workflow_steps(id) ON DELETE SET NULL,
  step_name     TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT,
  actor_role    TEXT,
  action        TEXT NOT NULL,                    -- SUBMIT | APPROVE | REJECT | RETURN | ASSIGN | CANCEL
  remarks       TEXT,
  to_step_id    INTEGER REFERENCES workflow_steps(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wf_actions_instance ON workflow_actions(instance_id);
CREATE INDEX IF NOT EXISTS idx_wf_actions_actor ON workflow_actions(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_wf_actions_step ON workflow_actions(step_id);
CREATE INDEX IF NOT EXISTS idx_wf_actions_to_step ON workflow_actions(to_step_id);

-- ---------------------------------------------------------------------------
-- 6. PROJECTS AND PACKAGES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code          TEXT NOT NULL UNIQUE,     -- immutable once generated
  name                  TEXT NOT NULL,
  description           TEXT,
  scheme_id             INTEGER NOT NULL REFERENCES schemes(id) ON DELETE RESTRICT,
  work_type_id          INTEGER NOT NULL REFERENCES work_types(id) ON DELETE RESTRICT,
  project_category_id   INTEGER NOT NULL REFERENCES project_categories(id) ON DELETE RESTRICT,
  zone_id               INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  circle_id             INTEGER NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
  division_id           INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  sub_division_id       INTEGER REFERENCES sub_divisions(id) ON DELETE SET NULL,
  district_id           INTEGER REFERENCES districts(id) ON DELETE SET NULL,
  town_id               INTEGER REFERENCES towns(id) ON DELETE SET NULL,
  estimated_cost        INTEGER NOT NULL DEFAULT 0,
  sanctioned_cost       INTEGER NOT NULL DEFAULT 0,
  sanction_no           TEXT,
  sanction_date         TEXT,
  start_date            TEXT,
  target_completion_date TEXT,
  actual_completion_date TEXT,
  physical_progress_pct INTEGER NOT NULL DEFAULT 0,
  latitude              TEXT,
  longitude             TEXT,
  status                TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT | PENDING_SANCTION | SANCTIONED | IN_PROGRESS | COMPLETED | CLOSED | REJECTED
  workflow_instance_id  INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_scheme ON projects(scheme_id);
CREATE INDEX IF NOT EXISTS idx_projects_work_type ON projects(work_type_id);
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(project_category_id);
CREATE INDEX IF NOT EXISTS idx_projects_zone ON projects(zone_id);
CREATE INDEX IF NOT EXISTS idx_projects_circle ON projects(circle_id);
CREATE INDEX IF NOT EXISTS idx_projects_division ON projects(division_id);
CREATE INDEX IF NOT EXISTS idx_projects_sub_division ON projects(sub_division_id);
CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(district_id);
CREATE INDEX IF NOT EXISTS idx_projects_town ON projects(town_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_workflow ON projects(workflow_instance_id);

CREATE TABLE IF NOT EXISTS project_milestones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL DEFAULT 1,
  name          TEXT NOT NULL,
  planned_date  TEXT,
  actual_date   TEXT,
  weightage_pct INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | IN_PROGRESS | COMPLETED | DELAYED
  remarks       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON project_milestones(project_id);

CREATE TABLE IF NOT EXISTS packages (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  package_code            TEXT NOT NULL UNIQUE,   -- immutable once generated
  project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  work_type_id            INTEGER REFERENCES work_types(id) ON DELETE SET NULL,
  estimated_value         INTEGER NOT NULL DEFAULT 0,
  awarded_value           INTEGER NOT NULL DEFAULT 0,
  contractor_id           INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
  in_charge_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- EE responsible
  agreement_no            TEXT,
  agreement_date          TEXT,
  work_order_no           TEXT,
  work_order_date         TEXT,
  commencement_date       TEXT,
  completion_date         TEXT,
  defect_liability_months INTEGER NOT NULL DEFAULT 12,
  security_deposit_bps    INTEGER NOT NULL DEFAULT 500,
  retention_bps           INTEGER NOT NULL DEFAULT 500,
  physical_progress_pct   INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT | TENDERING | AWARDED | IN_PROGRESS | COMPLETED | CLOSED
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_packages_project ON packages(project_id);
CREATE INDEX IF NOT EXISTS idx_packages_contractor ON packages(contractor_id);
CREATE INDEX IF NOT EXISTS idx_packages_incharge ON packages(in_charge_user_id);
CREATE INDEX IF NOT EXISTS idx_packages_work_type ON packages(work_type_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_created_by ON packages(created_by);

-- A dated site update the contractor files against a package — physical
-- progress, a narrative, and (via the documents table) geotagged photographs.
-- Reviewed once by the officer in charge; a returned update may be corrected
-- and resubmitted, an accepted one becomes a record.
CREATE TABLE IF NOT EXISTS package_progress_updates (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id             INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  contractor_id          INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
  update_date            TEXT NOT NULL,
  physical_progress_pct  INTEGER,
  narrative              TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED | REVIEWED | RETURNED
  review_remarks         TEXT,
  reviewed_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TEXT,
  submitted_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_progress_updates_package ON package_progress_updates(package_id);
CREATE INDEX IF NOT EXISTS idx_progress_updates_status ON package_progress_updates(status);
CREATE INDEX IF NOT EXISTS idx_progress_updates_contractor ON package_progress_updates(contractor_id);

-- ---------------------------------------------------------------------------
-- 7. PROCUREMENT / TENDERING
-- ---------------------------------------------------------------------------

-- The agreement bill of quantities. Copied from the winning bid when a tender
-- is awarded, and thereafter the only thing an RA bill may be measured against.
CREATE TABLE IF NOT EXISTS package_boq_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id    INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  sl_no         INTEGER NOT NULL,
  item_code     TEXT,
  description   TEXT NOT NULL,
  uom           TEXT NOT NULL DEFAULT 'Nos',
  quantity      INTEGER NOT NULL DEFAULT 0,     -- x1000
  agreed_rate   INTEGER NOT NULL DEFAULT 0,     -- paise; what the contract says
  amount        INTEGER NOT NULL DEFAULT 0,     -- paise; quantity x agreed rate
  -- The Schedule of Rates line this item is priced against, and the SR rate as
  -- it stood when the agreement was signed. Kept as a copy so a later revision
  -- of the SR never rewrites history on a live agreement.
  sr_item_id    INTEGER REFERENCES schedule_of_rates(id) ON DELETE SET NULL,
  sr_rate       INTEGER NOT NULL DEFAULT 0,     -- paise
  remarks       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (package_id, sl_no)
);
CREATE INDEX IF NOT EXISTS idx_package_boq_package ON package_boq_items(package_id);
CREATE INDEX IF NOT EXISTS idx_package_boq_sr ON package_boq_items(sr_item_id);

CREATE TABLE IF NOT EXISTS tenders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_no             TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  package_id            INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  division_id           INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  tender_type           TEXT NOT NULL DEFAULT 'OPEN',       -- OPEN | LIMITED | EOI | GEM | SINGLE
  bid_type              TEXT NOT NULL DEFAULT 'ITEM_RATE',  -- ITEM_RATE | PERCENTAGE | LUMPSUM
  estimated_value       INTEGER NOT NULL DEFAULT 0,
  emd_amount            INTEGER NOT NULL DEFAULT 0,
  tender_fee            INTEGER NOT NULL DEFAULT 0,
  completion_period_days INTEGER NOT NULL DEFAULT 180,
  min_registration_class TEXT,
  eligibility_criteria  TEXT,
  -- The Detailed Project Report this tender was raised from, when it was
  -- converted rather than typed from nothing.
  dpr_id                INTEGER REFERENCES project_dprs(id) ON DELETE SET NULL,
  -- The Schedule of Rates ceiling. A bidder may quote below the baseline but
  -- not above it, so the ceiling is frozen onto the tender when it publishes
  -- rather than recomputed at bid time — a later SR revision must not move the
  -- goalposts under a bid already being prepared.
  sr_ceiling_enforced   INTEGER NOT NULL DEFAULT 1,
  sr_ceiling_amount     INTEGER NOT NULL DEFAULT 0,  -- paise
  -- Relief from that ceiling, granted deliberately and on a stated ground:
  -- a war, a pandemic or a price shock that postdates the SR edition the
  -- estimate was priced from. Nothing bypasses the ceiling silently.
  above_sr_permitted    INTEGER NOT NULL DEFAULT 0,
  above_sr_cap_bps      INTEGER NOT NULL DEFAULT 0,  -- how far above, in basis points
  above_sr_ground       TEXT,                        -- WAR | PANDEMIC | PRICE_ESCALATION | NATURAL_CALAMITY | OTHER
  above_sr_authority    TEXT,                        -- the circular or order granting it
  above_sr_remarks      TEXT,
  above_sr_granted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  above_sr_granted_at   TEXT,
  publish_date          TEXT,
  bid_start_at          TEXT,
  bid_end_at            TEXT,
  technical_open_at     TEXT,
  financial_open_at     TEXT,
  status                TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT | PENDING_APPROVAL | APPROVED | PUBLISHED | BIDDING_CLOSED
    -- | TECHNICAL_EVALUATION | FINANCIAL_EVALUATION | AWARDED | CANCELLED | REJECTED
  workflow_instance_id  INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tenders_project ON tenders(project_id);
CREATE INDEX IF NOT EXISTS idx_tenders_package ON tenders(package_id);
CREATE INDEX IF NOT EXISTS idx_tenders_division ON tenders(division_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_created_by ON tenders(created_by);
CREATE INDEX IF NOT EXISTS idx_tenders_workflow ON tenders(workflow_instance_id);

CREATE TABLE IF NOT EXISTS tender_boq_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id       INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  sl_no           INTEGER NOT NULL,
  item_code       TEXT,
  description     TEXT NOT NULL,
  uom             TEXT NOT NULL DEFAULT 'Nos',
  quantity        INTEGER NOT NULL DEFAULT 0,     -- stored x1000 to keep 3 decimals exact
  estimated_rate  INTEGER NOT NULL DEFAULT 0,     -- paise per unit
  -- The Schedule of Rates line this item is priced from, and that rate as it
  -- stood when the tender was raised. This is the per-line bidding ceiling.
  sr_item_id      INTEGER REFERENCES schedule_of_rates(id) ON DELETE SET NULL,
  sr_rate         INTEGER NOT NULL DEFAULT 0,     -- paise per unit
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boq_tender ON tender_boq_items(tender_id);
CREATE INDEX IF NOT EXISTS idx_boq_sr ON tender_boq_items(sr_item_id);

-- Pre-Qualification and Technical Qualification criteria.
--
-- A tender document is the Detailed Project Report plus these: the DPR fixes
-- what is to be built and what it should cost, the criteria fix who is fit to
-- build it. PQ is pass/fail and screens the bidder before anything is opened;
-- TQ is scored and decides the technical envelope.
CREATE TABLE IF NOT EXISTS tender_criteria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id     INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                   -- PQ | TQ
  sl_no         INTEGER NOT NULL,
  title         TEXT NOT NULL,
  requirement   TEXT NOT NULL,                   -- what the bidder must demonstrate
  evidence      TEXT,                            -- the document that proves it
  is_mandatory  INTEGER NOT NULL DEFAULT 1,
  max_score     INTEGER NOT NULL DEFAULT 0,      -- TQ only; PQ criteria are pass/fail
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tender_id, kind, sl_no)
);
CREATE INDEX IF NOT EXISTS idx_tender_criteria_tender ON tender_criteria(tender_id, kind);

-- How one bid answered one criterion. Written by the evaluation committee, and
-- what the technical score is totalled from rather than typed.
CREATE TABLE IF NOT EXISTS bid_criteria_responses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id        INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  criterion_id  INTEGER NOT NULL REFERENCES tender_criteria(id) ON DELETE CASCADE,
  is_met        INTEGER NOT NULL DEFAULT 0,
  score         INTEGER NOT NULL DEFAULT 0,
  remarks       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bid_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_bid_criteria_bid ON bid_criteria_responses(bid_id);
CREATE INDEX IF NOT EXISTS idx_bid_criteria_criterion ON bid_criteria_responses(criterion_id);

CREATE TABLE IF NOT EXISTS tender_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id   INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL DEFAULT 'GENERAL',
  title       TEXT NOT NULL,
  file_name   TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tender_docs_tender ON tender_documents(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_docs_user ON tender_documents(uploaded_by);

CREATE TABLE IF NOT EXISTS bids (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_no                TEXT NOT NULL UNIQUE,
  tender_id             INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  contractor_id         INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  emd_reference         TEXT,
  emd_paid              INTEGER NOT NULL DEFAULT 0,
  quoted_amount         INTEGER NOT NULL DEFAULT 0,
  variation_bps         INTEGER NOT NULL DEFAULT 0,  -- +/- vs estimate, basis points
  -- The Schedule of Rates ceiling this bid was accepted against, and whether it
  -- used the relief granted on the tender. Copied onto the bid so the check
  -- that let it through stays readable after the tender is amended.
  sr_ceiling_amount     INTEGER NOT NULL DEFAULT 0,  -- paise
  sr_variation_bps      INTEGER NOT NULL DEFAULT 0,  -- +/- vs the SR baseline
  is_above_sr           INTEGER NOT NULL DEFAULT 0,
  technical_score       INTEGER,                     -- 0..100
  technical_status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | QUALIFIED | DISQUALIFIED
  technical_remarks     TEXT,
  financial_status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | EVALUATED | REJECTED
  rank                  INTEGER,
  status                TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT | SUBMITTED | TECHNICALLY_QUALIFIED | DISQUALIFIED | AWARDED | NOT_AWARDED
  submitted_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tender_id, contractor_id)
);
CREATE INDEX IF NOT EXISTS idx_bids_tender ON bids(tender_id);
CREATE INDEX IF NOT EXISTS idx_bids_contractor ON bids(contractor_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);

CREATE TABLE IF NOT EXISTS bid_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id        INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  boq_item_id   INTEGER NOT NULL REFERENCES tender_boq_items(id) ON DELETE CASCADE,
  quoted_rate   INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bid_id, boq_item_id)
);
CREATE INDEX IF NOT EXISTS idx_bid_items_bid ON bid_items(bid_id);
CREATE INDEX IF NOT EXISTS idx_bid_items_boq ON bid_items(boq_item_id);

CREATE TABLE IF NOT EXISTS tender_awards (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id         INTEGER NOT NULL UNIQUE REFERENCES tenders(id) ON DELETE CASCADE,
  bid_id            INTEGER NOT NULL REFERENCES bids(id) ON DELETE RESTRICT,
  contractor_id     INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  loa_no            TEXT NOT NULL,
  loa_date          TEXT NOT NULL,
  awarded_value     INTEGER NOT NULL DEFAULT 0,
  negotiated_value  INTEGER,
  remarks           TEXT,
  awarded_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_awards_bid ON tender_awards(bid_id);
CREATE INDEX IF NOT EXISTS idx_awards_contractor ON tender_awards(contractor_id);
CREATE INDEX IF NOT EXISTS idx_awards_user ON tender_awards(awarded_by);

-- ---------------------------------------------------------------------------
-- 8. RUNNING ACCOUNT (RA) BILLS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ra_bills (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no                 TEXT NOT NULL UNIQUE,
  dbr_no                  TEXT,                    -- divisional running number: 1/23-24
  financial_year          TEXT NOT NULL,
  ra_sequence             INTEGER NOT NULL DEFAULT 1,  -- RA Bill No within the package
  bill_type               TEXT NOT NULL DEFAULT 'RA',  -- RA | FINAL
  project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  package_id              INTEGER NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  contractor_id           INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  division_id             INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  period_from             TEXT,
  period_to               TEXT,
  measurement_book_no     TEXT,
  -- amounts, all paise
  contractor_claim_amount INTEGER NOT NULL DEFAULT 0,
  previous_paid_amount    INTEGER NOT NULL DEFAULT 0,
  present_bill_amount     INTEGER NOT NULL DEFAULT 0,
  admissible_amount       INTEGER NOT NULL DEFAULT 0,
  total_deduction         INTEGER NOT NULL DEFAULT 0,
  net_payable_amount      INTEGER NOT NULL DEFAULT 0,
  -- ETP: establishment, tools & plant, contingency (basis points on admissible amount)
  etp_establishment_bps   INTEGER NOT NULL DEFAULT 0,
  etp_tools_plant_bps     INTEGER NOT NULL DEFAULT 0,
  etp_contingency_bps     INTEGER NOT NULL DEFAULT 0,
  etp_total_bps           INTEGER NOT NULL DEFAULT 0,
  etp_amount              INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT | SUBMITTED | IN_APPROVAL | APPROVED | SENT_TO_TALLY | PAID | REJECTED | RETURNED
  workflow_instance_id    INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL,
  tally_voucher_no        TEXT,
  eoffice_file_no         TEXT,
  eoffice_note_no         TEXT,
  eoffice_remarks         TEXT,
  payment_date            TEXT,
  payment_reference       TEXT,
  created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ra_bills_project ON ra_bills(project_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_package ON ra_bills(package_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_contractor ON ra_bills(contractor_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_division ON ra_bills(division_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_status ON ra_bills(status);
CREATE INDEX IF NOT EXISTS idx_ra_bills_workflow ON ra_bills(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_created_by ON ra_bills(created_by);
CREATE INDEX IF NOT EXISTS idx_ra_bills_fy ON ra_bills(financial_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ra_bills_package_seq ON ra_bills(package_id, ra_sequence);

CREATE TABLE IF NOT EXISTS ra_bill_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ra_bill_id          INTEGER NOT NULL REFERENCES ra_bills(id) ON DELETE CASCADE,
  -- The agreement BOQ line being measured. Null only for bills raised before
  -- the package carried a BOQ.
  boq_item_id         INTEGER REFERENCES package_boq_items(id) ON DELETE SET NULL,
  sl_no               INTEGER NOT NULL,
  description         TEXT NOT NULL,
  uom                 TEXT NOT NULL DEFAULT 'Nos',
  quantity_upto_date  INTEGER NOT NULL DEFAULT 0,  -- x1000
  quantity_previous   INTEGER NOT NULL DEFAULT 0,  -- x1000
  quantity_present    INTEGER NOT NULL DEFAULT 0,  -- x1000
  rate                INTEGER NOT NULL DEFAULT 0,  -- paise
  amount              INTEGER NOT NULL DEFAULT 0,  -- paise
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ra_bill_items_boq ON ra_bill_items(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_ra_items_bill ON ra_bill_items(ra_bill_id);

CREATE TABLE IF NOT EXISTS ra_bill_deductions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ra_bill_id      INTEGER NOT NULL REFERENCES ra_bills(id) ON DELETE CASCADE,
  deduction_code  TEXT NOT NULL,
  description     TEXT NOT NULL,
  basis           TEXT NOT NULL DEFAULT 'PERCENT',
  rate_bps        INTEGER NOT NULL DEFAULT 0,
  amount          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ra_deductions_bill ON ra_bill_deductions(ra_bill_id);

-- ---------------------------------------------------------------------------
-- 9. MISCELLANEOUS BILLS (project expense, revenue expense, refund)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS misc_bills (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no               TEXT NOT NULL UNIQUE,
  bill_category         TEXT NOT NULL DEFAULT 'PROJECT_EXPENSE',
    -- PROJECT_EXPENSE | REVENUE_EXPENSE | REFUND
  financial_year        TEXT NOT NULL,
  project_id            INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  division_id           INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  bill_date             TEXT NOT NULL,
  period_from           TEXT,
  period_to             TEXT,
  site_id               TEXT,
  payee_name            TEXT NOT NULL,
  payee_type            TEXT NOT NULL DEFAULT 'STAFF',  -- STAFF | VENDOR | CONTRACTOR | OTHER
  contractor_id         INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
  submitted_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_designation TEXT,
  gross_amount          INTEGER NOT NULL DEFAULT 0,
  total_deduction       INTEGER NOT NULL DEFAULT 0,
  net_payable_amount    INTEGER NOT NULL DEFAULT 0,
  amount_in_words       TEXT,
  refund_reference      TEXT,                        -- for REFUND bills
  status                TEXT NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id  INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL,
  tally_voucher_no      TEXT,
  eoffice_file_no       TEXT,
  eoffice_note_no       TEXT,
  eoffice_remarks       TEXT,
  payment_date          TEXT,
  payment_reference     TEXT,
  remarks               TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_misc_bills_project ON misc_bills(project_id);
CREATE INDEX IF NOT EXISTS idx_misc_bills_division ON misc_bills(division_id);
CREATE INDEX IF NOT EXISTS idx_misc_bills_contractor ON misc_bills(contractor_id);
CREATE INDEX IF NOT EXISTS idx_misc_bills_status ON misc_bills(status);
CREATE INDEX IF NOT EXISTS idx_misc_bills_category ON misc_bills(bill_category);
CREATE INDEX IF NOT EXISTS idx_misc_bills_workflow ON misc_bills(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_misc_bills_created_by ON misc_bills(created_by);
CREATE INDEX IF NOT EXISTS idx_misc_bills_submitter ON misc_bills(submitted_by_user_id);

CREATE TABLE IF NOT EXISTS misc_bill_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  misc_bill_id      INTEGER NOT NULL REFERENCES misc_bills(id) ON DELETE CASCADE,
  sl_no             INTEGER NOT NULL,
  expense_date      TEXT NOT NULL,
  description       TEXT NOT NULL,
  category_code     TEXT NOT NULL,
  govt_object_head  TEXT,
  invoice_no        TEXT,
  gstin             TEXT,
  amount            INTEGER NOT NULL DEFAULT 0,
  remarks           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_misc_items_bill ON misc_bill_items(misc_bill_id);
CREATE INDEX IF NOT EXISTS idx_misc_items_category ON misc_bill_items(category_code);

-- ---------------------------------------------------------------------------
-- 10. FUNDS: releases and Letter of Credit (LOC)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fund_releases (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  release_no        TEXT NOT NULL UNIQUE,
  scheme_id         INTEGER NOT NULL REFERENCES schemes(id) ON DELETE RESTRICT,
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  division_id       INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  financial_year    TEXT NOT NULL,
  sanctioned_amount INTEGER NOT NULL DEFAULT 0,
  released_amount   INTEGER NOT NULL DEFAULT 0,
  release_date      TEXT NOT NULL,
  reference_no      TEXT,
  remarks           TEXT,
  status            TEXT NOT NULL DEFAULT 'RELEASED',
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_releases_scheme ON fund_releases(scheme_id);
CREATE INDEX IF NOT EXISTS idx_fund_releases_project ON fund_releases(project_id);
CREATE INDEX IF NOT EXISTS idx_fund_releases_division ON fund_releases(division_id);
CREATE INDEX IF NOT EXISTS idx_fund_releases_user ON fund_releases(created_by);

CREATE TABLE IF NOT EXISTS loc_requests (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  loc_no                TEXT NOT NULL UNIQUE,
  division_id           INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  scheme_id             INTEGER REFERENCES schemes(id) ON DELETE SET NULL,
  financial_year        TEXT NOT NULL,
  request_date          TEXT NOT NULL,
  requested_amount      INTEGER NOT NULL DEFAULT 0,
  approved_amount       INTEGER NOT NULL DEFAULT 0,
  purpose               TEXT,
  status                TEXT NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id  INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL,
  approval_date         TEXT,
  remarks               TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loc_division ON loc_requests(division_id);
CREATE INDEX IF NOT EXISTS idx_loc_scheme ON loc_requests(scheme_id);
CREATE INDEX IF NOT EXISTS idx_loc_status ON loc_requests(status);
CREATE INDEX IF NOT EXISTS idx_loc_workflow ON loc_requests(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_loc_user ON loc_requests(created_by);

-- ---------------------------------------------------------------------------
-- 11. NOTIFICATIONS AND SEQUENCES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'INFO',      -- INFO | ACTION | WARNING | SUCCESS
  entity_type TEXT,
  entity_id   INTEGER,
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ---------------------------------------------------------------------------
-- 11a. DOCUMENTS
-- ---------------------------------------------------------------------------

-- A foldered repository. A folder with no parent is a top-level cabinet.
CREATE TABLE IF NOT EXISTS document_folders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES document_folders(id) ON DELETE RESTRICT,
  description TEXT,
  -- A folder may be pinned to a division, in which case only that division and
  -- the head-office cadre see it. NULL means departmental-wide.
  division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (parent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_document_folders_division ON document_folders(division_id);
CREATE INDEX IF NOT EXISTS idx_document_folders_created_by ON document_folders(created_by);

-- A stored file. `stored_name` is generated; `name` is what the user sees, and
-- is never used to build a path.
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  stored_name   TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  extension     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  checksum      TEXT NOT NULL,                    -- sha256 of the stored bytes
  folder_id     INTEGER REFERENCES document_folders(id) ON DELETE RESTRICT,
  -- Attachment target. Both NULL for a file that only lives in the repository.
  entity_type   TEXT,                             -- PROJECT | TENDER | RA_BILL | ...
  entity_id     INTEGER,
  category      TEXT NOT NULL DEFAULT 'GENERAL',  -- GENERAL | AGREEMENT | MEASUREMENT | INVOICE | ...
  description   TEXT,
  division_id   INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  -- Set only for a photograph captured with its location, e.g. a contractor's
  -- site progress photo. NULL for everything filed the ordinary way.
  latitude      TEXT,
  longitude     TEXT,
  captured_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_division ON documents(division_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);

-- ---------------------------------------------------------------------------
-- 11b. MESSAGING
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'DIRECT',     -- DIRECT | GROUP
  name        TEXT,                               -- groups only; a direct chat is named by its members
  topic       TEXT,
  -- A direct chat carries the two member ids in order, so the pair can be found
  -- again instead of creating a second conversation for the same two people.
  direct_key  TEXT UNIQUE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON conversations(created_by);

CREATE TABLE IF NOT EXISTS conversation_members (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin        INTEGER NOT NULL DEFAULT 0,     -- may rename the group and manage members
  last_read_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_members_conversation ON conversation_members(conversation_id);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  -- A message may carry a link to a record, so a file can be discussed in place.
  entity_type     TEXT,
  entity_id       INTEGER,
  document_id     INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  deleted_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_document ON messages(document_id);

-- ---------------------------------------------------------------------------
-- 11c. ACTIVITY LOG
-- ---------------------------------------------------------------------------

-- Every API call an authenticated user makes. This is the live technical log,
-- distinct from audit_log, which records business events in the department's
-- own language and is retained permanently.
CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username     TEXT,                              -- kept verbatim so the line survives user deletion
  full_name    TEXT,
  role_code    TEXT,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  action       TEXT,                              -- readable summary, e.g. "Opened RA bill 5"
  status_code  INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_status ON activity_log(status_code);

-- ---------------------------------------------------------------------------
-- 11d. ROLE PERMISSIONS
-- ---------------------------------------------------------------------------

-- What each role may do. The catalogue of permissions is code — a key only
-- means something because a route checks for it — so what is stored here is
-- purely the grant, which an administrator edits on the roles screen.
--
-- A role with no rows here has never been configured and falls back to the
-- built-in defaults, so a new role code is never accidentally all-powerful or
-- completely powerless.
CREATE TABLE IF NOT EXISTS role_permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code      TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  granted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (role_code, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_code);

-- Records that a role has been configured at all, so an administrator can
-- revoke every permission from a role and have that stick rather than being
-- read as "never set up, use the defaults".
CREATE TABLE IF NOT EXISTS role_permission_state (
  role_code   TEXT PRIMARY KEY REFERENCES roles(code) ON DELETE CASCADE,
  configured  INTEGER NOT NULL DEFAULT 1,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 11e. NOTING SHEET, SANCTIONS AND DPRs
-- ---------------------------------------------------------------------------

-- The noting sheet a government file carries: officers record observations as
-- the file moves, without having to approve or reject anything. Distinct from
-- workflow_actions, which only records decisions.
CREATE TABLE IF NOT EXISTS notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,                    -- PROJECT | PACKAGE | TENDER | RA_BILL | ...
  entity_id    INTEGER NOT NULL,
  -- Sequential within the file, the way a paper noting sheet is numbered.
  note_no      INTEGER NOT NULL,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name  TEXT,                             -- kept verbatim; a note outlives an account
  author_role  TEXT,
  body         TEXT NOT NULL,
  -- An internal note is not shown to the contractor on their own record.
  is_internal  INTEGER NOT NULL DEFAULT 0,
  document_id  INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, note_no)
);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id, note_no);
CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author_id);

-- Administrative Approval & Financial Sanction, Technical Sanction and their
-- revisions. These are the government orders that authorise a work and its
-- cost, and they are what an auditor asks for first.
CREATE TABLE IF NOT EXISTS project_sanctions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- ADMINISTRATIVE = AA&FS, TECHNICAL = TS, and the revised forms of each.
  kind           TEXT NOT NULL,
  reference_no   TEXT NOT NULL,
  sanction_date  TEXT NOT NULL,
  amount         INTEGER NOT NULL DEFAULT 0,     -- paise; the amount sanctioned
  authority      TEXT NOT NULL,                  -- the officer or body that sanctioned it
  designation    TEXT,
  remarks        TEXT,
  -- The signed order itself, filed through the document store.
  document_id    INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  recorded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_sanctions_project ON project_sanctions(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_project_sanctions_document ON project_sanctions(document_id);

-- The Detailed Project Report, which is what an administrative approval is
-- granted against. Versioned, because a returned DPR comes back revised.
CREATE TABLE IF NOT EXISTS project_dprs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dpr_no          TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  title           TEXT NOT NULL,
  prepared_by     TEXT,                          -- the officer or consultancy
  consultant      TEXT,
  estimated_cost  INTEGER NOT NULL DEFAULT 0,    -- paise; the abstract of cost
  submission_date TEXT,
  scope           TEXT,                          -- what the work covers
  justification   TEXT,                          -- why it is needed
  -- The abstract of cost. The estimate is built line by line from the Schedule
  -- of Rates edition named here; contingency and work-charged establishment are
  -- the percentages the department adds on top of the measured items.
  sr_edition      TEXT,
  items_total     INTEGER NOT NULL DEFAULT 0,    -- paise; sum of the priced items
  contingency_bps INTEGER NOT NULL DEFAULT 0,
  establishment_bps INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | SUBMITTED | APPROVED | RETURNED
  approved_by     TEXT,
  approval_date   TEXT,
  remarks         TEXT,
  document_id     INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  -- Set once the report has been converted into a tender document. A DPR is
  -- converted once; a revision is a new version, and converts on its own.
  tender_id       INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, dpr_no, version)
);
CREATE INDEX IF NOT EXISTS idx_project_dprs_project ON project_dprs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_dprs_document ON project_dprs(document_id);
CREATE INDEX IF NOT EXISTS idx_project_dprs_tender ON project_dprs(tender_id);

-- The item-wise estimate the Detailed Project Report is built from.
--
-- This is where a DPR is actually prepared: each line names an item of work,
-- takes its rate from the Schedule of Rates rather than from whoever is filling
-- in the form, and the quantity times that rate is the abstract of cost. The SR
-- rate is copied onto the line, so a later revision of the rate book never
-- rewrites an estimate that has already been sanctioned.
CREATE TABLE IF NOT EXISTS project_dpr_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dpr_id       INTEGER NOT NULL REFERENCES project_dprs(id) ON DELETE CASCADE,
  sl_no        INTEGER NOT NULL,
  sr_item_id   INTEGER REFERENCES schedule_of_rates(id) ON DELETE SET NULL,
  item_code    TEXT,
  description  TEXT NOT NULL,
  uom          TEXT NOT NULL DEFAULT 'Nos',
  quantity     INTEGER NOT NULL DEFAULT 0,      -- x1000
  rate         INTEGER NOT NULL DEFAULT 0,      -- paise; what the estimate is priced at
  sr_rate      INTEGER NOT NULL DEFAULT 0,      -- paise; the SR rate at the time
  amount       INTEGER NOT NULL DEFAULT 0,      -- paise; quantity x rate
  remarks      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dpr_id, sl_no)
);
CREATE INDEX IF NOT EXISTS idx_dpr_items_dpr ON project_dpr_items(dpr_id);
CREATE INDEX IF NOT EXISTS idx_dpr_items_sr ON project_dpr_items(sr_item_id);

-- ---------------------------------------------------------------------------
-- 11f. LAND ACQUISITION
-- ---------------------------------------------------------------------------

-- Land taken for a work, parcel by parcel, under the Right to Fair Compensation
-- and Transparency in Land Acquisition, Rehabilitation and Resettlement Act,
-- 2013. The sections that matter to a division office are the preliminary
-- notification (11), the declaration (19), the award (23) and the solatium (30),
-- and each is a date the file cannot skip past.
CREATE TABLE IF NOT EXISTS land_parcels (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_no             TEXT NOT NULL UNIQUE,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  package_id            INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  division_id           INTEGER NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  district_id           INTEGER REFERENCES districts(id) ON DELETE SET NULL,
  village               TEXT NOT NULL,
  survey_no             TEXT NOT NULL,          -- survey / hissa number in the revenue record
  khata_no              TEXT,                   -- the E-Khata reference, once integrated
  land_type             TEXT NOT NULL DEFAULT 'AGRICULTURAL',
    -- AGRICULTURAL | RESIDENTIAL | COMMERCIAL | INDUSTRIAL | GOVERNMENT | FOREST
  area_sqm              INTEGER NOT NULL DEFAULT 0,   -- x1000, as every quantity is
  owner_name            TEXT NOT NULL,
  owner_address         TEXT,
  owner_contact         TEXT,
  -- The statutory trail. A stage cannot be recorded before the one before it.
  notification_no       TEXT,                   -- Section 11 preliminary notification
  notification_date     TEXT,
  declaration_no        TEXT,                   -- Section 19 declaration
  declaration_date      TEXT,
  award_no              TEXT,                   -- Section 23 award
  award_date            TEXT,
  -- Compensation, all paise. Solatium and interest are statutory additions to
  -- the market value, so they are held apart rather than folded into one figure.
  market_value          INTEGER NOT NULL DEFAULT 0,
  solatium_amount       INTEGER NOT NULL DEFAULT 0,
  interest_amount       INTEGER NOT NULL DEFAULT 0,
  other_amount          INTEGER NOT NULL DEFAULT 0,   -- structures, trees, crops
  total_compensation    INTEGER NOT NULL DEFAULT 0,
  paid_amount           INTEGER NOT NULL DEFAULT 0,
  possession_date       TEXT,
  status                TEXT NOT NULL DEFAULT 'IDENTIFIED',
    -- IDENTIFIED | NOTIFIED | DECLARED | AWARDED | COMPENSATED | POSSESSED
    -- | DISPUTED | WITHDRAWN
  remarks               TEXT,
  document_id           INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  workflow_instance_id  INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_land_parcels_project ON land_parcels(project_id);
CREATE INDEX IF NOT EXISTS idx_land_parcels_package ON land_parcels(package_id);
CREATE INDEX IF NOT EXISTS idx_land_parcels_division ON land_parcels(division_id);
CREATE INDEX IF NOT EXISTS idx_land_parcels_district ON land_parcels(district_id);
CREATE INDEX IF NOT EXISTS idx_land_parcels_status ON land_parcels(status);
CREATE INDEX IF NOT EXISTS idx_land_parcels_workflow ON land_parcels(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_land_parcels_created_by ON land_parcels(created_by);

-- Compensation actually disbursed against a parcel. Paid in instalments more
-- often than not, so the parcel carries a running total rather than a flag.
CREATE TABLE IF NOT EXISTS land_compensation_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_id      INTEGER NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  payment_date   TEXT NOT NULL,
  amount         INTEGER NOT NULL DEFAULT 0,
  mode           TEXT NOT NULL DEFAULT 'RTGS',   -- RTGS | CHEQUE | COURT_DEPOSIT
  reference_no   TEXT,
  payee_name     TEXT NOT NULL,
  remarks        TEXT,
  recorded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_land_payments_parcel ON land_compensation_payments(parcel_id);
CREATE INDEX IF NOT EXISTS idx_land_payments_user ON land_compensation_payments(recorded_by);

-- ---------------------------------------------------------------------------
-- 11g. COURT CASES
-- ---------------------------------------------------------------------------

-- Litigation the department is party to. A case usually hangs off something the
-- department did — a work, an acquisition, a contractor — so it points at that
-- record rather than repeating its particulars.
CREATE TABLE IF NOT EXISTS court_cases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no            TEXT NOT NULL UNIQUE,      -- the court's own number
  internal_ref       TEXT,                      -- the department's file number
  court_name         TEXT NOT NULL,
  court_type         TEXT NOT NULL DEFAULT 'HIGH_COURT',
    -- SUPREME_COURT | HIGH_COURT | DISTRICT_COURT | TRIBUNAL | LOK_ADALAT | ARBITRATION
  case_type          TEXT NOT NULL DEFAULT 'WRIT',
    -- WRIT | CIVIL | ARBITRATION | CONTEMPT | LAND_ACQUISITION | SERVICE | OTHER
  -- Which side the department is on. It changes who prepares what, so it is a
  -- column rather than something to be inferred from the party names.
  filed_by           TEXT NOT NULL DEFAULT 'AGAINST_DEPARTMENT',
    -- BY_DEPARTMENT | AGAINST_DEPARTMENT
  petitioner         TEXT NOT NULL,
  respondent         TEXT NOT NULL,
  subject            TEXT NOT NULL,
  filing_date        TEXT NOT NULL,
  division_id        INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  project_id         INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  package_id         INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  parcel_id          INTEGER REFERENCES land_parcels(id) ON DELETE SET NULL,
  contractor_id      INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
  claim_amount       INTEGER NOT NULL DEFAULT 0,   -- paise; what is at stake
  decree_amount      INTEGER NOT NULL DEFAULT 0,   -- paise; what was awarded
  advocate_name      TEXT,
  advocate_fee       INTEGER NOT NULL DEFAULT 0,
  dealing_officer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_hearing_date  TEXT,
  status             TEXT NOT NULL DEFAULT 'FILED',
    -- FILED | PENDING | RESERVED | DISPOSED | APPEALED | WITHDRAWN | SETTLED
  outcome            TEXT,
    -- IN_FAVOUR | AGAINST | PARTLY_IN_FAVOUR | SETTLED | WITHDRAWN
  disposal_date      TEXT,
  remarks            TEXT,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_court_cases_division ON court_cases(division_id);
CREATE INDEX IF NOT EXISTS idx_court_cases_project ON court_cases(project_id);
CREATE INDEX IF NOT EXISTS idx_court_cases_package ON court_cases(package_id);
CREATE INDEX IF NOT EXISTS idx_court_cases_parcel ON court_cases(parcel_id);
CREATE INDEX IF NOT EXISTS idx_court_cases_contractor ON court_cases(contractor_id);
CREATE INDEX IF NOT EXISTS idx_court_cases_status ON court_cases(status);
CREATE INDEX IF NOT EXISTS idx_court_cases_hearing ON court_cases(next_hearing_date);
CREATE INDEX IF NOT EXISTS idx_court_cases_officer ON court_cases(dealing_officer_id);
CREATE INDEX IF NOT EXISTS idx_court_cases_created_by ON court_cases(created_by);

-- Each listing, and what came of it. The next date is copied up onto the case
-- so a cause list can be read without walking every hearing.
CREATE TABLE IF NOT EXISTS court_hearings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  hearing_date  TEXT NOT NULL,
  purpose       TEXT,
  appeared_by   TEXT,                       -- the advocate or officer who appeared
  proceedings   TEXT,                       -- what happened, in the file's words
  order_summary TEXT,
  next_date     TEXT,
  document_id   INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_court_hearings_case ON court_hearings(case_id, hearing_date);
CREATE INDEX IF NOT EXISTS idx_court_hearings_document ON court_hearings(document_id);
CREATE INDEX IF NOT EXISTS idx_court_hearings_user ON court_hearings(recorded_by);

-- ---------------------------------------------------------------------------
-- 11h. COMMITTEES AND MEETINGS
-- ---------------------------------------------------------------------------

-- Standing committees: tender, technical, purchase, grievance. Membership is by
-- post rather than by name in a real office, but the account is what signs, so
-- members are users and the post is recorded alongside.
CREATE TABLE IF NOT EXISTS committees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'TENDER',
    -- TENDER | TECHNICAL | PURCHASE | GRIEVANCE | BOARD | REVIEW | OTHER
  purpose      TEXT,
  division_id  INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  -- How many members must attend for the sitting to decide anything.
  quorum       INTEGER NOT NULL DEFAULT 3,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_committees_division ON committees(division_id);
CREATE INDEX IF NOT EXISTS idx_committees_kind ON committees(kind);
CREATE INDEX IF NOT EXISTS idx_committees_created_by ON committees(created_by);

CREATE TABLE IF NOT EXISTS committee_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id  INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role   TEXT NOT NULL DEFAULT 'MEMBER',
    -- CHAIRPERSON | MEMBER_SECRETARY | MEMBER | SPECIAL_INVITEE
  designation   TEXT,                       -- the post held, as it reads on the order
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (committee_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_committee_members_committee ON committee_members(committee_id);
CREATE INDEX IF NOT EXISTS idx_committee_members_user ON committee_members(user_id);

CREATE TABLE IF NOT EXISTS meetings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id  INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  meeting_no    TEXT NOT NULL,
  title         TEXT NOT NULL,
  scheduled_at  TEXT NOT NULL,
  venue         TEXT,
  mode          TEXT NOT NULL DEFAULT 'IN_PERSON',  -- IN_PERSON | VIDEO | HYBRID
  agenda        TEXT,
  status        TEXT NOT NULL DEFAULT 'SCHEDULED',  -- SCHEDULED | HELD | CANCELLED
  held_at       TEXT,
  minutes       TEXT,
  minutes_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (committee_id, meeting_no)
);
CREATE INDEX IF NOT EXISTS idx_meetings_committee ON meetings(committee_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_minutes_by ON meetings(minutes_by);
CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON meetings(created_by);

CREATE TABLE IF NOT EXISTS meeting_attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_present  INTEGER NOT NULL DEFAULT 0,
  remarks     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting ON meeting_attendance(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_user ON meeting_attendance(user_id);

-- What the sitting decided, and who has to act on it. Minutes nobody is named
-- against are minutes nobody acts on, so every decision carries an owner.
CREATE TABLE IF NOT EXISTS meeting_decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  subject       TEXT NOT NULL,
  decision      TEXT NOT NULL,
  action_by_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN | DONE | DROPPED
  closed_on     TEXT,
  closing_note  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (meeting_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_meeting_decisions_meeting ON meeting_decisions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_decisions_owner ON meeting_decisions(action_by_id, status);

-- ---------------------------------------------------------------------------
-- 11i. RIGHT TO INFORMATION
-- ---------------------------------------------------------------------------

-- Applications under the Right to Information Act, 2005.
--
-- The clock is the point of this module: a Public Information Officer has 30
-- days to reply (48 hours where life or liberty is concerned), and missing it
-- carries a personal penalty of ₹250 a day. So the due date is computed from
-- the receipt and stored, and the register is read by how late it is.
CREATE TABLE IF NOT EXISTS rti_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no          TEXT NOT NULL UNIQUE,
  applicant_name      TEXT NOT NULL,
  applicant_address   TEXT,
  applicant_email     TEXT,
  applicant_phone     TEXT,
  -- An applicant below the poverty line pays no fee, which is a statutory
  -- exemption rather than a discount, so it is recorded on the application.
  is_bpl              INTEGER NOT NULL DEFAULT 0,
  fee_paid            INTEGER NOT NULL DEFAULT 0,   -- paise
  received_on         TEXT NOT NULL,
  received_via        TEXT NOT NULL DEFAULT 'ONLINE',
    -- ONLINE | RTI_PORTAL | POST | COUNTER | TRANSFERRED_IN
  subject             TEXT NOT NULL,
  information_sought  TEXT NOT NULL,
  -- Life or liberty applications answer in 48 hours, not 30 days.
  is_life_or_liberty  INTEGER NOT NULL DEFAULT 0,
  division_id         INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  pio_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'RECEIVED',
    -- RECEIVED | IN_PROGRESS | TRANSFERRED | REPLIED | PARTLY_REJECTED | REJECTED | CLOSED
  reply_date          TEXT,
  reply_summary       TEXT,
  -- Section 8 of the Act, where information is withheld. A rejection without
  -- the clause it rests on is not a rejection the appellate authority can test.
  rejection_section   TEXT,
  rejection_ground    TEXT,
  transferred_to      TEXT,                         -- Section 6(3) transfer
  document_id         INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  remarks             TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rti_division ON rti_requests(division_id);
CREATE INDEX IF NOT EXISTS idx_rti_pio ON rti_requests(pio_user_id);
CREATE INDEX IF NOT EXISTS idx_rti_status ON rti_requests(status);
CREATE INDEX IF NOT EXISTS idx_rti_due ON rti_requests(due_date);
CREATE INDEX IF NOT EXISTS idx_rti_created_by ON rti_requests(created_by);

-- First and second appeals. A first appeal goes to a departmental appellate
-- authority within 30 days; a second appeal goes to the Information Commission.
CREATE TABLE IF NOT EXISTS rti_appeals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           INTEGER NOT NULL REFERENCES rti_requests(id) ON DELETE CASCADE,
  appeal_no            TEXT NOT NULL UNIQUE,
  appeal_level         TEXT NOT NULL DEFAULT 'FIRST',   -- FIRST | SECOND
  filed_on             TEXT NOT NULL,
  grounds              TEXT NOT NULL,
  appellate_authority  TEXT,
  authority_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'FILED',
    -- FILED | HEARD | ALLOWED | REJECTED | REMANDED | WITHDRAWN
  decided_on           TEXT,
  decision             TEXT,
  penalty_imposed      INTEGER NOT NULL DEFAULT 0,      -- paise, under Section 20
  remarks              TEXT,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rti_appeals_request ON rti_appeals(request_id);
CREATE INDEX IF NOT EXISTS idx_rti_appeals_status ON rti_appeals(status);
CREATE INDEX IF NOT EXISTS idx_rti_appeals_authority ON rti_appeals(authority_user_id);
CREATE INDEX IF NOT EXISTS idx_rti_appeals_created_by ON rti_appeals(created_by);

-- Named counters backing project/package/tender/bill code generation.
CREATE TABLE IF NOT EXISTS sequences (
  key         TEXT PRIMARY KEY,
  value       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 12. updated_at TRIGGERS
-- ---------------------------------------------------------------------------

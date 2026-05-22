# Auth Model (Stage 1 spec)

Status: DECIDED 2026-05-22. This is the design spec for Stage 1 authorization. Not yet built - Stage 1 schema work implements it.

## Two orthogonal concepts

Authentication (who are you) is settled and unchanged: NextAuth + Google Workspace SSO. This doc is about authorization (what you can see and do).

Authorization splits into two independent things:
- is_admin (a capability): platform-wide administrative access. Bypasses all scoping, sees everything.
- role (an identity): the person's job-type, which scopes what data they can see.

A person has both: a role always, and is_admin true or false. They are independent - someone is a Site Leader AND may or may not be an admin.

## The data

Three tables in Stage 1 Postgres:

- users: email, is_admin (boolean), role (one of the six below)
- user_accounts: email to account mapping, explicit rows (the spine of field-level scoping)
- accounts: already exists

is_admin (platform admins): Kevin, Joe, Josh (actual addresses live in DIRECTORY_ADMIN_EMAILS today, the users table at Stage 1).

The six roles:
- Corporate HR
- Corporate Finance
- Director
- Regional
- Site Leader
- Sous/HM

## What each role can see

- Admin (is_admin true): everything. Bypasses all scoping.
- Corporate HR: everything within the HR domain, across all accounts (people portal, HR data). Scoped by DOMAIN, not by account.
- Corporate Finance: everything within the Finance domain, across all accounts (invoices, high-level finance data). Scoped by DOMAIN, not by account.
- Director / Regional / Site Leader / Sous/HM: only the accounts pertinent to them. Scoped by ACCOUNT OWNERSHIP via the user_accounts mapping.

This is a change from current behavior. Today cross-account visibility is open (everyone sees everything - the current open-by-default behavior). This model closes that down by role. Field-level roles go from open to filtered.

## The one rule

Every account-scoped read passes through one check, evaluated in order, first true wins:

  is_admin OR role-grants-this-domain OR account-is-in-my-mapped-list

## The one helper

getVisibleAccounts(user) encodes that rule:
- admin: all accounts
- corporate role: the domain-relevant set
- field role: the user's mapped account list

Scoping lives in this ONE layer, never scattered through handlers (scattering is how the current fudge happened). Target implementation: Supabase row-level security, so a direct API call cannot escape the scope (the B1 lesson - UI-only filtering is not enough - applied to reads). Fallback if RLS is fiddly: the single shared getVisibleAccounts query-filter helper that every account-scoped query calls.

## What this retires

The current authorization fudge (admin checked differently in every module) collapses into this one model:
- directory B1 interim env-var gate (DIRECTORY_ADMIN_EMAILS) becomes is_admin in the users table
- people.js "hr" flag (col A + col C "hr"=TRUE) becomes the Corporate HR role check
- analytics hardcode (Kevin-only) becomes is_admin

## Management UI

Auth DATA stays as its own tables (users, user_accounts) - separate from directory contact records, so a directory edit can never accidentally change who can log in (directory contacts and login-able users are not the same set).

Auth MANAGEMENT UI lives as a new tab ("Access" or "Users") in the existing Directory Admin panel - the same admin-gated surface that already holds Accounts & Links, Contacts, Hero Images. This unifies the admin SCREEN without conflating the auth DATA with contacts. From this tab: toggle is_admin, set each person's role, assign field roles their accounts.

## Phasing (do NOT flip the whole platform at once)

Build the structure, then turn enforcement on one module at a time:
1. Stage 1 schema: users + user_accounts tables + getVisibleAccounts helper. Populate admins, roles, mappings.
2. Corporate domain gating first (simpler axis): replace the people.js "hr" flag and analytics hardcode with role checks.
3. Account scoping second, module by module, starting with the most finance-sensitive reads (invoices, analytics). Each is its own small PR with a smoke test: "log in as a Site Leader, confirm you see only your account."

The risk is not the schema - it is flipping a platform that has been open its whole life to filtered, everywhere, at once. Phasing makes each step a normal-sized, testable, reversible PR.

## TODO before schema work (Kevin's data entry)

The user_accounts mapping needs explicit rows. Kevin to fill in:
- Site Leaders: which account each runs (one each, or a short explicit list if any run more than one)
- Regionals: explicit account list per Regional (e.g. "Regional X covers STL-MO, CIN-OH, CIN-KY") - explicit lists, NOT derived from geography or key-prefix logic
- Directors: their account scope
- Confirm each person's role and is_admin status

Site Leaders are simple (one account each). Regionals are the piece that needs Kevin to write out the clusters. This mapping is the spine of field-level scoping - the schema cannot filter against a mapping that does not have explicit rules.

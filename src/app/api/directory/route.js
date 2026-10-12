import { auth } from "@/lib/auth";
import { readSheetSA, getServiceAccountDriveClient, SHEET_IDS } from "@/lib/sheets";
import {
  getAccounts,
  upsertAccount,
  getContacts,
  replaceContactsForAccount,
  getWorkLocations,
  upsertWorkLocation,
  deleteWorkLocation,
  getHeroImages,
  replaceHeroImages,
} from "@/lib/dataStore";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

// ─── Stage 3 admin-panel auth helpers ───────────────────────────────
// Two separate allowlists for two separate concerns:
//
//   OPS_LEADERSHIP_SET - panel ACCESS code-level fallback (6 people).
//     The admin tabs open when the user matches this set OR their DB
//     `is_ops_leadership` flag is TRUE. Code membership is immunity
//     against a DB flag that got flipped off by mistake.
//
//   SUPER_ADMINS_SET   - toggle PROTECTION code-level allowlist (Kevin
//     only). When editing a SUPER_ADMIN's row, the `is_ops_leadership`
//     toggle is disabled in the UI and the API rejects the write.
//     Narrower than OPS_LEADERSHIP so the other 5 ops-leadership
//     members can still have their flag flipped through the panel if
//     their role changes; Kevin alone has structural immunity.
//
// Stage 4 moves SUPER_ADMINS to src/lib/admin.js alongside the other
// allowlists; it lives inline here for now because admin.js is a
// danger zone this PR deliberately does not touch.
const OPS_LEADERSHIP_SET = new Set(OPS_LEADERSHIP_EMAILS.map((e) => e.toLowerCase().trim()));
const SUPER_ADMINS = ["k.fietek@kitchfix.com"];
const SUPER_ADMINS_SET = new Set(SUPER_ADMINS.map((e) => e.toLowerCase().trim()));

// 19 editable permission columns. Must match the CHECK constraint in
// docs/migrations/people-3-changelog.sql. The 13 bools and 6 enums are
// separated so the POST handler can type-check per column.
const BOOLEAN_COLUMNS = new Set([
  "is_ops_leadership", "is_sc_access", "is_sc_admin", "is_sc_lock_override",
  "is_labor_admin", "is_invoice_admin", "is_inv_manager",
  "can_see_salary", "is_kpi_preview",
  "is_playbook_owner", "is_sous_preview", "is_hr_admin",
  "paf_always_cc",
]);
const ENUM_COLUMNS = {
  kpi_role:        new Set([null, "corporate", "rdo"]),
  opd_access_tier: new Set(["unrestricted", "restricted", "slt"]),
  incident_notify: new Set(["all", "s4_weekly", "none"]),
  region:          new Set([null, "East", "West", "CORP"]),
};
// kpi_scope and sc_default_account are free-text; validate type only
const FREE_TEXT_COLUMNS = new Set(["kpi_scope", "sc_default_account"]);
const EDITABLE_COLUMNS = new Set([
  ...BOOLEAN_COLUMNS,
  ...Object.keys(ENUM_COLUMNS),
  ...FREE_TEXT_COLUMNS,
]);

// Identity + all 19 permission columns, used by the list action
const PEOPLE_IDENTITY_COLS = "worker_id, work_email, display_name, title, status";
const PEOPLE_PERMISSION_COLS = [...EDITABLE_COLUMNS].join(", ");

// Human-readable labels for the Permissions tab dropdown. Kept here
// so the client can map column name <-> label without round-tripping.
const COLUMN_LABELS = {
  is_ops_leadership:   "Ops Leadership",
  is_sc_access:        "Service Calendar Access",
  is_sc_admin:         "Service Calendar Admin",
  is_sc_lock_override: "SC Lock Override",
  is_labor_admin:      "Labor Admin",
  is_invoice_admin:    "Invoice Admin",
  is_inv_manager:      "Inventory Manager",
  kpi_role:            "KPI Role",
  kpi_scope:           "KPI Scope",
  can_see_salary:      "Can See Salary",
  is_kpi_preview:      "KPI Preview",
  opd_access_tier:     "Playbook Access Tier",
  is_playbook_owner:   "Playbook Owner",
  is_sous_preview:     "Sous Preview",
  is_hr_admin:         "HR Admin",
  paf_always_cc:       "PAF Always CC",
  incident_notify:     "Incident Notifications",
  region:              "Region",
  sc_default_account:  "SC Default Account",
};

// Fetch all ACTIVE people with the permission columns, paginated past
// the PostgREST 1000-row cap. Returns an array shaped for the API
// response (not the raw DB row).
async function fetchActivePeople(supa) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("people")
      .select(`${PEOPLE_IDENTITY_COLS}, ${PEOPLE_PERMISSION_COLS}`)
      .eq("status", "ACTIVE")
      .order("display_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[admin-people-list] ${error.message}`);
    out.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  return out;
}

// Gate for people-admin API actions. Super-admin (code-level) OR
// is_ops_leadership (DB-level). Session always required.
async function requirePeopleAdmin(session) {
  if (!session) return { ok: false, status: 401, reason: "Not authenticated" };
  const email = session.user?.email?.toLowerCase().trim() || "";
  if (!email) return { ok: false, status: 401, reason: "Session missing email" };

  // Code-level allowlist first - immune to DB flag mistakes
  if (OPS_LEADERSHIP_SET.has(email)) {
    return { ok: true, email, isSuperAdmin: true };
  }
  // DB-level flag check
  const supa = getServiceClient();
  const { data, error } = await supa
    .from("people")
    .select("is_ops_leadership")
    .ilike("work_email", email)
    .maybeSingle();
  if (error) return { ok: false, status: 500, reason: `people lookup: ${error.message}` };
  if (data?.is_ops_leadership === true) {
    return { ok: true, email, isSuperAdmin: false };
  }
  return { ok: false, status: 403, reason: "People admin authorization required" };
}
// ═══════════════════════════════════════════════════════════════
// TEAM DIRECTORY API
// ═══════════════════════════════════════════════════════════════
// Stage 1 module 2 PR B: rewired through src/lib/dataStore.js so the
// directory's 4 tables (accounts, contacts, work_locations, hero_images)
// can dual-write to Postgres under cutover flag control. With flags
// OFF (the default state on merge), behavior is byte-identical to
// the pre-PR-B handler: every Sheets read/write happens exactly as
// before, and the bootstrap response shape matches field-for-field
// (id, rawKey, name, level, city, state, season, stadium, img, logo,
// address, lat, long, tz, wifiName, wifiPass, gateCode, doorCode,
// gmapImg, active, links, contacts). Dead cols (wifiName, wifiPass,
// gateCode, doorCode) emit as "" - the audit DEAD verdict means the
// underlying data was 0/12 filled; hardcoding "" matches today.
//
// The B1 admin gate (PR #57) is preserved unchanged.
// admins (auth config) is still read directly via readSheetSA - not
// migrating per audit (auth model retires it in Stage 1 auth work).
//
// Every dataStore call passes { module: "directory" } so per-module
// READ_FROM_POSTGRES_DIRECTORY env var override applies independently
// of other modules that read the same tabs.

const DIRECTORY_MODULE = "directory";

function getDriveFileId(url) {
  if (!url) return null;
  const u = String(url).trim();
  if (!u.includes("drive.google.com")) return null;
  const parts = u.split("/d/");
  if (parts.length > 1) return parts[1].split("/")[0];
  const match = u.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Normalize level: sheet stores AAA, intranet uses MiLB
const normalizeLevel = (level) => {
  const l = String(level || "").trim().toUpperCase();
  if (l === "AAA") return "MiLB";
  return l;
};

// Match legacy safeId - strip spaces/special chars for consistent keying
const safeId = (key) =>
  String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-");

// Build the API-shape links map from canonical account fields.
// Byte-identical to pre-PR-B behavior on Sheets path:
//   * dir_links row exists for this team_key -> emit 4-keys map
//     (even if all 4 URLs are blank strings, matches old linkMap[key])
//   * no dir_links row -> emit {} (matches old `linkMap[key] || {}`)
// On Postgres path, _hasDirLinksRow is always true (the folded schema
// has no "no row" concept), so PG reads always emit the 4-keys map.
function buildLinksMap(account) {
  if (!account._hasDirLinksRow) return {};
  return {
    "Homestand":                     String(account.homestandUrl        || ""),
    "Service Level Agreement (SLA)": String(account.slaUrl              || ""),
    "Service Calendars":             String(account.serviceCalendarsUrl || ""),
    "Drive":                         String(account.driveUrl            || ""),
  };
}

// Convert a canonical account record (from getAccounts) into the
// 24-field bootstrap team-object shape the frontend expects.
// Field-for-field identical to the pre-PR-B handler at line 100-128.
function accountToTeam(account, contactMap) {
  const rawKey = account.teamKey;
  const id = safeId(rawKey);
  return {
    id,
    rawKey,
    name:     account.name,
    level:    normalizeLevel(account.level),
    city:     account.city,
    state:    account.state,
    season:   account.season,
    stadium:  account.stadium,
    img:      account.stadiumHeaderUrl, // canonical -> Sheet-field name
    logo:     account.logoUrl,           // canonical -> Sheet-field name
    address:  account.address,
    lat:      account.lat,
    long:     account.longitude,         // canonical -> Sheet-field name
    tz:       account.timezone,          // canonical -> Sheet-field name
    wifiName: "",                        // DEAD col N - hardcoded ""
    wifiPass: "",                        // DEAD col O - hardcoded ""
    gateCode: "",                        // DEAD col P - hardcoded ""
    doorCode: "",                        // DEAD col Q - hardcoded ""
    gmapImg:  account.gmapUrl,           // canonical -> Sheet-field name
    active:   account.active,
    links:    buildLinksMap(account),
    contacts: contactMap[id] || [],
  };
}

export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    // ── Bootstrap: load all teams from HUB ──
    if (action === "bootstrap") {
      // admins is auth config (not migrating per audit) - still direct
      // readSheetSA. accounts / contacts / hero_images go through the
      // dataStore so dual-write + per-module read dispatch apply.
      const [accounts, contactRecords, heroes, adminsRaw] = await Promise.all([
        getAccounts({ module: DIRECTORY_MODULE }),
        getContacts({ module: DIRECTORY_MODULE }),
        getHeroImages({ module: DIRECTORY_MODULE }),
        readSheetSA(SHEET_IDS.HUB, "admins"),
      ]);

      // Hero image - random pick from the global pool
      const heroUrls = heroes.map((h) => String(h.url || "").trim()).filter(Boolean);
      const heroImage = heroUrls.length
        ? heroUrls[Math.floor(Math.random() * heroUrls.length)]
        : "";

      // isAdmin + firstName from session + admins tab
      const userEmail = session.user?.email?.toLowerCase().trim() || "";
      const adminEmails = (adminsRaw.rows || [])
        .map((r) => String(r[0] || "").toLowerCase().trim())
        .filter(Boolean);
      const isAdmin = adminEmails.includes(userEmail);
      const fullName = session.user?.name || "";
      const firstName = fullName
        ? fullName.split(" ")[0]
        : userEmail.split("@")[0].replace(/^\w/, (c) => c.toUpperCase());

      // isPeopleAdmin: separate gate from the directory `isAdmin` above.
      // Super-admin (OPS_LEADERSHIP_EMAILS code allowlist) OR
      // people.is_ops_leadership DB flag. See requirePeopleAdmin() for
      // the full gate used by API actions.
      let isPeopleAdmin = false;
      if (OPS_LEADERSHIP_SET.has(userEmail)) {
        isPeopleAdmin = true;
      } else if (userEmail) {
        try {
          const supa = getServiceClient();
          const { data } = await supa
            .from("people")
            .select("is_ops_leadership")
            .ilike("work_email", userEmail)
            .maybeSingle();
          if (data?.is_ops_leadership === true) isPeopleAdmin = true;
        } catch { /* non-fatal: assume no admin access */ }
      }

      // contactMap: keyed by safeId(teamKey), values are arrays of
      // API-shape contact objects matching the pre-PR-B handler's
      // contactMap.push({ role, name, email, phone, slack, slackId })
      // (note: API uses .slack and .slackId; dataStore canonical uses
      // .slackHandle and .slackUserId)
      const contactMap = {};
      for (const c of contactRecords) {
        const key = safeId(c.teamKey);
        if (!key) continue;
        if (!contactMap[key]) contactMap[key] = [];
        contactMap[key].push({
          role:    c.role,
          name:    c.name,
          email:   c.email,
          phone:   c.phone,
          slack:   c.slackHandle,
          slackId: c.slackUserId,
        });
      }

      // Build teams - field-for-field match to pre-PR-B shape
      const teams = accounts
        .filter((a) => String(a.teamKey || "").trim())
        .map((a) => accountToTeam(a, contactMap))
        .filter((t) => t.id !== "");

      // Sort: MLB -> PDC -> MiLB, then alpha within group
      const levelOrder = ["MLB", "PDC", "MiLB"];
      teams.sort((a, b) => {
        const ia = levelOrder.indexOf(a.level);
        const ib = levelOrder.indexOf(b.level);
        const oa = ia === -1 ? 99 : ia;
        const ob = ib === -1 ? 99 : ib;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });

      return NextResponse.json({ success: true, teams, heroImage, firstName, isAdmin, isPeopleAdmin });
    }

    // ── Stage 3 admin-people-list ────────────────────────────────────
    // All ACTIVE people + their 19 permission columns. Powers the
    // People tab. Gate: super-admin or is_ops_leadership.
    if (action === "admin-people-list") {
      const authResult = await requirePeopleAdmin(session);
      if (!authResult.ok) return NextResponse.json({ error: authResult.reason }, { status: authResult.status });
      const supa = getServiceClient();
      const rows = await fetchActivePeople(supa);
      const people = rows.map((r) => {
        const email = String(r.work_email || "").toLowerCase().trim();
        return {
          worker_id:     r.worker_id,
          work_email:    r.work_email,
          display_name:  r.display_name,
          title:         r.title,
          status:        r.status,
          is_super_admin: email ? SUPER_ADMINS_SET.has(email) : false,
          ...Object.fromEntries([...EDITABLE_COLUMNS].map((c) => [c, r[c] ?? null])),
        };
      });
      return NextResponse.json({ success: true, people, columnLabels: COLUMN_LABELS });
    }

    // ── Stage 3 admin-permissions-view ───────────────────────────────
    // Reverse lookup: who has permission X? Gate: super-admin or ops.
    if (action === "admin-permissions-view") {
      const authResult = await requirePeopleAdmin(session);
      if (!authResult.ok) return NextResponse.json({ error: authResult.reason }, { status: authResult.status });
      const column = String(searchParams.get("column") || "").trim();
      if (!EDITABLE_COLUMNS.has(column)) {
        return NextResponse.json({ error: `unknown column: ${column}` }, { status: 400 });
      }
      const supa = getServiceClient();
      // Build the query per column type. Booleans: WHERE col = TRUE.
      // Enums: WHERE col IS NOT NULL AND col != default. Free text:
      // WHERE col IS NOT NULL AND col != ''.
      let q = supa
        .from("people")
        .select(`${PEOPLE_IDENTITY_COLS}, ${column}`)
        .eq("status", "ACTIVE");
      if (BOOLEAN_COLUMNS.has(column)) {
        q = q.eq(column, true);
      } else if (column === "incident_notify") {
        q = q.neq(column, "none");
      } else if (column === "opd_access_tier") {
        q = q.neq(column, "unrestricted");
      } else {
        // Enum (kpi_role, region) or free text - just non-null.
        q = q.not(column, "is", null);
      }
      const { data, error } = await q.order("display_name", { ascending: true });
      if (error) return NextResponse.json({ error: `[admin-permissions-view] ${error.message}` }, { status: 500 });
      const type = BOOLEAN_COLUMNS.has(column) ? "boolean"
                 : ENUM_COLUMNS[column]       ? "enum"
                 : "text";
      const people = (data || []).map((r) => ({
        worker_id:    r.worker_id,
        work_email:   r.work_email,
        display_name: r.display_name,
        title:        r.title,
        value:        r[column],
      }));
      return NextResponse.json({ success: true, column, type, label: COLUMN_LABELS[column] || column, people });
    }

    // ── Stage 3 admin-changelog ──────────────────────────────────────
    // Recent changelog entries, paginated. Gate: super-admin or ops.
    if (action === "admin-changelog") {
      const authResult = await requirePeopleAdmin(session);
      if (!authResult.ok) return NextResponse.json({ error: authResult.reason }, { status: authResult.status });
      const limitRaw = parseInt(searchParams.get("limit") || "50", 10);
      const offsetRaw = parseInt(searchParams.get("offset") || "0", 10);
      const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
      const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
      const supa = getServiceClient();
      const { data, error, count } = await supa
        .from("people_changelog")
        .select("id, person_email, person_name, column_name, old_value, new_value, reason, changed_by, changed_at", { count: "exact" })
        .order("changed_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) return NextResponse.json({ error: `[admin-changelog] ${error.message}` }, { status: 500 });
      return NextResponse.json({ success: true, entries: data || [], total: count ?? (data || []).length, columnLabels: COLUMN_LABELS });
    }

    // ── Drive Image Proxy ──
    // Fetches a Drive-restricted image server-side using the canonical service account.
    // PR B2 D.3a (2026-05-22) confirmed all 12 gmapImg files in production are SA-readable.
    // Returns { data: "data:image/jpeg;base64,..." } or { data: null } on failure.
    if (action === "drive-image") {
      const url = searchParams.get("url");
      if (!url) return NextResponse.json({ data: null }, { status: 400 });

      const fileId = getDriveFileId(url);
      if (!fileId) return NextResponse.json({ data: null }, { status: 400 });

      try {
        const drive = getServiceAccountDriveClient();
        const [meta, file] = await Promise.all([
          drive.files.get({ fileId, fields: "mimeType", supportsAllDrives: true }),
          drive.files.get(
            { fileId, alt: "media", supportsAllDrives: true },
            { responseType: "arraybuffer" }
          ),
        ]);

        const mimeType = meta.data.mimeType || "image/jpeg";
        const buffer = Buffer.from(file.data);
        const base64 = buffer.toString("base64");
        return NextResponse.json({ data: `data:${mimeType};base64,${base64}` });
      } catch (e) {
        console.warn("[Directory] Drive proxy error:", e.message);
        return NextResponse.json({ data: null });
      }
    }

    // ── hero-list: return all hero image URLs for admin panel ──
    if (action === "hero-list") {
      const heroes = await getHeroImages({ module: DIRECTORY_MODULE });
      const urls = heroes.map((h) => String(h.url || "").trim()).filter(Boolean);
      return NextResponse.json({ success: true, urls });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Directory GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Map admin-update-account payload fields to the dataStore upsertAccount
// canonical partial. The frontend's `fields` object uses Sheet-style
// names (img, logo, long, tz, gmapImg); the dataStore canonical uses
// camelCase Postgres-aligned names. This is the one-place translation.
function fieldsPayloadToPartial(fields, currentAccount) {
  const partial = {};
  if ("name" in fields)     partial.name             = fields.name             ?? currentAccount.name             ?? "";
  if ("level" in fields)    partial.level            = fields.level            ?? currentAccount.level            ?? "";
  if ("city" in fields)     partial.city             = fields.city             ?? currentAccount.city             ?? "";
  if ("state" in fields)    partial.state            = fields.state            ?? currentAccount.state            ?? "";
  if ("season" in fields)   partial.season           = fields.season           ?? currentAccount.season           ?? "";
  if ("stadium" in fields)  partial.stadium          = fields.stadium          ?? currentAccount.stadium          ?? "";
  if ("img" in fields)      partial.stadiumHeaderUrl = fields.img              ?? currentAccount.stadiumHeaderUrl ?? "";
  if ("logo" in fields)     partial.logoUrl          = fields.logo             ?? currentAccount.logoUrl          ?? "";
  if ("address" in fields)  partial.address          = fields.address          ?? currentAccount.address          ?? "";
  if ("lat" in fields)      partial.lat              = fields.lat              ?? currentAccount.lat              ?? "";
  if ("long" in fields)     partial.longitude        = fields.long             ?? currentAccount.longitude        ?? "";
  if ("tz" in fields)       partial.timezone         = fields.tz               ?? currentAccount.timezone         ?? "";
  if ("gmapImg" in fields)  partial.gmapUrl          = fields.gmapImg          ?? currentAccount.gmapUrl          ?? "";
  return partial;
}

// Map the API-shape links object (keys "Homestand"/"SLA"/.../"Drive")
// to the canonical URL fields the dataStore upsertAccount expects.
function linksPayloadToPartial(links) {
  if (!links) return {};
  return {
    homestandUrl:        links["Homestand"]                     || "",
    slaUrl:              links["Service Level Agreement (SLA)"] || "",
    serviceCalendarsUrl: links["Service Calendars"]             || "",
    driveUrl:            links["Drive"]                         || "",
  };
}

// Build the work_locations row from account fields (matches the pre-
// PR-B upsertWorkLocation helper: location_name = "City, Team Name").
function buildWorkLocationPartial(teamName, city, state) {
  const locationName = [city, state ? `(${teamName})` : teamName].filter(Boolean).join(", ");
  return { locationName, teamName };
}

// ══════════════════════════════════════════════
// POST - Admin write-back endpoints
// ══════════════════════════════════════════════
export async function POST(request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body   = await request.json();
    const action = body.action;

    // ── Stage 3 admin-people-update ─────────────────────────────────────
    // Gated on super-admin or is_ops_leadership (NOT the directory
    // DIRECTORY_ADMIN_EMAILS env var that gates the original 5
    // directory-admin actions). Lives first so the inner directory gate
    // never runs for people-admin requests.
    if (action === "admin-people-update") {
      const authResult = await requirePeopleAdmin(session);
      if (!authResult.ok) return NextResponse.json({ error: authResult.reason }, { status: authResult.status });

      const { email, column, value, reason } = body;

      // ─── Validation ───────────────────────────────────────────
      const emailLc = String(email || "").toLowerCase().trim();
      if (!emailLc) return NextResponse.json({ error: "email required" }, { status: 400 });
      if (!column || !EDITABLE_COLUMNS.has(column)) {
        return NextResponse.json({ error: `unknown column: ${column}` }, { status: 400 });
      }
      const reasonTrim = String(reason || "").trim();
      if (reasonTrim.length === 0) {
        return NextResponse.json({ error: "reason required (non-empty)" }, { status: 400 });
      }
      if (reasonTrim.length > 280) {
        return NextResponse.json({ error: "reason must be <= 280 chars" }, { status: 400 });
      }
      // Type check the value against the column
      let coerced;
      if (BOOLEAN_COLUMNS.has(column)) {
        if (typeof value !== "boolean") {
          return NextResponse.json({ error: `${column} requires a boolean value` }, { status: 400 });
        }
        coerced = value;
      } else if (ENUM_COLUMNS[column]) {
        if (value !== null && typeof value !== "string") {
          return NextResponse.json({ error: `${column} requires a string or null` }, { status: 400 });
        }
        if (!ENUM_COLUMNS[column].has(value)) {
          const allowed = [...ENUM_COLUMNS[column]].map((v) => v === null ? "null" : `'${v}'`).join(", ");
          return NextResponse.json({ error: `${column} must be one of: ${allowed}` }, { status: 400 });
        }
        coerced = value;
      } else {
        // Free text
        if (value !== null && typeof value !== "string") {
          return NextResponse.json({ error: `${column} requires a string or null` }, { status: 400 });
        }
        coerced = value === null ? null : String(value).trim() || null;
      }

      const supa = getServiceClient();

      // ─── Load current row ───────────────────────────────────
      const { data: current, error: readErr } = await supa
        .from("people")
        .select(`worker_id, work_email, display_name, ${column}`)
        .ilike("work_email", emailLc)
        .maybeSingle();
      if (readErr) return NextResponse.json({ error: `[admin-people-update] read: ${readErr.message}` }, { status: 500 });
      if (!current) return NextResponse.json({ error: `no person with work_email=${emailLc}` }, { status: 404 });

      // ─── Super-admin guard: can't un-flag is_ops_leadership for
      // SUPER_ADMINS members through the UI. Narrower than the panel-
      // access OPS_LEADERSHIP check: the other 5 ops-leadership members
      // CAN have their flag flipped (role change scenario), but Kevin
      // has structural immunity so he can never lock himself out of
      // the ops_leadership gate the whole panel depends on.
      if (column === "is_ops_leadership" && SUPER_ADMINS_SET.has(emailLc)) {
        return NextResponse.json({
          error: "cannot modify super-admin ops leadership flag",
        }, { status: 403 });
      }

      const oldValue = current[column] ?? null;
      if (oldValue === coerced) {
        return NextResponse.json({ success: true, changed: false, message: "no change" });
      }

      // ─── Update + changelog ─────────────────────────────────
      const { error: updErr } = await supa
        .from("people")
        .update({ [column]: coerced })
        .eq("worker_id", current.worker_id);
      if (updErr) return NextResponse.json({ error: `[admin-people-update] update: ${updErr.message}` }, { status: 500 });

      const { error: logErr } = await supa.from("people_changelog").insert({
        person_email: current.work_email || emailLc,
        person_name:  current.display_name || null,
        column_name:  column,
        old_value:    oldValue,
        new_value:    coerced,
        reason:       reasonTrim,
        changed_by:   session.user.email,
      });
      if (logErr) {
        // Changelog insert failed but the update landed - report so Kevin
        // can decide. We do NOT try to roll back the update because the
        // audit trail is less important than the operational write.
        console.error("[admin-people-update] changelog insert failed:", logErr.message);
        return NextResponse.json({
          success: true,
          changed: true,
          changelog_warning: `changelog insert failed: ${logErr.message}`,
        });
      }
      return NextResponse.json({ success: true, changed: true });
    }

    // ── INTERIM ADMIN GATE (PR B1, 2026-05-22) ───────────────────────────
    // Directory is Kevin-only for now via DIRECTORY_ADMIN_EMAILS. See
    // people module's "hr" flag and the inconsistency note documented in
    // BUSINESS_NOTES; both are retired by the Stage 1 auth model.
    // Fail-closed: if DIRECTORY_ADMIN_EMAILS is unset/empty, nobody passes.
    const directoryAdmins = String(process.env.DIRECTORY_ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.toLowerCase().trim())
      .filter(Boolean);
    const requesterEmail = session.user?.email?.toLowerCase().trim() || "";
    if (!directoryAdmins.includes(requesterEmail)) {
      return NextResponse.json({ error: "Admin authorization required" }, { status: 403 });
    }

    // ── admin-update-account ──────────────────────────────────────────────
    // Multi-table write: accounts (incl. folded dir_links URLs) + work_locations.
    // Coordinated sequentially (Sheets-first, PG best-effort).
    if (action === "admin-update-account") {
      const { accountId, fields, links } = body;
      const accounts = await getAccounts({ module: DIRECTORY_MODULE });
      const current = accounts.find((a) => safeId(a.teamKey) === accountId);
      if (!current) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const sheetKey = current.teamKey; // raw key, not safeId
      const accountPartial = fieldsPayloadToPartial(fields, current);
      // Merge folded dir_links partial when frontend sent links
      const linkPartial = links ? linksPayloadToPartial(links) : {};
      const fullPartial = { ...accountPartial, ...linkPartial };

      // 1) accounts (incl. dir_links folded on PG; Sheets writes both tabs)
      await upsertAccount(sheetKey, fullPartial);
      // 2) work_locations sync (derived from name/city/state)
      const wlPartial = buildWorkLocationPartial(
        fields.name  ?? current.name,
        fields.city  ?? current.city,
        fields.state ?? current.state
      );
      await upsertWorkLocation(sheetKey, wlPartial);

      return NextResponse.json({ success: true });
    }

    // ── admin-add-account ─────────────────────────────────────────────────
    // New row in accounts (+ folded dir_links URLs), work_locations.
    if (action === "admin-add-account") {
      const { fields, links } = body;
      if (!fields.rawKey || !fields.name)
        return NextResponse.json({ error: "rawKey and name required" }, { status: 400 });

      // For a new account, fieldsPayloadToPartial would dereference a non-
      // existent "current" - build the partial inline from the payload.
      const accountPartial = {
        name:             fields.name             || "",
        level:            fields.level            || "MLB",
        city:             fields.city             || "",
        state:            fields.state            || "",
        season:           fields.season           || "",
        stadium:          fields.stadium          || "",
        stadiumHeaderUrl: fields.img              || "",
        logoUrl:          fields.logo             || "",
        address:          fields.address          || "",
        lat:              fields.lat              || "",
        longitude:        fields.long             || "",
        timezone:         fields.tz               || "",
        gmapUrl:          fields.gmapImg          || "",
      };
      const linkPartial = links ? linksPayloadToPartial(links) : {};
      const fullPartial = { ...accountPartial, ...linkPartial };

      await upsertAccount(fields.rawKey, fullPartial);
      const wlPartial = buildWorkLocationPartial(
        fields.name,
        fields.city,
        fields.state
      );
      await upsertWorkLocation(fields.rawKey, wlPartial);

      return NextResponse.json({ success: true });
    }

    // ── admin-deactivate-account ──────────────────────────────────────────
    if (action === "admin-deactivate-account") {
      const { accountId } = body;
      const accounts = await getAccounts({ module: DIRECTORY_MODULE });
      const current = accounts.find((a) => safeId(a.teamKey) === accountId);
      if (!current) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const sheetKey = current.teamKey;
      await upsertAccount(sheetKey, { active: false });
      await deleteWorkLocation(sheetKey);

      return NextResponse.json({ success: true });
    }

    // ── admin-reactivate-account ──────────────────────────────────────────
    if (action === "admin-reactivate-account") {
      const { accountId } = body;
      const accounts = await getAccounts({ module: DIRECTORY_MODULE });
      const current = accounts.find((a) => safeId(a.teamKey) === accountId);
      if (!current) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const sheetKey = current.teamKey;
      await upsertAccount(sheetKey, { active: true });
      const wlPartial = buildWorkLocationPartial(
        current.name,
        current.city,
        current.state
      );
      await upsertWorkLocation(sheetKey, wlPartial);

      return NextResponse.json({ success: true });
    }

    // ── admin-update-contacts ─────────────────────────────────────────────
    // Replace-all-for-account flow. The dataStore's replaceContactsForAccount
    // includes the col-G preservation logic (and H/I/J reference-cols
    // preservation) - see dataStore.js for details.
    if (action === "admin-update-contacts") {
      const { accountId, contacts } = body;

      // Resolve raw teamKey from accountId (which is safeId-encoded)
      const accounts = await getAccounts({ module: DIRECTORY_MODULE });
      const current = accounts.find((a) => safeId(a.teamKey) === accountId);
      const realKey = current?.teamKey || accountId;

      await replaceContactsForAccount(realKey, contacts || []);

      return NextResponse.json({ success: true });
    }

    // ── admin-update-heroes ───────────────────────────────────────────────
    if (action === "admin-update-heroes") {
      const { urls } = body;
      await replaceHeroImages(urls || []);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Directory POST]", error.message, error.stack);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

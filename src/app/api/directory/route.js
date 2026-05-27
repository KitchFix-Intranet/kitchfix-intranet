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
import { NextResponse } from "next/server";
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

      return NextResponse.json({ success: true, teams, heroImage, firstName, isAdmin });
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

    const body   = await request.json();
    const action = body.action;

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

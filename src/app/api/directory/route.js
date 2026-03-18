import { auth } from "@/lib/auth";
import { readSheet, SHEET_IDS } from "@/lib/sheets";
import { google } from "googleapis";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/analytics";
// ═══════════════════════════════════════
// TEAM DIRECTORY API — v1.0
// Actions: bootstrap, drive-image
// Sheets: HUB (accounts, links, contacts — read-only)
// ═══════════════════════════════════════

function getDriveClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

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

// Match legacy safeId — strip spaces/special chars for consistent keying
const safeId = (key) =>
  String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-");

// Module-level sheet reader — usable in both GET and POST
async function safeReadSheet(token, sheetId, tab) {
  try {
    const result = await readSheet(token, sheetId, tab);
    // readSheet returns { headers, rows } — we want the rows array
    return Array.isArray(result) ? result : (result?.rows || []);
  } catch (e) {
    console.warn(`[Directory] Sheet "${tab}" error:`, e.message);
    return [];
  }
}

// Build authenticated Sheets client from a user token
function getSheetsClient(token) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.sheets({ version: "v4", auth });
}

// Helper: get numeric sheetId for batchUpdate
async function getSheetTabId(sheetsClient, spreadsheetId, tabName) {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === tabName);
  return sheet?.properties?.sheetId ?? 0;
}


export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = session.accessToken;
  if (!token) return NextResponse.json({ error: "No access token" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  const safeRead = async (id, tab) => {
    try {
      return await readSheet(token, id, tab);
    } catch (e) {
      console.warn(`[Directory] Sheet "${tab}" error:`, e.message);
      return { headers: [], rows: [] };
    }
  };

  try {
    // ── Bootstrap: load all teams from HUB ──
    if (action === "bootstrap") {
      const [accountsRaw, linksRaw, contactsRaw, heroRaw, adminsRaw] = await Promise.all([
        safeRead(SHEET_IDS.HUB, "accounts"),
        safeRead(SHEET_IDS.HUB, "dir_links"),
        safeRead(SHEET_IDS.HUB, "contacts"),
        safeRead(SHEET_IDS.HUB, "hero_images"),
        safeRead(SHEET_IDS.HUB, "admins"),
      ]);

      // Hero image — random pick from all rows
      const heroUrls = (heroRaw.rows || []).map(r => r[0]?.trim()).filter(Boolean);
      const heroImage = heroUrls.length
        ? heroUrls[Math.floor(Math.random() * heroUrls.length)]
        : "";

      // First name derived from session email
const userEmail = session.user?.email?.toLowerCase().trim() || "";
         logEvent(token, { email: userEmail, category: "directory", action: "page_view", page: "/directory" });
         const adminEmails = (adminsRaw.rows || []).map(r => String(r[0] || "").toLowerCase().trim()).filter(Boolean);
      const isAdmin = adminEmails.includes(userEmail);
      const fullName = session.user?.name || "";
      const firstName = fullName
        ? fullName.split(" ")[0]
        : userEmail.split("@")[0].replace(/^\w/, c => c.toUpperCase());

      // Wide format: A=TeamKey B=Homestand C=SLA D=ServiceCalendars E=Drive
      const linkMap = {};
      for (const r of linksRaw.rows) {
        const key = safeId(String(r[0] || "").trim());
        if (!key) continue;
        linkMap[key] = {
          "Homestand":                  String(r[1] || "").trim(),
          "Service Level Agreement (SLA)": String(r[2] || "").trim(),
          "Service Calendars":          String(r[3] || "").trim(),
          "Drive":                      String(r[4] || "").trim(),
        };
      }

      // contactMap: { safeTeamKey: [{ role, name, email, phone, slack, slackId }] }
      const contactMap = {};
      for (const r of contactsRaw.rows) {
        const key = safeId(r[0]);
        if (!key) continue;
        if (!contactMap[key]) contactMap[key] = [];
        contactMap[key].push({
          role:    String(r[1] || "").trim(),
          name:    String(r[2] || "").trim(),
          email:   String(r[3] || "").trim(),
          phone:   String(r[4] || "").trim(),
          slack:   String(r[5] || "").trim(),
          slackId: String(r[6] || "").trim(),
        });
      }

      // Teams — column map matches Hub 4.0 accounts tab schema:
      // [0]TeamKey [1]Team Name [2]Level [3]City [4]State [5]Season
      // [6]Stadium Name [7]Stadium Header URL [8]Logo URL [9]gmap
      // [9]Address [10]Lat [11]Long [12]Timezone
      // [13]Wifi SSID [14]Wifi Pass [15]Gate Code [16]Door Code [17]gmap
      const teams = accountsRaw.rows
        .filter((r) => r[0])
        .map((r) => {
          const rawKey = String(r[0] || "").trim();
          const key = safeId(rawKey);
          return {
            id:       key,
            rawKey,
            name:     String(r[1]  || "").trim(),
            level:    normalizeLevel(r[2]),
            city:     String(r[3]  || "").trim(),
            state:    String(r[4]  || "").trim(),
            season:   String(r[5]  || "").trim(),
            stadium:  String(r[6]  || "").trim(),
            img:      String(r[7]  || "").trim(), // Stadium Header URL
            logo:     String(r[8]  || "").trim(), // Logo URL
            address:  String(r[9]  || "").trim(), // J
            lat:      String(r[10] || "").trim(), // K
            long:     String(r[11] || "").trim(), // L
            tz:       String(r[12] || "").trim(), // M - Timezone
            wifiName: String(r[13] || "").trim(), // N - Wifi SSID
            wifiPass: String(r[14] || "").trim(), // O - Wifi Pass
            gateCode: String(r[15] || "").trim(), // P - Gate Code
            doorCode: String(r[16] || "").trim(), // Q - Door Code
            gmapImg:  String(r[17] || "").trim(), // R - gmap Drive link
            active:   String(r[18] || "").trim().toUpperCase() !== "FALSE", // S - Active (default true if blank)
            links:    linkMap[key]    || {},
            contacts: contactMap[key] || [],
          };
        })
        .filter((t) => t.id !== "");

      // Sort: MLB → PDC → MiLB, then alpha within group
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
    // Fetches a Drive-restricted image server-side using the user's OAuth token
    // Returns { data: "data:image/jpeg;base64,..." } or { data: null } on failure
    if (action === "drive-image") {
      const url = searchParams.get("url");
      if (!url) return NextResponse.json({ data: null }, { status: 400 });

      const fileId = getDriveFileId(url);
      if (!fileId) return NextResponse.json({ data: null }, { status: 400 });

      try {
        const drive = getDriveClient(token);

        // Two parallel calls: metadata (for MIME type) + file bytes
        const [meta, file] = await Promise.all([
          drive.files.get({
            fileId,
            fields: "mimeType",
            supportsAllDrives: true,
          }),
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
      const raw  = await safeRead(SHEET_IDS.HUB, "hero_images");
      const rows = Array.isArray(raw) ? raw : (raw?.rows || []);
      const urls = rows.map(r => String(r[0] || "").trim()).filter(Boolean);
      return NextResponse.json({ success: true, urls });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Directory GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════
// POST — Admin write-back endpoints
// ══════════════════════════════════════════════
export async function POST(request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const token = session.accessToken;
    if (!token)  return NextResponse.json({ error: "No access token" }, { status: 400 });

    const body   = await request.json();
    const action = body.action;

    const sheets = getSheetsClient(token);

    // ── admin-update-account ──────────────────────────────────────────────
    if (action === "admin-update-account") {
      const { accountId, fields, links } = body;
      const rows = await safeReadSheet(token, SHEET_IDS.HUB, "accounts");
      const rowIdx = rows.findIndex(r => safeId(String(r[0] || "").trim()) === accountId);
      if (rowIdx === -1) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const r = rows[rowIdx];
      const sheetKey = String(r[0] || "").trim(); // real sheet value, not safeId
      const updated = [
        sheetKey,
        fields.name     ?? r[1]  ?? "",
        fields.level    ?? r[2]  ?? "",
        fields.city     ?? r[3]  ?? "",
        fields.state    ?? r[4]  ?? "",
        fields.season   ?? r[5]  ?? "",
        fields.stadium  ?? r[6]  ?? "",
        fields.img      ?? r[7]  ?? "",
        fields.logo     ?? r[8]  ?? "",
        fields.address  ?? r[9]  ?? "",
        fields.lat      ?? r[10] ?? "",
        fields.long     ?? r[11] ?? "",
        fields.tz       ?? r[12] ?? "",
        fields.wifiName ?? r[13] ?? "",
        fields.wifiPass ?? r[14] ?? "",
        fields.gateCode ?? r[15] ?? "",
        fields.doorCode ?? r[16] ?? "",
        fields.gmapImg  ?? r[17] ?? "",
      ];

      const sheetRow = rowIdx + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_IDS.HUB,
        range: `accounts!A${sheetRow}:R${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [updated] },
      });

      // ── Update work_locations tab ──
      await upsertWorkLocation(sheets, token, sheetKey,
        fields.name  ?? r[1]  ?? "",
        fields.city  ?? r[3]  ?? "",
        fields.state ?? r[4]  ?? "");

      // ── Update links tab ──
      if (links) await writeLinks(sheets, token, sheetKey, links);

      return NextResponse.json({ success: true });
    }

    // ── admin-add-account ─────────────────────────────────────────────────
    if (action === "admin-add-account") {
      const { fields, links } = body;
      if (!fields.rawKey || !fields.name)
        return NextResponse.json({ error: "rawKey and name required" }, { status: 400 });

      const newRow = [
        fields.rawKey, fields.name, fields.level || "MLB",
        fields.city   || "", fields.state  || "", fields.season  || "",
        fields.stadium || "", fields.img    || "", fields.logo    || "",
        fields.address || "", fields.lat    || "", fields.long    || "", fields.tz || "",
        fields.wifiName || "", fields.wifiPass || "", fields.gateCode || "", fields.doorCode || "",
        fields.gmapImg || "",
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_IDS.HUB,
        range: "accounts!A:R",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [newRow] },
      });

      // ── Add to work_locations tab ──
      await upsertWorkLocation(sheets, token, fields.rawKey, fields.name, fields.city, fields.state);

      // ── Append links ──
      if (links) await writeLinks(sheets, token, fields.rawKey, links);

      return NextResponse.json({ success: true });
    }

    // ── admin-deactivate-account ──────────────────────────────────────────
    if (action === "admin-deactivate-account") {
      const { accountId } = body;
      const rows = await safeReadSheet(token, SHEET_IDS.HUB, "accounts");
      const rowIdx = rows.findIndex(r => safeId(String(r[0] || "").trim()) === accountId);
      if (rowIdx === -1) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const r = rows[rowIdx];
      const sheetKey = String(r[0] || "").trim();
      const sheetRow = rowIdx + 2;

      // Write FALSE to col S (Active) only — preserve all other data intact
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_IDS.HUB,
        range: `accounts!S${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["FALSE"]] },
      });

      // Remove from work_locations
      await removeWorkLocation(sheets, token, sheetKey);

      return NextResponse.json({ success: true });
    }

    // ── admin-reactivate-account ──────────────────────────────────────────
    if (action === "admin-reactivate-account") {
      const { accountId } = body;
      const rows = await safeReadSheet(token, SHEET_IDS.HUB, "accounts");
      const rowIdx = rows.findIndex(r => safeId(String(r[0] || "").trim()) === accountId);
      if (rowIdx === -1) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const r = rows[rowIdx];
      const sheetKey = String(r[0] || "").trim();
      const sheetRow = rowIdx + 2;

      // Write TRUE to col S (Active)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_IDS.HUB,
        range: `accounts!S${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["TRUE"]] },
      });

      // Re-add to work_locations
      await upsertWorkLocation(sheets, token, sheetKey,
        String(r[1] || "").trim(),
        String(r[3] || "").trim(),
        String(r[4] || "").trim());

      return NextResponse.json({ success: true });
    }

    // ── admin-update-contacts ─────────────────────────────────────────────
if (action === "admin-update-contacts") {
       const { accountId, contacts } = body;
       logEvent(token, { email: session.user?.email?.toLowerCase().trim(), category: "directory", action: "tool_click", page: "/directory", detail: { type: "admin_update" } });
       const rows = await safeReadSheet(token, SHEET_IDS.HUB, "contacts");
       
      const toDelete = rows
        .map((r, i) => safeId(String(r[0] || "").trim()) === accountId ? i + 2 : null)
        .filter(Boolean)
        .reverse();

      const tabId = await getSheetTabId(sheets, SHEET_IDS.HUB, "contacts");

      for (const rowNum of toDelete) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_IDS.HUB,
          requestBody: {
            requests: [{ deleteDimension: {
              range: { sheetId: tabId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
            }}],
          },
        });
      }

      // Resolve real sheet key from first remaining row or the deleted ones
      const realKey = rows.find(r => safeId(String(r[0]||"").trim()) === accountId)?.[0]?.trim() || accountId;
      if (contacts.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_IDS.HUB,
          range: "contacts!A:F",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: contacts.map(c => [realKey, c.role, c.name, c.email, c.phone, c.slack]) },
        });
      }

      return NextResponse.json({ success: true });
    }

    // ── admin-update-heroes ───────────────────────────────────────────────
    if (action === "admin-update-heroes") {
      const { urls } = body;

      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_IDS.HUB,
        range: "hero_images!A:A",
      });

      if (urls.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_IDS.HUB,
          range: "hero_images!A1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: urls.map(u => [u]) },
        });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Directory POST]", error.message, error.stack);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── Write links rows (upsert by accountId + sheetKey) ─────────────────────
async function writeLinks(sheets, token, rawTeamKey, links) {
  // Wide format: A=TeamKey B=Homestand C=SLA D=ServiceCalendars E=Drive
  const newRow = [
    rawTeamKey,
    links["Homestand"]                    || "",
    links["Service Level Agreement (SLA)"] || "",
    links["Service Calendars"]             || "",
    links["Drive"]                         || "",
  ];

  const rows = await safeReadSheet(token, SHEET_IDS.HUB, "dir_links");
  const idx  = rows.findIndex(r => String(r[0] || "").trim() === rawTeamKey);

  if (idx !== -1) {
    // Update existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_IDS.HUB,
      range: `dir_links!A${idx + 2}:E${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_IDS.HUB,
      range: "dir_links!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });
  }
}

// ── Upsert a row in work_locations [A=location name, B=TeamKey, C=Team Name]
async function upsertWorkLocation(sheets, token, teamKey, teamName, city, state) {
  const rows = await safeReadSheet(token, SHEET_IDS.HUB, "work_locations");
  const locationName = [city, state ? `(${teamName})` : teamName].filter(Boolean).join(", ");
  const newRow = [locationName, teamKey, teamName];

  const idx = rows.findIndex(r => String(r[1] || "").trim() === teamKey);
  if (idx !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_IDS.HUB,
      range: `work_locations!A${idx + 2}:C${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_IDS.HUB,
      range: "work_locations!A:C",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    });
  }
}

// ── Remove a row from work_locations by teamKey ────────────────────────────
async function removeWorkLocation(sheets, token, teamKey) {
  const rows  = await safeReadSheet(token, SHEET_IDS.HUB, "work_locations");
  const idx   = rows.findIndex(r => String(r[1] || "").trim() === teamKey);
  if (idx === -1) return;

  const tabId = await getSheetTabId(sheets, SHEET_IDS.HUB, "work_locations");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_IDS.HUB,
    requestBody: {
      requests: [{ deleteDimension: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: idx + 1, endIndex: idx + 2 },
      }}],
    },
  });
}
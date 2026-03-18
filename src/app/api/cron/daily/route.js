import { NextResponse } from "next/server";
import { logEventSA, logHealthSA } from "@/lib/analytics";

// ═══════════════════════════════════════
// DAILY CRON — Notification Generator
// Schedule: Every day at 7:00 AM CT
// Handles: Inventory countdowns, period starts, birthdays, anniversaries, news
// ═══════════════════════════════════════

const SHEET_IDS = {
  HUB: process.env.MASTER_HUB_SHEET_ID,
  DB: process.env.PEOPLE_DB_SHEET_ID || process.env.MASTER_HUB_SHEET_ID,
};

// ═══════════════════════════════════════
// Service Account Auth (mirrors People route)
// ═══════════════════════════════════════
async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !keyRaw) throw new Error("Missing service account credentials");

  const privateKey = keyRaw.replace(/\\n/g, "\n");
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const claimSet = btoa(JSON.stringify(claims));
  const unsignedJwt = `${header}.${claimSet}`;
  const cryptoKey = await importPrivateKey(privateKey);
  const signature = await signJwt(unsignedJwt, cryptoKey);
  const jwt = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signJwt(input, key) {
  const encoded = new TextEncoder().encode(input);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoded);
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ═══════════════════════════════════════
// Sheet Helpers
// ═══════════════════════════════════════
async function readSheet(spreadsheetId, sheetName) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[Cron] Sheet read failed (${sheetName}):`, res.status);
    return [];
  }
  const json = await res.json();
  const rows = json.values || [];
  return rows.slice(1); // skip header
}

async function appendRow(spreadsheetId, sheetName, rowData) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [rowData] }),
  });
  return res.ok;
}

// ═══════════════════════════════════════
// Notification Writer
// Format matches People route: [timestamp, recipient, channel, subject, eventType, status, relatedInfo]
// Column H (read flag) left empty = unread
// ═══════════════════════════════════════
async function writeNotification(recipient, subject, eventType, relatedInfo) {
  const row = [
    new Date().toISOString(),
    recipient, // "ALL", single email, or comma-separated emails
    "bell",    // in-app only
    subject,
    eventType,
    "logged",
    relatedInfo || "",
  ];
  const ok = await appendRow(SHEET_IDS.DB, "notification_log", row);
  if (ok) console.log(`[Cron] ✅ ${eventType}: ${subject}`);
  else console.error(`[Cron] ❌ Failed to write: ${eventType}`);
  return ok;
}

// ═══════════════════════════════════════
// Dedup: check if today's notification already exists
// ═══════════════════════════════════════
function alreadyFired(existingRows, eventType, dedupKey) {
  const todayStr = new Date().toISOString().split("T")[0];
  return existingRows.some((row) => {
    const ts = String(row[0] || "");
    const et = String(row[4] || "");
    const related = String(row[6] || "");
    return (
      ts.startsWith(todayStr) &&
      et === eventType &&
      (!dedupKey || related.includes(dedupKey))
    );
  });
}

// ═══════════════════════════════════════
// Date helpers
// ═══════════════════════════════════════
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function todayClean() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a, b) {
  return Math.ceil((b - a) / (1000 * 60 * 60 * 24));
}

// ═══════════════════════════════════════
// Slack poster (fire-and-forget)
// ═══════════════════════════════════════
async function postSlack(webhookUrl, text, mrkdwn) {
  if (!webhookUrl) return;
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      blocks: mrkdwn ? [{ type: "section", text: { type: "mrkdwn", text: mrkdwn } }] : undefined,
    }),
  }).catch(() => {});
}

// ═══════════════════════════════════════
// MAIN CRON HANDLER
// ═══════════════════════════════════════
export async function GET(request) {
  // Verify cron secret (optional but recommended)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
console.log("[Cron] Daily notification run starting...");

     logEventSA({ category: "system", action: "cron_start", detail: { type: "daily" } });

     // Batch read all needed sheets
    const [periodRows, celebrationRows, newsRows, contactRows, notifRows] = await Promise.all([
      readSheet(SHEET_IDS.HUB, "period_data"),
      readSheet(SHEET_IDS.HUB, "personnel_celebrations"),
      readSheet(SHEET_IDS.HUB, "home_news"),
      readSheet(SHEET_IDS.HUB, "contacts"),
      readSheet(SHEET_IDS.DB, "notification_log"),
    ]);

    const today = todayClean();
    let written = 0;

    // ─── #2–5: Inventory Due Countdowns (ALL) ───
    // period_data: [0]=label, [1]=start, [2]=end, [3]=dueDate
    for (const row of periodRows) {
      const due = parseDate(row[3]);
      if (!due) continue;
      due.setHours(0, 0, 0, 0);

      const daysUntil = daysBetween(today, due);
      const label = String(row[0] || "Period");

if (daysUntil === 3 && !alreadyFired(notifRows, "inventory_due_3d", label)) {
        await writeNotification("ALL", `[OPS] Inventory due in 3 days - ${label}`, "inventory_due_3d", label);
        await postSlack(process.env.SLACK_INVENTORY_WEBHOOK, `Inventory due in 3 days - ${label}`, `*Reminder:* Inventory due in *3 days* for *${label}*`);
        written++;
      }
if (daysUntil === 2 && !alreadyFired(notifRows, "inventory_due_2d", label)) {
        await writeNotification("ALL", `[OPS] Inventory due in 2 days - ${label}`, "inventory_due_2d", label);
        await postSlack(process.env.SLACK_INVENTORY_WEBHOOK, `Inventory due in 2 days - ${label}`, `*Reminder:* Inventory due in *2 days* for *${label}*`);
        written++;
      }
      if (daysUntil === 1 && !alreadyFired(notifRows, "inventory_due_1d", label)) {
        await writeNotification("ALL", `[OPS] Inventory due tomorrow - ${label}`, "inventory_due_1d", label);
        await postSlack(process.env.SLACK_INVENTORY_WEBHOOK, `Inventory due tomorrow - ${label}`, `*Urgent:* Inventory due *tomorrow* for *${label}*`);
        written++;
      }
      if (daysUntil === 0 && !alreadyFired(notifRows, "inventory_due_today", label)) {
        await writeNotification("ALL", `[OPS] Inventory due today - ${label}`, "inventory_due_today", label);
        await postSlack(process.env.SLACK_INVENTORY_WEBHOOK, `Inventory due TODAY - ${label}`, `*DUE TODAY:* Inventory for *${label}* is due now!`);
        written++;
      }
        }

    // ─── #6: Inventory Past Due (account contacts only) ───
    // Check all periods — if due date has passed and no past-due notification sent today
    for (const row of periodRows) {
      const due = parseDate(row[3]);
      if (!due) continue;
      due.setHours(0, 0, 0, 0);

      const daysUntil = daysBetween(today, due);
      const label = String(row[0] || "Period");

      if (daysUntil < 0 && daysUntil >= -3) {
        // Past due by 1–3 days — look up contacts for each account
        // contacts: [0]=teamKey, [1]=role, [2]=name, [3]=email
        const accountKeys = new Set();
        // Get all account keys from contacts sheet
        for (const c of contactRows) {
          const key = String(c[0] || "").trim();
          if (key) accountKeys.add(key);
        }

        for (const accountKey of accountKeys) {
          const dedupKey = `${label}_${accountKey}`;
          if (alreadyFired(notifRows, "inventory_past_due", dedupKey)) continue;

          // Get email addresses for this account's contacts
          const accountEmails = contactRows
            .filter((c) => String(c[0] || "").trim() === accountKey && c[3])
            .map((c) => String(c[3]).trim())
            .filter((e) => e.includes("@"));

          if (accountEmails.length > 0) {
            const daysLate = Math.abs(daysUntil);
await writeNotification(
              accountEmails.join(", "),
              `[OPS] Inventory past due - ${label} (${daysLate}d overdue)`,
              "inventory_past_due",
              dedupKey
            );
            await postSlack(process.env.SLACK_INVENTORY_WEBHOOK, `Inventory PAST DUE: ${accountKey} - ${label}`, `*PAST DUE:* Inventory for *${accountKey}* - *${label}* is *${daysLate}d overdue*`);            written++;
          }
        }
      }
    }

    // ─── #8: New Period Starts (ALL) ───
    // period_data: [0]=label, [1]=start
    for (const row of periodRows) {
      const start = parseDate(row[1]);
      if (!start) continue;
      start.setHours(0, 0, 0, 0);

      const label = String(row[0] || "New Period");

      if (start.getTime() === today.getTime() && !alreadyFired(notifRows, "period_start", label)) {
await writeNotification("ALL", `[OPS] New period started - ${label}`, "period_start", label);
        await postSlack(process.env.SLACK_INVENTORY_WEBHOOK, `New period started: ${label}`, `*New Period:* *${label}* has started`);        written++;
      }
    }

    // ─── #13: New KitchFix News (ALL) ───
    // home_news: [0]=date, [1]=headline, [2]=category, [3]=body, [4]=link, [5]=pinned
    // Check if any news item has today's date
    const todayStr = today.toISOString().split("T")[0];
    for (const row of newsRows) {
      const newsDate = parseDate(row[0]);
      if (!newsDate) continue;
      const newsDateStr = newsDate.toISOString().split("T")[0];
      const headline = String(row[1] || "").trim();
      if (!headline) continue;

      if (newsDateStr === todayStr && !alreadyFired(notifRows, "news_posted", headline.slice(0, 40))) {
        await writeNotification("ALL", `[NEWS] ${headline}`, "news_posted", headline.slice(0, 40));
        written++;
      }
    }

    // ─── #14: Birthday (ALL) ───
    // personnel_celebrations: [0]=date, [1]=headline, [2]=type
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    for (const row of celebrationRows) {
      const d = parseDate(row[0]);
      if (!d) continue;

      const type = String(row[2] || "").trim();
      const rawName = String(row[1] || "");

      if (d.getMonth() !== todayMonth || d.getDate() !== todayDay) continue;

      // Clean the name
      let name = rawName
        .replace(/'s\s+Birthday.*/i, "")
        .replace(/'s\s+Anniversary.*/i, "")
        .replace(/Birthday.*/i, "")
        .replace(/Anniversary.*/i, "")
        .trim();
      if (!name) name = rawName.split(" ")[0] || "Team Member";

      if (type === "Birthday" && !alreadyFired(notifRows, "birthday", name)) {
        await writeNotification("ALL", `[CELEBRATION] Happy Birthday, ${name}! 🎂`, "birthday", name);
        written++;
      }

      // ─── #15: Work Anniversary (ALL) ───
      if (type !== "Birthday" && !alreadyFired(notifRows, "anniversary", name)) {
        const yearMatch = rawName.match(/(\d+)\s*Year/i);
        const years = yearMatch ? `${yearMatch[1]} Year ` : "";
        await writeNotification("ALL", `[CELEBRATION] Happy ${years}Anniversary, ${name}! 🎉`, "anniversary", name);
        written++;
      }
    }

console.log(`[Cron]   ✅ Done. ${written} notifications written.`);
      logEventSA({ category: "system", action: "cron_complete", detail: { written } });
      return NextResponse.json({ success: true, written });

} catch (error) {
      console.error("[Cron]   ❌ CRASH:", error.message, error.stack);
      logEventSA({ category: "system", action: "cron_error", status: "error", errorMsg: error.message, detail: { error: error.message } });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
}
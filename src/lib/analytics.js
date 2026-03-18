/**
 * ANALYTICS ENGINE — src/lib/analytics.js
 * Central event logging, health monitoring, and Slack alerting.
 * Fire-and-forget: never blocks the main action.
 *
 * Usage:
 *   import { logEvent, logHealth } from "@/lib/analytics";
 *   logEvent(token, { email, userName, category, action, page, detail, status });
 *   logHealth(token, { service, endpoint, status, responseMs, errorMsg });
 */

const ANALYTICS_SHEET_ID = process.env.ANALYTICS_SHEET_ID;
const SLACK_RECAP_WEBHOOK = process.env.SLACK_RECAP_WEBHOOK;

// Services that trigger instant Slack alerts on failure
const REALTIME_ALERT_SERVICES = ["gmail_api", "sheets_api", "slack_webhook", "drive_api"];

// ═══════════════════════════════════════
// CORE: Log Event (fires to `events` tab)
// ═══════════════════════════════════════
export async function logEvent(token, {
  email = "",
  userName = "",
  category = "system",    // auth|ops|people|directory|home|system
  action = "",            // login|page_view|submit_inventory|etc.
  page = "",              // /ops, /people, etc.
  detail = null,          // object — will be JSON.stringify'd
  durationMs = null,      // API response time
  status = "success",     // success|error|warning
  errorMsg = "",
  userAgent = "",
} = {}) {
  if (!ANALYTICS_SHEET_ID || !token) return;

  const row = [
    new Date().toISOString(),
    email,
    userName,
    category,
    action,
    page,
    detail ? (typeof detail === "string" ? detail : JSON.stringify(detail)) : "",
    durationMs != null ? Math.round(durationMs) : "",
    status,
    errorMsg,
    userAgent,
  ];

  appendToSheet(token, "events", row).catch((e) => {
    console.warn("[Analytics] Event log failed:", e.message);
  });
}

// ═══════════════════════════════════════
// CORE: Log Health (fires to `health_log` tab)
// Triggers real-time Slack alert on failure
// ═══════════════════════════════════════
export async function logHealth(token, {
  service = "",           // gmail_api|sheets_api|drive_api|slack_webhook|anthropic_api|cron_daily
  endpoint = "",
  status = "ok",          // ok|error|timeout|rate_limited
  responseMs = null,
  errorMsg = "",
  metadata = null,
} = {}) {
  if (!ANALYTICS_SHEET_ID || !token) return;

  const row = [
    new Date().toISOString(),
    service,
    endpoint,
    status,
    responseMs != null ? Math.round(responseMs) : "",
    errorMsg,
    metadata ? (typeof metadata === "string" ? metadata : JSON.stringify(metadata)) : "",
  ];

  appendToSheet(token, "health_log", row).catch((e) => {
    console.warn("[Analytics] Health log failed:", e.message);
  });

  // Real-time Slack alert on failure
  if (status !== "ok" && REALTIME_ALERT_SERVICES.includes(service)) {
    slackAlert(
      `*Service Alert*\n*Service:* ${service}\n*Status:* ${status}\n*Endpoint:* ${endpoint}\n*Error:* ${errorMsg || "No details"}${responseMs ? `\n*Response:* ${responseMs}ms` : ""}`
    ).catch(() => {});
  }
}

// ═══════════════════════════════════════
// CORE: Log Event via Service Account (no OAuth token needed)
// For use in cron jobs and server-side-only contexts
// ═══════════════════════════════════════
export async function logEventSA({
  email = "",
  userName = "",
  category = "system",
  action = "",
  page = "",
  detail = null,
  durationMs = null,
  status = "success",
  errorMsg = "",
  userAgent = "",
} = {}) {
  if (!ANALYTICS_SHEET_ID) return;

  const row = [
    new Date().toISOString(),
    email,
    userName,
    category,
    action,
    page,
    detail ? (typeof detail === "string" ? detail : JSON.stringify(detail)) : "",
    durationMs != null ? Math.round(durationMs) : "",
    status,
    errorMsg,
    userAgent,
  ];

  appendToSheetSA("events", row).catch((e) => {
    console.warn("[Analytics-SA] Event log failed:", e.message);
  });
}

export async function logHealthSA({
  service = "",
  endpoint = "",
  status = "ok",
  responseMs = null,
  errorMsg = "",
  metadata = null,
} = {}) {
  if (!ANALYTICS_SHEET_ID) return;

  const row = [
    new Date().toISOString(),
    service,
    endpoint,
    status,
    responseMs != null ? Math.round(responseMs) : "",
    errorMsg,
    metadata ? (typeof metadata === "string" ? metadata : JSON.stringify(metadata)) : "",
  ];

  appendToSheetSA("health_log", row).catch((e) => {
    console.warn("[Analytics-SA] Health log failed:", e.message);
  });

  if (status !== "ok" && REALTIME_ALERT_SERVICES.includes(service)) {
    slackAlert(
      `*Service Alert*\n*Service:* ${service}\n*Status:* ${status}\n*Endpoint:* ${endpoint}\n*Error:* ${errorMsg || "No details"}${responseMs ? `\n*Response:* ${responseMs}ms` : ""}`
    ).catch(() => {});
  }
}

// ═══════════════════════════════════════
// SLACK: Post to #intranet-recap
// ═══════════════════════════════════════
export async function slackRecap(text, blocks) {
  if (!SLACK_RECAP_WEBHOOK) return;
  const payload = { text };
  if (blocks) payload.blocks = blocks;
  await fetch(SLACK_RECAP_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function slackAlert(mrkdwn) {
  if (!SLACK_RECAP_WEBHOOK) return;
  await fetch(SLACK_RECAP_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Intranet Service Alert",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: mrkdwn },
        },
      ],
    }),
  });
}

// ═══════════════════════════════════════
// HELPERS: Timed fetch wrapper
// Use this to wrap external API calls for automatic health logging
// ═══════════════════════════════════════
export async function timedFetch(token, service, endpoint, fetchFn) {
  const start = Date.now();
  try {
    const result = await fetchFn();
    const ms = Date.now() - start;
    logHealth(token, { service, endpoint, status: "ok", responseMs: ms });
    return result;
  } catch (e) {
    const ms = Date.now() - start;
    logHealth(token, {
      service,
      endpoint,
      status: e.message?.includes("timeout") ? "timeout" : "error",
      responseMs: ms,
      errorMsg: e.message,
    });
    throw e;
  }
}

// Service account version
export async function timedFetchSA(service, endpoint, fetchFn) {
  const start = Date.now();
  try {
    const result = await fetchFn();
    const ms = Date.now() - start;
    logHealthSA({ service, endpoint, status: "ok", responseMs: ms });
    return result;
  } catch (e) {
    const ms = Date.now() - start;
    logHealthSA({
      service,
      endpoint,
      status: e.message?.includes("timeout") ? "timeout" : "error",
      responseMs: ms,
      errorMsg: e.message,
    });
    throw e;
  }
}

// ═══════════════════════════════════════
// SHEET WRITE: Append row via OAuth token
// ═══════════════════════════════════════
async function appendToSheet(token, tabName, rowData) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(tabName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [rowData] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheet append failed (${tabName}): ${res.status} ${err}`);
  }
}

// ═══════════════════════════════════════
// SHEET WRITE: Append row via Service Account
// For cron jobs and contexts without user OAuth token
// ═══════════════════════════════════════
async function appendToSheetSA(tabName, rowData) {
  const saToken = await getServiceAccountToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(tabName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${saToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [rowData] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheet SA append failed (${tabName}): ${res.status} ${err}`);
  }
}

// ═══════════════════════════════════════
// SHEET READ: Read tab via Service Account
// ═══════════════════════════════════════
export async function readAnalyticsSheet(tabName) {
  const saToken = await getServiceAccountToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(tabName)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${saToken}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.values || []).slice(1); // skip header
}

// ─── Write a single row to any analytics tab (Service Account) ───
// Used by daily aggregations that append one row at a time
export async function writeAnalyticsRow(tabName, rowData) {
  if (!ANALYTICS_SHEET_ID) return;
  await appendToSheetSA(tabName, rowData);
}


// ─── Clear a tab (keep header) and write fresh rows ───
// Used by weekly/monthly aggregations that rebuild entire tabs
export async function clearAndWriteAnalytics(tabName, rows) {
  if (!ANALYTICS_SHEET_ID || !rows.length) return;
  const saToken = await getServiceAccountToken();

  // Step 1: Clear all data below the header row (row 1)
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(tabName)}!A2:Z1000:clear`;
  await fetch(clearUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${saToken}`,
      "Content-Type": "application/json",
    },
  }).catch((e) => {
    console.warn(`[Analytics] Clear failed for ${tabName}:`, e.message);
  });

  // Step 2: Write all new rows starting at A2
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ANALYTICS_SHEET_ID}/values/${encodeURIComponent(tabName)}!A2?valueInputOption=USER_ENTERED`;
  const res = await fetch(writeUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${saToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`clearAndWrite failed (${tabName}): ${res.status} ${err}`);
  }
}

// ═══════════════════════════════════════
// Service Account JWT (mirrors People route pattern)
// ═══════════════════════════════════════
let _saTokenCache = { token: null, exp: 0 };

async function getServiceAccountToken() {
  if (_saTokenCache.token && Date.now() < _saTokenCache.exp) {
    return _saTokenCache.token;
  }

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

  const pemContents = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${unsignedJwt}.${signature}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) throw new Error(`SA token exchange failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  _saTokenCache = { token: tokenData.access_token, exp: Date.now() + 3500 * 1000 };
  return tokenData.access_token;
}
#!/usr/bin/env node
// One-off probe: print postId + title + col M URL for every news_posts row.
// Pass --fix to rewrite uc?export=view URLs into lh3.googleusercontent.com form.
//
// Usage:
//   node scripts/_probe_news_image_urls.mjs          # read-only
//   node scripts/_probe_news_image_urls.mjs --fix    # rewrites col M in place

import "dotenv/config";
import { google } from "googleapis";

const FIX = process.argv.includes("--fix");
const HUB = "1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: HUB,
  range: "news_posts!A:M",
});

const rows = res.data.values || [];
console.log(`Total rows (incl. header): ${rows.length}`);

const updates = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r[0]) continue;
  const url = r[12] || "";
  const sheetRow = i + 1;
  console.log(`Row ${sheetRow} | ${r[0]} | "${(r[1] || "").slice(0, 40)}" | col M: ${url || "(empty)"}`);

  if (FIX && url && url.includes("uc?export=view&id=")) {
    const m = url.match(/id=([^&]+)/);
    if (m) {
      const fileId = m[1];
      const newUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
      updates.push({ range: `news_posts!M${sheetRow}`, values: [[newUrl]] });
      console.log(`  → would write: ${newUrl}`);
    }
  }
}

if (FIX && updates.length > 0) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: HUB,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
  console.log(`\nFixed ${updates.length} row(s).`);
} else if (FIX) {
  console.log("\nNo rows needed fixing.");
}

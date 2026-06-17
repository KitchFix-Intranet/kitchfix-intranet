import { NextResponse } from "next/server";
import { SHEET_IDS, readSheetSA, appendRowSA } from "@/lib/sheets";
import { getUnfixedReturnedInvoices } from "@/lib/dataStore";
import { sendEmailSA } from "@/lib/gmail";

// ═══════════════════════════════════════
// DAILY CRON - Notification Generator
// Schedule: Every day at 7:00 AM CT
// Handles: Inventory countdowns, period starts, birthdays, anniversaries, news
//
// Auth + Sheets I/O: consolidated through src/lib/sheets.js helpers in PR #54
// (Bundle 3 PR A1). Previously had ~55 lines of hand-rolled JWT crypto + local
// readSheet/appendRow helpers + a duplicate local SHEET_IDS const.
// ═══════════════════════════════════════

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
  const { success: ok } = await appendRowSA(SHEET_IDS.COLLECTION, "notification_log", row);
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

     // Batch read all needed sheets. readSheetSA returns {headers, rows} per tab;
     // destructure .rows to preserve the existing periodRows/celebrationRows/etc. names.
    const [
      { rows: periodRows },
      { rows: celebrationRows },
      { rows: contactRows },
      { rows: notifRows },
    ] = await Promise.all([
      readSheetSA(SHEET_IDS.HUB, "period_data"),
      readSheetSA(SHEET_IDS.HUB, "personnel_celebrations"),
      readSheetSA(SHEET_IDS.HUB, "contacts"),
      readSheetSA(SHEET_IDS.COLLECTION, "notification_log"),
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

    // ─── Invoice: unfixed returned invoices (3-day reminder) ───
    // Dedup via alreadyFired with eventType "invoice_unfixed_3d" + dedupKey=uuid
    // means one ping per rejection. If the operator never fixes it, they only
    // get reminded once (not daily). Archive (status='archived') and correction
    // (status='corrected') both naturally drop the row from the query.
    try {
      const unfixed = await getUnfixedReturnedInvoices({ module: "ops" });
      for (const inv of unfixed) {
        const dedupKey = inv.uuid;
        if (alreadyFired(notifRows, "invoice_unfixed_3d", dedupKey)) continue;

        const submitter = inv.submitterEmail;
        if (!submitter) continue;

        const totalFmt = `$${Number(inv.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        const vendor = inv.vendorName || "Unknown vendor";
        const invNum = inv.invoiceNumber ? ` #${inv.invoiceNumber}` : "";

        await writeNotification(
          submitter,
          `Invoice needs fix: ${vendor}${invNum} ${totalFmt}`,
          "invoice_unfixed_3d",
          dedupKey
        );
        written++;

        const apEmail = process.env.INVOICE_AP_EMAIL || "k.fietek@kitchfix.com";
        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #153968;">Invoice Needs Attention</h2>
        <p>An invoice you submitted was returned by AP more than 3 days ago and still needs to be fixed:</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Vendor</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${vendor}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Invoice #</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${inv.invoiceNumber || "N/A"}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Account</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${inv.accountKey || "N/A"}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Total</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${totalFmt}</td></tr>
        </table>
        <p>Please log in to <a href="https://kitchfix-intranet.vercel.app/ops">Invoice Capture</a> and use <strong>Fix & Resubmit</strong> to correct and resubmit this invoice.</p>
        <p style="color: #64748b; font-size: 12px;">This is an automated reminder from KitchFix Ops Hub.</p>
      </div>
    `;

        try {
          await sendEmailSA({
            sender: apEmail,
            displayName: "KitchFix Invoice Capture",
            to: submitter,
            subject: `Action needed: ${vendor}${invNum} invoice returned - please fix and resubmit`,
            html,
            replyTo: apEmail,
          });
        } catch (emailErr) {
          console.warn(`[Cron] Invoice reminder email failed for ${inv.uuid}:`, emailErr.message);
        }
      }
    } catch (err) {
      console.error("[Cron] Invoice unfixed reminders failed:", err.message);
    }

console.log(`[Cron]   ✅ Done. ${written} notifications written.`);
      return NextResponse.json({ success: true, written });

} catch (error) {
      console.error("[Cron]   ❌ CRASH:", error.message, error.stack);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
}
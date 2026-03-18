import { NextResponse } from "next/server";

// ═══════════════════════════════════════
// PEOPLE PORTAL API
// Mirrors Apps Script: getBootstrapData, getMyPAFHistory,
// getAdminQueue, submitNewHire, submitPAF, processAdminAction
// ═══════════════════════════════════════

const SHEET_IDS = {
  HUB: process.env.MASTER_HUB_SHEET_ID,
  DB: process.env.PEOPLE_DB_SHEET_ID || process.env.MASTER_HUB_SHEET_ID,
};

const SHEETS = {
  HERO: "hero_images",
  ACCOUNTS: "accounts",
  CONTACTS: "contacts",
  ADMINS: "admins",
  NEW_HIRE_LOG: "newhire_log",
  PAF_LOG: "paf_log",
};

async function getAccessToken() {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function readSheet(spreadsheetId, sheetName) {
  try {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return { rows: [] };
    const json = await res.json();
    const rows = json.values || [];
    return { rows: rows.slice(1) }; // skip header
  } catch (e) {
    console.error(`[People] Sheet read error (${sheetName}):`, e.message);
    return { rows: [] };
  }
}

async function appendRow(spreadsheetId, sheetName, rowData) {
  try {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [rowData] }),
    });
    return { success: res.ok };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function updateCell(spreadsheetId, sheetName, row, col, value) {
  try {
    const token = await getAccessToken();
    const colLetter = String.fromCharCode(64 + col);
    const range = `${sheetName}!${colLetter}${row}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[value]] }),
    });
  } catch (e) {
    console.error(`[People] Cell update error:`, e.message);
  }
}

// ═══════════════════════════════════════
// GET: Bootstrap data
// ═══════════════════════════════════════
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "bootstrap";
    const userEmail = searchParams.get("email") || "";

    if (action === "bootstrap") {
      const [accounts, contacts, admins, pafLog, nhLog, heroImages] = await Promise.all([
        readSheet(SHEET_IDS.HUB, SHEETS.ACCOUNTS),
        readSheet(SHEET_IDS.HUB, SHEETS.CONTACTS),
        readSheet(SHEET_IDS.HUB, SHEETS.ADMINS),
        readSheet(SHEET_IDS.DB, SHEETS.PAF_LOG),
        readSheet(SHEET_IDS.DB, SHEETS.NEW_HIRE_LOG),
        readSheet(SHEET_IDS.HUB, SHEETS.HERO),
      ]);

      // Check admin status
      const isAdmin = admins.rows.some(
        (r) => String(r[0]).toLowerCase().trim() === userEmail.toLowerCase() && String(r[1]).toUpperCase() === "TRUE"
      );

      // Count user's submissions
      const counts = { paf: 0, newHire: 0, actionRequired: 0 };
      pafLog.rows.forEach((row) => {
        if (String(row[1] || "").toLowerCase().trim() === userEmail.toLowerCase()) {
          const status = row[29] || "Pending";
          if (status === "Pending") counts.paf++;
          if (status === "Rejected") counts.actionRequired++;
        }
      });
      nhLog.rows.forEach((row) => {
        if (String(row[1] || "").toLowerCase().trim() === userEmail.toLowerCase()) {
          const status = row[16] || "Pending";
          if (status === "Pending") counts.newHire++;
          if (status === "Rejected") counts.actionRequired++;
        }
      });

      // Get user first name
      let firstName = "Team";
      contacts.rows.forEach((row) => {
        if (String(row[3] || "").toLowerCase().trim() === userEmail.toLowerCase() && row[2]) {
          firstName = String(row[2]).split(" ")[0];
        }
      });

      // Locations and managers
      const locations = accounts.rows.filter((r) => r[0]).map((r) => ({ key: r[0], name: r[1] || r[0] }));
      const managers = contacts.rows.filter((r) => r[2]).map((r) => ({ teamKey: r[0], name: r[2] }));

      // Random hero image
      const heroUrls = heroImages.rows.flat().filter((u) => u && String(u).includes("http"));
      const heroImage = heroUrls.length ? heroUrls[Math.floor(Math.random() * heroUrls.length)] : "";

      // PAF config
      const pafConfig = {
        actionTypes: [
          { key: "separation", label: "Separation", category: "HR Actions" },
          { key: "title_change", label: "Change in Title", category: "HR Actions" },
          { key: "status_change", label: "Change Part-Time/Full-Time", category: "HR Actions" },
          { key: "reclassification", label: "Reclassification (Dept Change)", category: "HR Actions" },
          { key: "rate_change", label: "Change in Rate of Pay", category: "Payroll" },
          { key: "add_bonus", label: "Add One-Time Bonus", category: "Payroll" },
          { key: "add_deduction", label: "Add One-Time Deduction", category: "Payroll" },
          { key: "add_gratuity", label: "Add Gratuity", category: "Payroll" },
          { key: "add_cell_phone", label: "Cell Phone Reimbursement", category: "Expenses" },
          { key: "travel_reimbursement", label: "Travel Reimbursement", category: "Expenses" },
          { key: "other_reimbursement", label: "Other Reimbursement", category: "Expenses" },
        ],
        travelRates: {
          supplementRate: 50,
          perDiemRates: {
            noMeals: 80, breakfastOnly: 65, lunchOnly: 60, dinnerOnly: 45,
            breakfastLunch: 45, breakfastDinner: 30, lunchDinner: 25, allMeals: 10,
          },
        },
      };

      return NextResponse.json({
        success: true,
        userEmail,
        firstName,
        heroImage,
        locations,
        managers,
        pafConfig,
        counts,
        isAdmin,
      });
    }

    if (action === "history") {
      const [pafLog, nhLog] = await Promise.all([
        readSheet(SHEET_IDS.DB, SHEETS.PAF_LOG),
        readSheet(SHEET_IDS.DB, SHEETS.NEW_HIRE_LOG),
      ]);

      const history = [];

      pafLog.rows.forEach((row, i) => {
        if (String(row[1] || "").toLowerCase().trim() !== userEmail.toLowerCase()) return;
        const status = row[29] || "Pending";
        const notes = row[30] || "";
        let payload = "{}";
        if (row[28] && String(row[28]).startsWith("{")) payload = row[28];

        history.push({
          id: "paf-" + (i + 2),
          rowIndex: i + 2,
          module: "paf",
          date: row[4] ? new Date(row[4]).toISOString() : new Date().toISOString(),
          title: String(row[3] || "PAF Request"),
          subtitle: String(row[5] || "Action"),
          status: String(status),
          notes: String(notes),
          payload,
        });
      });

      nhLog.rows.forEach((row, i) => {
        if (String(row[1] || "").toLowerCase().trim() !== userEmail.toLowerCase()) return;
        const status = row[16] || "Pending";
        const notes = row[17] || "";
        const fullPayload = {
          firstName: row[2], lastName: row[3], operation: row[6], manager: row[7],
          jobTitle: row[8], payType: row[9], payRate: row[10], startDate: row[11],
          needsCard: row[12], needsEmail: row[13], needsLaptop: row[14], needsCell: row[15],
          isRehire: row[5],
        };

        history.push({
          id: "nh-" + (i + 2),
          rowIndex: i + 2,
          module: "newhire",
          date: row[0] ? new Date(row[0]).toISOString() : new Date().toISOString(),
          title: `${row[2]} ${row[3]}` || "New Hire",
          subtitle: "New Hire Onboarding",
          status: String(status),
          notes: String(notes),
          payload: JSON.stringify(fullPayload),
        });
      });

      history.sort((a, b) => new Date(b.date) - new Date(a.date));
      return NextResponse.json({ success: true, history });
    }

    if (action === "admin-queue") {
      const [pafLog, nhLog] = await Promise.all([
        readSheet(SHEET_IDS.DB, SHEETS.PAF_LOG),
        readSheet(SHEET_IDS.DB, SHEETS.NEW_HIRE_LOG),
      ]);

      const queue = [];

      pafLog.rows.forEach((row, i) => {
        const status = String(row[29] || "Pending").trim().toLowerCase();
        if (status !== "pending") return;
        queue.push({
          id: "paf-" + (i + 2),
          type: "paf",
          submitter: String(row[1]),
          location: String(row[2] || "Unknown"),
          title: String(row[3]),
          subtitle: String(row[5]),
          date: row[0] ? new Date(row[0]).toISOString() : new Date().toISOString(),
          details: row[28] && String(row[28]).startsWith("{") ? row[28] : "{}",
        });
      });

      nhLog.rows.forEach((row, i) => {
        const status = String(row[16] || "Pending").trim().toLowerCase();
        if (status !== "pending") return;
        const payload = {
          firstName: row[2], lastName: row[3], jobTitle: row[8],
          payRate: row[10], payType: row[9], manager: row[7], operation: row[6],
          startDate: row[11], needsCard: row[12], needsEmail: row[13],
          needsLaptop: row[14], needsCell: row[15], isRehire: row[5],
        };
        queue.push({
          id: "nh-" + (i + 2),
          type: "newhire",
          submitter: String(row[1]),
          title: `${row[2]} ${row[3]}`,
          subtitle: `New Hire (${row[8]})`,
          location: String(row[6] || "Unknown"),
          date: row[0] ? new Date(row[0]).toISOString() : new Date().toISOString(),
          details: JSON.stringify(payload),
        });
      });

      queue.sort((a, b) => new Date(a.date) - new Date(b.date));
      return NextResponse.json({ success: true, queue });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[People API] Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════
// POST: Submit new hire, PAF, admin action
// ═══════════════════════════════════════
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "submit-newhire") {
      const f = body.form;
      const row = [
        new Date().toISOString(), f.submitterEmail, f.firstName, f.lastName, f.personalEmail,
        f.isRehire, f.operation, f.manager, f.jobTitle, f.payType,
        f.payRate, f.startDate, f.needsCard, f.needsEmail, f.needsLaptop,
        f.needsCell, "Pending", "", JSON.stringify(f),
      ];
      const result = await appendRow(SHEET_IDS.DB, SHEETS.NEW_HIRE_LOG, row);
      return NextResponse.json(result);
    }

    if (action === "submit-paf") {
      const f = body.form;
      const row = [
        new Date().toISOString(), f.submitterEmail,
        f.locationName ? `${f.locationKey} - ${f.locationName}` : f.locationKey,
        f.employeeName, f.dateOfSubmission || new Date().toISOString(),
        f.actionType, f.actionGroup || "", f.actionSubtype || "",
        f.separationReason || "", f.rehireEligible || "",
        f.effectiveDate || "", f.oldRate || "", f.newRate || "",
        f.oldTitle || "", f.newTitle || "", f.statusChangeDirection || "",
        f.amount || "", f.travelStartDate || "", f.travelEndDate || "",
        f.travelTotalDays || "", f.travelSupplementTotal || "",
        f.perDiemTotal || "", f.travelGrandTotal || "",
        f.reclassFrom || "", f.reclassTo || "",
        f.cellFrequency || "", f.explanation || "",
        f.uploadUrl || "", JSON.stringify(f), "Pending", "",
      ];
      const result = await appendRow(SHEET_IDS.DB, SHEETS.PAF_LOG, row);
      return NextResponse.json(result);
    }

    if (action === "admin-process") {
      const { itemId, adminAction, reason, adminEmail } = body;
      const parts = itemId.split("-");
      const isNewHire = parts[0] === "nh";
      const rowIndex = parseInt(parts[1]);
      const sheetName = isNewHire ? SHEETS.NEW_HIRE_LOG : SHEETS.PAF_LOG;
      const statusCol = isNewHire ? 17 : 30;
      const notesCol = isNewHire ? 18 : 31;
      const newStatus = adminAction === "approve" ? "Complete" : "Rejected";

      await updateCell(SHEET_IDS.DB, sheetName, rowIndex, statusCol, newStatus);
      if (reason) {
        await updateCell(SHEET_IDS.DB, sheetName, rowIndex, notesCol, `[${newStatus} by ${adminEmail}] ${reason}`);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[People API POST] Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
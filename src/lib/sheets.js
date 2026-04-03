import { google } from "googleapis";

/**
 * KitchFix Data Switchboard
 * Three-Pillar Architecture:
 *   Pillar 1: Master Hub (Read-Only) — Source of Truth
 *   Pillar 2: Data Collection (Write-Heavy) — Transaction Logs
 *   Pillar 3: Game Engine (Logic) — Gamification
 *   Pillar 4: GL Codes (Read-Only) — Chart of Accounts
 *   Pillar 5: AI Collection (Write) — Invoice Line Items
 */

export const SHEET_IDS = {
  HUB: "1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E",
  COLLECTION: "1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ",
  GAME: "1BFEGUIjmU56iRsu0Dbnn-x-jF2Bnw8K4BmUZrq6pghs",
  GL_CODES: "1Gs7ToEvrsraBt81DctgwImKK-ck2Ch6V2ifvF8VndeY",
AI_LINE_ITEMS: "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo",
  INVENTORY: process.env.INVENTORY_SHEET_ID || "",
};

export function getSheetsClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
}

/**
 * Service Account client — writes on behalf of the app, not the user.
 * Used for operations where any authenticated user should be able to write.
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY env var (JSON string).
 */
export function getServiceAccountSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/**
 * Read a sheet using the service account (no user token needed).
 */
export async function readSheetSA(spreadsheetId, tabName) {
  const sheets = getServiceAccountSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: tabName,
    });
    const data = response.data.values || [];
    if (data.length === 0) return { headers: [], rows: [] };
    return { headers: data[0], rows: data.slice(1) };
  } catch (error) {
    console.error(`[SA] Error reading ${tabName}:`, error.message);
    return { headers: [], rows: [] };
  }
}

/**
 * Read all data from a sheet tab (100x Rule: one batch call)
 */
export async function readSheet(accessToken, spreadsheetId, tabName) {
  const sheets = getSheetsClient(accessToken);
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: tabName,
    });
    const data = response.data.values || [];
    if (data.length === 0) return { headers: [], rows: [] };
    return { headers: data[0], rows: data.slice(1) };
  } catch (error) {
    console.error(`Error reading ${tabName}:`, error.message);
    return { headers: [], rows: [] };
  }
}

/**
 * Append a row to a sheet tab (uses user's OAuth token)
 */
export async function appendRow(accessToken, spreadsheetId, tabName, rowData) {
  const sheets = getSheetsClient(accessToken);
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowData] },
    });
    return { success: true, updatedRange: response.data.updates?.updatedRange };
  } catch (error) {
    console.error(`Error writing to ${tabName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Append a row using the service account (no user token needed).
 * Any authenticated intranet user can trigger this — the service account
 * does the actual write. User identity is captured in the row data itself.
 */
export async function appendRowSA(spreadsheetId, tabName, rowData) {
  const sheets = getServiceAccountSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowData] },
    });
    return { success: true, updatedRange: response.data.updates?.updatedRange };
  } catch (error) {
    console.error(`[SA] Error writing to ${tabName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Append multiple rows at once using the service account.
 * Used by Service Calendar (audit logs, batch writes).
 */
export async function appendRowsSA(spreadsheetId, tabName, rowsData) {
  const sheets = getServiceAccountSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rowsData },
    });
    return { success: true, updatedRange: response.data.updates?.updatedRange };
  } catch (error) {
    console.error(`[SA] Error batch writing to ${tabName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update a specific range using the service account.
 * Used by Service Calendar to write actuals/clickers to Drive sheets.
 * `range` is A1 notation, e.g. "'Actuals - 2026'!F10:N10"
 * `values` is a 2D array, e.g. [[45, 50, 30, ...]]
 */
export async function updateRangeSA(spreadsheetId, range, values) {
  const sheets = getServiceAccountSheetsClient();
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return { success: true };
  } catch (error) {
    console.error(`[SA] Error updating range ${range}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Read a specific range using the service account.
 * Returns raw 2D array (no header parsing).
 * Used by Service Calendar to read specific months from large Drive sheets.
 */
export async function readRangeSA(spreadsheetId, range) {
  const sheets = getServiceAccountSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return { success: true, values: response.data.values || [] };
  } catch (error) {
    console.error(`[SA] Error reading range ${range}:`, error.message);
    return { success: false, values: [], error: error.message };
  }
}

/**
 * Append multiple rows at once (batch write — used by AI scanner)
 */
export async function appendRows(accessToken, spreadsheetId, tabName, rowsData) {

  const sheets = getSheetsClient(accessToken);
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rowsData },
    });
    return { success: true, updatedRange: response.data.updates?.updatedRange };
  } catch (error) {
    console.error(`Error batch writing to ${tabName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update a specific cell
 */
export async function updateCell(accessToken, spreadsheetId, range, value) {
  const sheets = getSheetsClient(accessToken);
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });
    return { success: true };
  } catch (error) {
    console.error(`Error updating ${range}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Find a row number by matching a value in a specific column
 * Used to update invoice scan status after async AI processing
 */
export async function findRowByValue(accessToken, spreadsheetId, tabName, columnIndex, searchValue) {
  const { rows } = await readSheet(accessToken, spreadsheetId, tabName);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][columnIndex] || "").trim() === String(searchValue).trim()) {
      return i + 2; // +2 for 1-indexed + header row
    }
  }
  return null;
}

/**
 * Convert raw sheet data to array of objects using headers as keys
 */
export function toObjects(headers, rows) {
  return rows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] !== undefined ? row[i] : "";
    });
    return obj;
  });
}
import { google } from "googleapis";

/**
 * KitchFix Data Switchboard
 * Three-Pillar Architecture:
 *   Pillar 1: Master Hub (Read-Only) — Source of Truth
 *   Pillar 2: Data Collection (Write-Heavy) — Transaction Logs
 *   Pillar 3: Game Engine (Logic) — Gamification
 */

export const SHEET_IDS = {
  HUB: "1rvIg9trPCxiEWvzrYbtp1j7V_sbtQnKaysv5BOwA90E",
  COLLECTION: "1itJh5x1YFBdyHTBr-dyKD_r_nRBfjwIBiR_bWiOyCzQ",
  GAME: "1BFEGUIjmU56iRsu0Dbnn-x-jF2Bnw8K4BmUZrq6pghs",
};

export function getSheetsClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
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
 * Append a row to a sheet tab
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
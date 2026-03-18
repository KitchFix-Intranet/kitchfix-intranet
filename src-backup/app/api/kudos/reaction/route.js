import { auth } from "@/lib/auth";
import { SHEET_IDS, getSheetsClient } from "@/lib/sheets";
import { NextResponse } from "next/server";

export async function POST(request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { rowId, type } = await request.json();
    if (!rowId || !type) {
      return NextResponse.json({ error: "Missing rowId or type" }, { status: 400 });
    }

    const sheets = getSheetsClient(session.accessToken);
    const range = `kudos_log!J${rowId}`;

    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_IDS.COLLECTION,
      range,
    });

    let reactions;
    try {
      reactions = JSON.parse(current.data.values?.[0]?.[0] || '{"hand":0,"rocket":0,"heart":0}');
    } catch {
      reactions = { hand: 0, rocket: 0, heart: 0 };
    }

    if (reactions.hasOwnProperty(type)) {
      reactions[type]++;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_IDS.COLLECTION,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[JSON.stringify(reactions)]] },
    });

    return NextResponse.json({ success: true, reactions });
  } catch (error) {
    console.error("Reaction error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
import { auth } from "@/lib/auth";
import { readSheet, SHEET_IDS } from "@/lib/sheets";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const kudosRaw = await readSheet(session.accessToken, SHEET_IDS.COLLECTION, "kudos_log");
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const pool = [];
    kudosRaw.rows.forEach((row, i) => {
      const timestamp = new Date(row[0]);
      if (timestamp >= thirtyDaysAgo && row[4] !== "") {
        const reactions = (() => {
          try { return JSON.parse(row[9] || '{"hand":0,"rocket":0,"heart":0}'); }
          catch { return { hand: 0, rocket: 0, heart: 0 }; }
        })();

        const seconds = Math.floor((now - timestamp) / 1000);
        let timeAgo = "Just now";
        if (seconds >= 86400) timeAgo = Math.floor(seconds / 86400) + "d ago";
        else if (seconds >= 3600) timeAgo = Math.floor(seconds / 3600) + "h ago";
        else if (seconds >= 60) timeAgo = Math.floor(seconds / 60) + "m ago";

        pool.push({
          id: i + 2, // +2 because row 1 is header, arrays are 0-indexed
          recipient: String(row[4] || ""),
          submitter: String(row[3] || ""),
          role: String(row[5] || ""),
          story: String(row[7] || ""),
          timestamp: row[0],
          reactions,
          timeAgo,
        });
      }
    });

    if (pool.length === 0) return NextResponse.json({ kudo: null });

    const randomIndex = Math.floor(Math.random() * pool.length);
    return NextResponse.json({ kudo: pool[randomIndex] });
  } catch (error) {
    console.error("Spotlight error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
import { auth } from "@/lib/auth";
import { readSheet, readSheetSA, appendRow, updateCell, SHEET_IDS } from "@/lib/sheets";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/analytics";

export async function GET(request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = session.accessToken;

  // ── Action routing ──
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  // ═══════════════════════════════════════
  // NEWS BOOTSTRAP (separate lightweight call)
  // ═══════════════════════════════════════
  if (action === "news-bootstrap") {
    try {
      const email = session.user?.email?.toLowerCase().trim();
      const today = new Date().toISOString().split("T")[0];

      // Read posts from HUB
      const postsRaw = await readSheetSA(SHEET_IDS.HUB, "news_posts");
      const posts = postsRaw.rows
        .filter(r => String(r[11] || "") === "TRUE" && (!r[7] || r[7] >= today))
        .map(r => ({
          postId:         String(r[0] || ""),
          title:          String(r[1] || ""),
          body:           String(r[2] || ""),
          tag:            String(r[3] || "general"),
          pinned:         String(r[4] || ""),
          author:         String(r[5] || ""),
          publishDate:    String(r[6] || ""),
          expiresDate:    String(r[7] || ""),
          countdownLabel: String(r[8] || ""),
          countdownDate:  String(r[9] || ""),
          link:           String(r[10] || ""),
          active:         String(r[11] || ""),
        }))
        .sort((a, b) => (b.publishDate || "").localeCompare(a.publishDate || ""));

      // Read interactions from COLLECTION (all users for this is fine — small table)
      const ixRaw = await readSheetSA(SHEET_IDS.COLLECTION, "news_interactions");

      // Filter to current user
      const interactions = ixRaw.rows
        .filter(r => String(r[1] || "").toLowerCase().trim() === email)
        .map(r => ({
          postId:       String(r[0] || ""),
          read:         String(r[2] || "") === "TRUE",
          readAt:       String(r[3] || ""),
          saved:        String(r[4] || "") === "TRUE",
          acknowledged: String(r[5] || "") === "TRUE",
        }));

      return NextResponse.json({ posts, interactions });
    } catch (error) {
      console.error("[Dashboard] News bootstrap error:", error.message);
      return NextResponse.json({ posts: [], interactions: [] });
    }
  }

  // ═══════════════════════════════════════
  // MAIN DASHBOARD BOOTSTRAP
  // ═══════════════════════════════════════
  try {
    const email = session.user?.email?.toLowerCase().trim();
    console.log("[Dashboard] Loading for:", email);

    logEvent(token, { email, category: "home", action: "page_view", page: "/" });

    // ═══════════════════════════════════════
    // BATCH FETCH (100x Rule: all at once)
    // Each read is wrapped to prevent one failure from killing everything
    // ═══════════════════════════════════════
    const safeRead = async (id, tab) => {
      try {
        return await readSheetSA(id, tab);
      } catch (e) {
        console.warn(`[Dashboard] Sheet "${tab}" not found or error:`, e.message);
        return { headers: [], rows: [] };
      }
    };

    // Internal fetch for People Portal metrics (uses service account, separate sheet)
    const safePeopleFetch = async () => {
      try {
        const subs = await readSheetSA(SHEET_IDS.COLLECTION, "submissions");
        const metrics = { pending: 0, rejected: 0, completedTotal: 0 };
        for (const row of subs.rows) {
          if (row.length < 9) continue;
          const submitter = String(row[1] || "").toLowerCase().trim();
          if (submitter !== email) continue;
          const status = String(row[8] || "").trim();
          if (status === "Pending") metrics.pending++;
          else if (status === "Rejected") metrics.rejected++;
          else if (status === "Complete" || status === "Approved") metrics.completedTotal++;
        }
        return metrics;
      } catch (e) {
        console.warn("[Dashboard] Submissions read failed:", e.message);
        return { pending: 0, rejected: 0, completedTotal: 0 };
      }
    };

    // Batch fetch — 5 HUB reads + 1 personnel_celebrations + 1 people metrics
    // Previously also read kudos_log, wastenot_log, login_logs but the data was
    // computed and never rendered. Removed 2026-05-14 to reduce Sheets quota burn.
    const [contactsRaw, accountsRaw, heroRaw, philosophyRaw, periodRaw] =
      await Promise.all([
        safeRead(SHEET_IDS.HUB, "contacts"),
        safeRead(SHEET_IDS.HUB, "accounts"),
        safeRead(SHEET_IDS.HUB, "hero_images"),
        safeRead(SHEET_IDS.HUB, "kitchFix_philosophy"),
        safeRead(SHEET_IDS.HUB, "period_data"),
      ]);

    const [celebrationsRaw, peopleMetrics] = await Promise.all([
      safeRead(SHEET_IDS.HUB, "personnel_celebrations"),
      safePeopleFetch(),
    ]);

    console.log("[Dashboard] Sheets loaded:", {
      contacts: contactsRaw.rows.length,
      accounts: accountsRaw.rows.length,
      hero: heroRaw.rows.length,
      philosophy: philosophyRaw.rows.length,
      periods: periodRaw.rows.length,
      celebrations: celebrationsRaw.rows.length,
      people: peopleMetrics,
    });

    // ═══════════════════════════════════════
    // USER PROFILE
    // Apps Script: row[0]=teamKey, row[1]=role, row[2]=name, row[3]=email
    // ═══════════════════════════════════════
    let teamKey = "";
    let userRole = "Team Member";
    let userName = session.user?.name || "Chef";
    let userInitials = "KF";

    for (const row of contactsRaw.rows) {
      if (row[3] && String(row[3]).toLowerCase().trim() === email) {
        teamKey = String(row[0] || "");
        userRole = String(row[1] || "Team Member");
        userName = String(row[2] || userName);
        break;
      }
    }

    const nameParts = userName.split(" ");
    if (nameParts.length > 1) {
      userInitials = (nameParts[0][0] + nameParts[1][0]).toUpperCase();
    } else {
      userInitials = userName.substring(0, 2).toUpperCase();
    }

    // Team logo from accounts sheet
    let stadiumImg = "";
    if (teamKey && accountsRaw.headers.length > 0) {
      const logoIdx = accountsRaw.headers.indexOf("Logo URL");
      if (logoIdx !== -1) {
        for (const row of accountsRaw.rows) {
          if (String(row[0] || "").trim() === teamKey.trim()) {
            stadiumImg = String(row[logoIdx] || "");
            break;
          }
        }
      }
    }

    const user = {
      name: userName,
      firstName: nameParts[0] || "Chef",
      initials: userInitials,
      email,
      image: session.user?.image || null,
      role: userRole,
      teamKey,
      stadiumImg,
      // People metrics from People Portal API (unified submissions sheet)
      peopleMetrics,
    };

    console.log("[Dashboard] User:", user.name, "| Team:", teamKey, "| People:", peopleMetrics);

    // ═══════════════════════════════════════
    // HERO IMAGE (typed: col[0]=imgurl, col[1]=type)
    // Types: kitchen, team, ops, celebration, seasonal
    // If celebrations today → prefer "celebration" type
    // ═══════════════════════════════════════
    const heroEntries = heroRaw.rows
      .filter((r) => r[0])
      .map((r) => ({ url: String(r[0]), type: String(r[1] || "kitchen").toLowerCase().trim() }));

    let heroImage = null;
    const hasCelebrations = celebrationsRaw.rows.some((row) => {
      if (!row[0]) return false;
      const d = new Date(row[0]);
      return !isNaN(d.getTime()) && d.getMonth() === new Date().getMonth() && d.getDate() === new Date().getDate();
    });

    if (heroEntries.length > 0) {
      if (hasCelebrations) {
        const celebImages = heroEntries.filter((e) => e.type === "celebration");
        if (celebImages.length > 0) {
          heroImage = celebImages[Math.floor(Math.random() * celebImages.length)].url;
        }
      }
      if (!heroImage) {
        heroImage = heroEntries[Math.floor(Math.random() * heroEntries.length)].url;
      }
    }

    // ═══════════════════════════════════════
    // PHILOSOPHY / MOTIVATION
    // ═══════════════════════════════════════
    const standards = philosophyRaw.rows.map((r) => r[0]).filter(Boolean);
    const todayStandard = standards.length > 0
      ? standards[Math.floor(Math.random() * standards.length)]
      : "Consistency is the secret sauce.";

    // ═══════════════════════════════════════
    // OPS METRICS
    // row[0]=label, row[1]=start, row[2]=end, row[3]=dueDate
    // ═══════════════════════════════════════
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let opsMetrics = { label: "Off Season", week: 0, progress: 0, daysUntilInv: 99, found: false };

    for (const row of periodRaw.rows) {
      const start = new Date(row[1]);
      const end = new Date(row[2]);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      if (today >= start && today <= end) {
        opsMetrics.found = true;
        opsMetrics.label = String(row[0] || "Active Period");

        const daysPassed = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        opsMetrics.week = Math.floor(daysPassed / 7) + 1;

        const totalDuration = end - start;
        opsMetrics.progress = Math.min(100, Math.max(0, ((today - start) / totalDuration) * 100));

        const due = new Date(row[3]);
        if (!isNaN(due.getTime())) {
          due.setHours(0, 0, 0, 0);
          opsMetrics.daysUntilInv = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        }
        break;
      }
    }

    console.log("[Dashboard] Ops:", opsMetrics);

    // ═══════════════════════════════════════
    // CELEBRATIONS (Birthday/Anniversary)
    // ═══════════════════════════════════════
    const todayMonth = new Date().getMonth();
    const todayDay = new Date().getDate();

    const celebrations = celebrationsRaw.rows
      .filter((row) => {
        if (!row[0]) return false;
        const d = new Date(row[0]);
        return !isNaN(d.getTime()) && d.getMonth() === todayMonth && d.getDate() === todayDay;
      })
      .map((row) => {
        const rawName = String(row[1] || "");
        const type = String(row[2] || "Celebration");
        let cleanName = rawName.replace(/'s\s+Birthday.*/i, "").replace(/'s\s+Anniversary.*/i, "").replace(/Birthday.*/i, "").replace(/Anniversary.*/i, "").trim();
        if (!cleanName) cleanName = rawName.split(" ")[0] || "Team Member";
        const yearMatch = rawName.match(/(\d+)\s*Year/i);
        let subLabel = type === "Birthday" ? "Birthday" : "Work Anniversary";
        if (yearMatch) subLabel = yearMatch[1] + " Year Anniversary";
        return { headline: rawName, subLabel, type, firstName: cleanName };
      });

    // ═══════════════════════════════════════
    // RETURN COMPLETE DASHBOARD PAYLOAD
    // News is now handled by NewsFeed component via news-bootstrap
    // ═══════════════════════════════════════
    const payload = {
      success: true,
      user,
      heroImage,
      news: [],
      standard: todayStandard,
      ops: opsMetrics,
      celebrations,
    };

    console.log("[Dashboard] ✅ Success");
    return NextResponse.json(payload);

  } catch (error) {
    console.error("[Dashboard] ❌ CRASH:", error.message, error.stack);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}


// ═══════════════════════════════════════════════════════════
// POST HANDLER — News interactions
// ═══════════════════════════════════════════════════════════
export async function POST(request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = session.accessToken;
  if (!token) {
    return NextResponse.json({ error: "No access token" }, { status: 400 });
  }

  const email = session.user?.email?.toLowerCase().trim();

  try {
    const body = await request.json();
    const { action } = body;

    if (!["news-read", "news-save", "news-ack", "news-mark-all-read"].includes(action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const { postId, saved, acknowledged, postIds } = body;

    // ── Mark all read (batch) ──
    if (action === "news-mark-all-read" && postIds?.length) {
      const ixRaw = await readSheet(token, SHEET_IDS.COLLECTION, "news_interactions");
      const now = new Date().toISOString();
      const writes = [];

      for (const pid of postIds) {
        const rowIdx = ixRaw.rows.findIndex(r => String(r[0] || "") === pid && String(r[1] || "").toLowerCase().trim() === email);
        if (rowIdx >= 0) {
          const sheetRow = rowIdx + 2;
          writes.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `C${sheetRow}`, "TRUE"));
          writes.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `D${sheetRow}`, now));
        } else {
          writes.push(appendRow(token, SHEET_IDS.COLLECTION, "news_interactions", [
            pid, email, "TRUE", now, "FALSE", "FALSE"
          ]));
        }
      }
      await Promise.all(writes);
      return NextResponse.json({ ok: true });
    }

    // ── Single post interactions ──
    const ixRaw = await readSheet(token, SHEET_IDS.COLLECTION, "news_interactions");
    const rowIdx = ixRaw.rows.findIndex(r => String(r[0] || "") === postId && String(r[1] || "").toLowerCase().trim() === email);
    const now = new Date().toISOString();

    if (rowIdx >= 0) {
      const sheetRow = rowIdx + 2;
      const updates = [];

      if (action === "news-read") {
        updates.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `C${sheetRow}`, "TRUE"));
        updates.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `D${sheetRow}`, now));
      }
      if (action === "news-save") {
        updates.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `E${sheetRow}`, saved ? "TRUE" : "FALSE"));
      }
      if (action === "news-ack") {
        updates.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `C${sheetRow}`, "TRUE"));
        updates.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `D${sheetRow}`, now));
        updates.push(updateCell(token, SHEET_IDS.COLLECTION, "news_interactions", `F${sheetRow}`, acknowledged ? "TRUE" : "FALSE"));
      }

      if (updates.length) await Promise.all(updates);
    } else {
      const newRow = [
        postId,
        email,
        action === "news-read" || action === "news-ack" ? "TRUE" : "FALSE",
        action === "news-read" || action === "news-ack" ? now : "",
        action === "news-save" ? (saved ? "TRUE" : "FALSE") : "FALSE",
        action === "news-ack" ? (acknowledged ? "TRUE" : "FALSE") : "FALSE",
      ];
      await appendRow(token, SHEET_IDS.COLLECTION, "news_interactions", newRow);
    }

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("[Dashboard] POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
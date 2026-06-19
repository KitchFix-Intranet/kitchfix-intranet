import { auth } from "@/lib/auth";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { getNewsInteractions, upsertNewsInteraction, getSubmissions } from "@/lib/dataStore";
import { createNewsPost, updateNewsPost, deleteNewsPost, readAllNewsPosts, enforceSinglePin } from "@/lib/dataStore/newsPosts";
import { uploadNewsImage } from "@/lib/drive";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

// Reaction set is fixed (PG cols liked/fired/thumbs_up/hearted). The
// dataStore upsert maps camelCase -> snake_case internally.
const VALID_REACTIONS = ["liked", "fired", "thumbsUp", "hearted"];

export async function GET(request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

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
          imageUrl:       String(r[12] || ""),
        }))
        .sort((a, b) => (b.publishDate || "").localeCompare(a.publishDate || ""));

      // Read interactions for the current user via dataStore.
      // Now includes the 4 reaction booleans (liked, fired, thumbsUp, hearted)
      // when reading from PG; the Sheets path returns them as undefined which
      // the client treats as false.
      const allInteractions = await getNewsInteractions({ userEmail: email });
      const interactions = allInteractions.map(
        ({ postId, read, readAt, saved, acknowledged, liked, fired, thumbsUp, hearted }) => ({
          postId, read, readAt, saved, acknowledged,
          liked: !!liked, fired: !!fired, thumbsUp: !!thumbsUp, hearted: !!hearted,
        })
      );

      // Reaction aggregates: counts + reactor name lists per post.
      // PG-only - if any branch fails we surface empty maps rather than 500.
      let reactionCounts = {};
      let reactorNames = {};
      try {
        const supabase = getServiceClient();
        // Pull every row where ANY reaction is true. Small dataset (~tens of
        // reactions across the active news feed); no pagination needed.
        const { data: rxRows, error: rxErr } = await supabase
          .from("news_interactions")
          .select("post_id, user_email, liked, fired, thumbs_up, hearted")
          .or("liked.eq.true,fired.eq.true,thumbs_up.eq.true,hearted.eq.true");
        if (rxErr) throw rxErr;

        // Build email -> display name from HUB contacts (col D email, col C name).
        // Falls back to "K. Fietek" style derivation when no contact match.
        const contactsRaw = await readSheetSA(SHEET_IDS.HUB, "contacts").catch(() => ({ rows: [] }));
        const nameByEmail = {};
        for (const row of contactsRaw.rows || []) {
          const e = String(row[3] || "").toLowerCase().trim();
          const n = String(row[2] || "").trim();
          if (e && n) nameByEmail[e] = n;
        }
        function emailToName(e) {
          if (!e) return "";
          const looked = nameByEmail[e.toLowerCase()];
          if (looked) return looked;
          const local = String(e).split("@")[0] || "";
          return local
            .split(/[._]/)
            .filter(Boolean)
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join(" ");
        }

        for (const r of rxRows || []) {
          const pid = r.post_id;
          if (!reactionCounts[pid]) {
            reactionCounts[pid] = { liked: 0, fired: 0, thumbsUp: 0, hearted: 0 };
            reactorNames[pid] = { liked: [], fired: [], thumbsUp: [], hearted: [] };
          }
          const displayName = emailToName(r.user_email);
          if (r.liked)      { reactionCounts[pid].liked++;      reactorNames[pid].liked.push(displayName); }
          if (r.fired)      { reactionCounts[pid].fired++;      reactorNames[pid].fired.push(displayName); }
          if (r.thumbs_up)  { reactionCounts[pid].thumbsUp++;   reactorNames[pid].thumbsUp.push(displayName); }
          if (r.hearted)    { reactionCounts[pid].hearted++;    reactorNames[pid].hearted.push(displayName); }
        }
      } catch (err) {
        console.warn("[Dashboard] reaction aggregation failed:", err?.message);
      }

      return NextResponse.json({ posts, interactions, reactionCounts, reactorNames });
    } catch (error) {
      console.error("[Dashboard] News bootstrap error:", error.message);
      return NextResponse.json({ posts: [], interactions: [], reactionCounts: {}, reactorNames: {} });
    }
  }

  // ═══════════════════════════════════════
  // NEWS ADMIN LIST (all posts, including inactive + expired)
  // ═══════════════════════════════════════
  if (action === "news-admin-list") {
    const email = session.user?.email?.toLowerCase().trim();
    if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
    }
    try {
      const posts = await readAllNewsPosts();
      return NextResponse.json({ success: true, posts });
    } catch (error) {
      console.error("[Dashboard] News admin list error:", error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  // ═══════════════════════════════════════
  // MAIN DASHBOARD BOOTSTRAP
  // ═══════════════════════════════════════
  try {
    const email = session.user?.email?.toLowerCase().trim();
    console.log("[Dashboard] Loading for:", email);

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

    // Internal fetch for People Portal metrics. Routed through the
    // dataStore so the dashboard's submissions read can flip to
    // Postgres independently of the people module via the
    // READ_FROM_POSTGRES_DASHBOARD env flag. With flags off, the
    // dataStore's Sheets adapter does the same readSheetSA call that
    // this code used to do directly, returning the canonical shape
    // instead of positional rows.
    const safePeopleFetch = async () => {
      try {
        const subs = await getSubmissions({ module: "dashboard" });
        const metrics = { pending: 0, rejected: 0, completedTotal: 0 };
        for (const sub of subs) {
          if (sub.submitter.toLowerCase().trim() !== email) continue;
          const status = sub.status;
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

  const email = session.user?.email?.toLowerCase().trim();

  try {
    const body = await request.json();
    const { action } = body;

    if (!["news-read", "news-save", "news-ack", "news-mark-all-read", "news-create", "news-update", "news-delete", "news-react"].includes(action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // ── Admin write actions ──
    if (action === "news-create" || action === "news-update" || action === "news-delete") {
      if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
      }

      if (action === "news-create") {
        let imageUrl = "";
        if (body.imageData && body.imageFileName && body.imageMimeType) {
          try {
            const upload = await uploadNewsImage(body.imageData, body.imageFileName, body.imageMimeType);
            imageUrl = upload.fileUrl;
          } catch (err) {
            console.error("[News] Image upload failed:", err.message);
            // continue without image rather than blocking the post
          }
        }
        const post = { ...(body.post || {}), imageUrl };
        if (post.pinned) await enforceSinglePin(null);
        const postId = await createNewsPost(post);
        return NextResponse.json({ success: true, postId });
      }

      if (action === "news-update") {
        const patch = { ...(body.patch || {}) };
        if (body.imageData && body.imageFileName && body.imageMimeType) {
          try {
            const upload = await uploadNewsImage(body.imageData, body.imageFileName, body.imageMimeType);
            patch.imageUrl = upload.fileUrl;
          } catch (err) {
            console.error("[News] Image upload failed:", err.message);
          }
        }
        if (body.removeImage) {
          patch.imageUrl = "";
        }
        if (patch.pinned) await enforceSinglePin(body.postId);
        await updateNewsPost(body.postId, patch);
        return NextResponse.json({ success: true });
      }

      if (action === "news-delete") {
        await deleteNewsPost(body.postId);
        return NextResponse.json({ success: true });
      }
    }

    const { postId, saved, acknowledged, postIds } = body;

    // ── Mark all read (batch) ──
    // Per-post upsert with the same field-set news-read uses ({ read, readAt }).
    // dataStore handles existing-row vs new-row internally + dispatches to Sheets
    // (and optionally Postgres when DUAL_WRITE_TABLES includes news_interactions).
    if (action === "news-mark-all-read" && postIds?.length) {
      const now = new Date().toISOString();
      await Promise.all(
        postIds.map((pid) =>
          upsertNewsInteraction({ postId: pid, userEmail: email }, { read: true, readAt: now })
        )
      );
      return NextResponse.json({ ok: true });
    }

    // ── Single post interactions ──
    // Per-action partial upsert. Field-sets preserved exactly:
    //   news-read  -> { read, readAt }
    //   news-save  -> { saved }           (NOT touching read/readAt/ack)
    //   news-ack   -> { read, readAt, acknowledged }
    const now = new Date().toISOString();
    const key = { postId, userEmail: email };

    if (action === "news-read") {
      await upsertNewsInteraction(key, { read: true, readAt: now });
    } else if (action === "news-save") {
      await upsertNewsInteraction(key, { saved });
    } else if (action === "news-ack") {
      await upsertNewsInteraction(key, { read: true, readAt: now, acknowledged });
    } else if (action === "news-react") {
      // Single reaction toggle. Reacting also marks the post as read.
      // VALID_REACTIONS guards against arbitrary column injection.
      if (!VALID_REACTIONS.includes(body.reaction)) {
        return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
      }
      await upsertNewsInteraction(key, {
        [body.reaction]: !!body.value,
        read: true,
        readAt: now,
      });
    }

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("[Dashboard] POST error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
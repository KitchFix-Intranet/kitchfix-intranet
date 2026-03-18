import { auth } from "@/lib/auth";
import { readSheet, appendRow, SHEET_IDS } from "@/lib/sheets";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = session.accessToken;
  if (!token) {
    return NextResponse.json({ error: "No access token" }, { status: 400 });
  }

  try {
    const email = session.user?.email?.toLowerCase().trim();
    console.log("[Dashboard] Loading for:", email);

    // ═══════════════════════════════════════
    // BATCH FETCH (100x Rule: all at once)
    // Each read is wrapped to prevent one failure from killing everything
    // ═══════════════════════════════════════
    const safeRead = async (id, tab) => {
      try {
        return await readSheet(token, id, tab);
      } catch (e) {
        console.warn(`[Dashboard] Sheet "${tab}" not found or error:`, e.message);
        return { headers: [], rows: [] };
      }
    };

    const [contactsRaw, accountsRaw, heroRaw, newsRaw, philosophyRaw, periodRaw] =
      await Promise.all([
        safeRead(SHEET_IDS.HUB, "contacts"),
        safeRead(SHEET_IDS.HUB, "accounts"),
        safeRead(SHEET_IDS.HUB, "hero_images"),
        safeRead(SHEET_IDS.HUB, "home_news"),
        safeRead(SHEET_IDS.HUB, "kitchFix_philosophy"),
        safeRead(SHEET_IDS.HUB, "period_data"),
      ]);

    const [kudosRaw, wasteRaw, pafRaw, newhireRaw, logsRaw, celebrationsRaw] = await Promise.all([
      safeRead(SHEET_IDS.COLLECTION, "kudos_log"),
      safeRead(SHEET_IDS.COLLECTION, "wastenot_log"),
      safeRead(SHEET_IDS.COLLECTION, "paf_log"),
      safeRead(SHEET_IDS.COLLECTION, "newhire_log"),
      safeRead(SHEET_IDS.COLLECTION, "login_logs"),
      safeRead(SHEET_IDS.HUB, "personnel_celebrations"),
    ]);

    console.log("[Dashboard] Sheets loaded:", {
      contacts: contactsRaw.rows.length,
      accounts: accountsRaw.rows.length,
      hero: heroRaw.rows.length,
      news: newsRaw.rows.length,
      philosophy: philosophyRaw.rows.length,
      periods: periodRaw.rows.length,
      kudos: kudosRaw.rows.length,
      waste: wasteRaw.rows.length,
      paf: pafRaw.rows.length,
      newhire: newhireRaw.rows.length,
      logs: logsRaw.rows.length,
      celebrations: celebrationsRaw.rows.length,
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

    // Login streak
    const loginStreak = calculateLoginStreak(logsRaw.rows, email);

    // Log this visit (fire and forget)
    appendRow(token, SHEET_IDS.COLLECTION, "login_logs", [
      new Date().toISOString(),
      new Date().toLocaleDateString(),
      email,
    ]).catch((e) => console.warn("Login log failed:", e.message));

    const user = {
      name: userName,
      firstName: nameParts[0] || "Chef",
      initials: userInitials,
      email,
      image: session.user?.image || null,
      role: userRole,
      teamKey,
      stadiumImg,
      streak: loginStreak,
    };

    // ═══════════════════════════════════════
    // PEOPLE METRICS (PAF + New Hire)
    // PAF: col1=email, col29=status | NewHire: col1=email, col16=status
    // ═══════════════════════════════════════
    let peopleMetrics = { pending: 0, rejected: 0, completedTotal: 0 };

    const scanPeople = (rows, emailCol, statusCol) => {
      for (const row of rows) {
        if (row.length <= statusCol) continue;
        if (String(row[emailCol] || "").toLowerCase().trim() === email) {
          const status = String(row[statusCol] || "").trim();
          if (status === "Pending") peopleMetrics.pending++;
          else if (status === "Rejected") peopleMetrics.rejected++;
          else if (status === "Approved" || status === "Complete") peopleMetrics.completedTotal++;
        }
      }
    };

    scanPeople(pafRaw.rows, 1, 29);
    scanPeople(newhireRaw.rows, 1, 16);
    user.peopleMetrics = peopleMetrics;

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
    // NEWS FEED (LIFO + Pinning, last 10)
    // row[0]=date, row[1]=headline, row[2]=category,
    // row[3]=body, row[4]=link, row[5]=pinned, row[6]=imageId
    // ═══════════════════════════════════════
    const allNews = newsRaw.rows
      .map((row) => ({
        date: row[0] || "",
        headline: String(row[1] || ""),
        category: String(row[2] || "News"),
        body: String(row[3] || ""),
        link: String(row[4] || ""),
        pinned: String(row[5]).toUpperCase() === "TRUE",
        imageId: String(row[6] || ""),
      }))
      .filter((n) => n.headline);

    const news = allNews.slice(-10).reverse();

    const pinnedIdx = news.findIndex((n) => n.pinned);
    if (pinnedIdx > 0) {
      const pinned = news.splice(pinnedIdx, 1)[0];
      news.unshift(pinned);
    }

    news.forEach((n) => {
      if (n.date) {
        try {
          const d = new Date(n.date);
          if (!isNaN(d.getTime())) {
            n.date = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
          }
        } catch (e) { /* keep raw */ }
      }
    });

    console.log("[Dashboard] News items:", news.length);

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
    // KUDOS METRICS
    // row[0]=timestamp, row[4]=recipient, row[10]=submitterEmail, row[11]=status
    // ═══════════════════════════════════════
    let kudosMetrics = { companyTotal: 0, personalSent: 0, recent: [] };
    const recentRecipients = [];

    for (const row of kudosRaw.rows) {
      if (row.length < 12) continue;
      const status = String(row[11] || "").toUpperCase().trim();
      const submitter = String(row[10] || "").toLowerCase().trim();
      const recipient = String(row[4] || "");

      if (status === "ACTIVE") {
        kudosMetrics.companyTotal++;
        if (submitter === email) kudosMetrics.personalSent++;
        if (recipient) recentRecipients.push(recipient);
      }
    }

    const uniqueRecent = [...new Set(recentRecipients.reverse())].slice(0, 3);
    kudosMetrics.recent = uniqueRecent.map((name) => {
      const parts = name.split(" ");
      if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.substring(0, 2).toUpperCase();
    });

    console.log("[Dashboard] Kudos:", kudosMetrics);

    // ═══════════════════════════════════════
    // WASTE METRICS
    // row[1]=date, row[2]=team, row[3]=lbs
    // ═══════════════════════════════════════
    let wasteMetrics = { streak: 0, lbs: 0, status: "red", diff: 99 };

    if (teamKey) {
      const teamWaste = wasteRaw.rows
        .filter((r) => r[2] && String(r[2]).startsWith(teamKey))
        .sort((a, b) => new Date(b[1]) - new Date(a[1]));

      if (teamWaste.length > 0) {
        const lastRow = teamWaste[0];
        const lastDate = new Date(lastRow[1]);
        wasteMetrics.lbs = lastRow[3] || 0;

        const checkDate = new Date(lastDate);
        checkDate.setHours(0, 0, 0, 0);
        const todayClean = new Date();
        todayClean.setHours(0, 0, 0, 0);
        wasteMetrics.diff = Math.floor((todayClean - checkDate) / (1000 * 60 * 60 * 24));

        if (wasteMetrics.diff <= 1) wasteMetrics.status = "green";
        else if (wasteMetrics.diff <= 3) wasteMetrics.status = "orange";
        else wasteMetrics.status = "red";

        // Streak
        const dateSet = new Set();
        teamWaste.forEach((r) => {
          const d = new Date(r[1]);
          if (!isNaN(d.getTime())) dateSet.add(d.toISOString().split("T")[0]);
        });
        const dates = Array.from(dateSet).sort().reverse();
        let streak = 0;
        let cursor = new Date();
        let cursorStr = cursor.toISOString().split("T")[0];

        if (dates[0] !== cursorStr) {
          cursor.setDate(cursor.getDate() - 1);
          cursorStr = cursor.toISOString().split("T")[0];
          if (dates[0] !== cursorStr) {
            wasteMetrics.streak = 0;
          } else {
            for (const dStr of dates) {
              if (dStr === cursorStr) { streak++; cursor.setDate(cursor.getDate() - 1); cursorStr = cursor.toISOString().split("T")[0]; } else break;
            }
            wasteMetrics.streak = streak;
          }
        } else {
          for (const dStr of dates) {
            if (dStr === cursorStr) { streak++; cursor.setDate(cursor.getDate() - 1); cursorStr = cursor.toISOString().split("T")[0]; } else break;
          }
          wasteMetrics.streak = streak;
        }
      }
    }

    console.log("[Dashboard] Waste:", wasteMetrics);

    // ═══════════════════════════════════════
    // MANAGER OF THE DAY (MOD)
    // ═══════════════════════════════════════
    const validContacts = contactsRaw.rows.filter((row) => {
      const name = String(row[2] || "").trim();
      return name && name !== "" && name.toUpperCase() !== "TBD";
    });

    let mod = { name: "Team Directory", role: "Manager of the Day", email: "", image: "", found: false };

    if (validContacts.length > 0) {
      const seed = Math.floor(today.getTime() / (1000 * 60 * 60 * 24));
      const index = seed % validContacts.length;
      const selected = validContacts[index];

      mod.found = true;
      mod.name = String(selected[2] || "Team Member");
      mod.role = String(selected[1] || "Chef de Cuisine");
      mod.email = String(selected[3] || "");
      const modTeamKey = String(selected[0] || "");

      if (modTeamKey && accountsRaw.headers.length > 0) {
        const logoIdx = accountsRaw.headers.indexOf("Logo URL");
        if (logoIdx !== -1) {
          for (const aRow of accountsRaw.rows) {
            if (String(aRow[0] || "").trim() === modTeamKey.trim()) {
              mod.image = String(aRow[logoIdx] || "");
              break;
            }
          }
        }
      }
    }

    console.log("[Dashboard] MOD:", mod.name);

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
    // ═══════════════════════════════════════
    const payload = {
      success: true,
      user,
      heroImage,
      news,
      standard: todayStandard,
      ops: opsMetrics,
      kudos: kudosMetrics,
      wasteMetrics,
      mod,
      celebrations,
    };

    console.log("[Dashboard] ✅ Success! News:", news.length, "| Kudos:", kudosMetrics.companyTotal);
    return NextResponse.json(payload);

  } catch (error) {
    console.error("[Dashboard] ❌ CRASH:", error.message, error.stack);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

function calculateLoginStreak(rows, email) {
  const userDates = new Set();
  const search = email.toLowerCase().trim();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][2] || "").toLowerCase().trim() === search) {
      const d = new Date(rows[i][1]);
      if (!isNaN(d.getTime())) userDates.add(d.toISOString().split("T")[0]);
    }
  }
  const dates = Array.from(userDates).sort().reverse();
  if (dates.length === 0) return 0;
  let streak = 0;
  let checkDate = new Date();
  const todayStr = checkDate.toISOString().split("T")[0];
  if (dates[0] !== todayStr) {
    checkDate.setDate(checkDate.getDate() - 1);
    if (dates[0] !== checkDate.toISOString().split("T")[0]) return 0;
  }
  for (const dateStr of dates) {
    if (dateStr === checkDate.toISOString().split("T")[0]) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else break;
  }
  return streak;
}
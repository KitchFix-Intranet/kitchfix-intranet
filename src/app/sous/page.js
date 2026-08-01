// ════════════════════════════════════════════════════════════════════════════
// /sous - Redesign PR A - page (server component)
// ════════════════════════════════════════════════════════════════════════════
//
// Gate order (mirrors /api/sousai handler):
//   1. FLAG   SOUSAI_ROUTE_ENABLED === "true"  -> else notFound
//   2. AUTH   await auth() returns a session   -> else notFound
//   3. TIER   viewerTier === 'slt' OR isCorporateEmail -> else notFound
//
// Server-side bootstrap:
//   - Hero image via getHeroImages() from the shared team_key NULL pool
//     (same shape /api/dashboard uses).
//   - Domain counts for the four first-run cards - Playbook (Live docs),
//     People (leadership directory contacts). SC + Spend fall back to
//     hardcoded caps if their count reads fail (they're informational).
//   - firstName extracted from the session for the hero greeting.
//
// New surface pieces landed by this page:
//   - Photographic hero (SousHero, inline component)
//   - Two-column shell with 264px session rail (client-held, in SousSurface)
//   - First-run block with 4 domain cards + limits (in SousSurface)
//   - Load-sequence animations via .sa-animate class (in sous.css)
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { auth } from "@/lib/auth";
import { canUseSous } from "@/lib/opdAcl";
import { fetchReportRows } from "@/app/sousai/reports/data";
import { repeatQuestions, declineGaps, isoDay, daysAgo, serverToday } from "@/app/sousai/reports/aggregate";
import { getHeroImages, getContacts } from "@/lib/dataStore/directory";
import { getSupabase } from "@/lib/sousai/tools/_client";
import SousSurface from "./SousSurface";
import "./sous.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sous - KitchFix" };

// The four first-run domain cards. Live counts fetched below; hardcoded
// example questions per D15 (log can drive them later).
const DOMAIN_CARD_EXAMPLES = {
  playbook: [
    "What's our allergen procedure?",
    "Show me FORM-004",
  ],
  people: [
    "Who's the EC at CIN-OH?",
    "Which accounts don't have a Sous Chef?",
  ],
  sc: [
    "How's CIN-AZ tracking this month?",
    "What homestand is STL-MO on?",
  ],
  spend: [
    "How much have we spent with Sysco this year?",
    "Which vendors did we spend the most with this year?",
  ],
};

async function loadChipsInline(now) {
  try {
    const { rows, error } = await fetchReportRows(now);
    if (error) return [];
    const today = serverToday(now);
    const cutoffISO = isoDay(daysAgo(today, 7));
    const windowRows = (rows || []).filter((r) => isoDay(new Date(r.created_at)) >= cutoffISO);
    const asked = repeatQuestions(windowRows).slice(0, 5);
    const declined = declineGaps(windowRows).slice(0, 5);
    const seen = new Set();
    const out = [];
    let ai = 0;
    let di = 0;
    while (out.length < 3 && (ai < asked.length || di < declined.length)) {
      if (ai < asked.length) {
        const e = asked[ai++];
        if (!seen.has(e.normalized)) {
          seen.add(e.normalized);
          out.push({ label: shortLabel(e.sample), question: e.sample, source: "asked" });
        }
      }
      if (out.length >= 3) break;
      if (di < declined.length) {
        const e = declined[di++];
        if (!seen.has(e.normalized)) {
          seen.add(e.normalized);
          out.push({ label: shortLabel(e.sample), question: e.sample, source: "declined" });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function shortLabel(q) {
  const trimmed = String(q || "").trim().replace(/[?.!]+$/, "");
  if (!trimmed) return "";
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capped.length <= 48 ? capped : capped.slice(0, 45).trimEnd() + "...";
}

async function pickHeroImage() {
  try {
    const rows = await getHeroImages({ module: "sous" });
    // rows are { teamKey: null|string, url: string, ... } - filter to the
    // global pool (teamKey null) and pick one at random.
    const pool = (rows || []).filter((r) => !r.teamKey && r.url).map((r) => r.url);
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  } catch {
    return null;
  }
}

async function loadDomainCounts() {
  const out = { playbook: null, people: null, sc: null, spend: null };
  const sb = getSupabase();
  try {
    const [{ count: playbookCount }, contacts] = await Promise.all([
      sb.from("documents").select("*", { count: "exact", head: true }).eq("archived", false).eq("status", "Live"),
      getContacts({ module: "sous" }).catch(() => []),
    ]);
    out.playbook = playbookCount ?? null;
    out.people = Array.isArray(contacts) ? contacts.length : null;
  } catch { /* fall through - card renders without count */ }
  // SC + spend counts are informational - defer to "live" label if the read fails.
  try {
    const { count: accountsCount } = await sb.from("accounts").select("*", { count: "exact", head: true });
    out.sc = accountsCount ?? null;
  } catch { /* leave null */ }
  try {
    const { count: vendorCount } = await sb.from("vendors").select("*", { count: "exact", head: true }).is("deleted_at", null);
    out.spend = vendorCount ?? null;
  } catch { /* leave null */ }
  return out;
}

function extractFirstName(session) {
  const name = session?.user?.name || "";
  const email = session?.user?.email || "";
  if (name) return name.split(/\s+/)[0];
  if (email) {
    const local = email.split("@")[0] || "";
    // "k.fietek" -> "Kevin" pattern: single letter + dot + word -> capitalize local
    const withoutDots = local.replace(/[._]/g, " ").trim();
    const first = withoutDots.split(/\s+/)[0];
    if (first && first.length > 1) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  return null;
}

function nowClockLabel() {
  const d = new Date();
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function SousHero({ heroImage, firstName, clockLabel }) {
  // U7 verbatim - "about" not "for"; "the intranet knows" replaces the
  // enumerated modules. All Sous copy says "people", never "directory".
  const greeting = firstName
    ? `Hello ${firstName} - ask me about anything the intranet knows.`
    : `Hello - ask me about anything the intranet knows.`;
  return (
    <div className="sa-hero">
      <div
        className="sa-hero-bg"
        style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}
        aria-hidden="true"
      />
      <div className="sa-hero-overlay" aria-hidden="true" />
      <div className="sa-hero-sweep" aria-hidden="true" />
      <div className="sa-hero-inner">
        <span className="sa-hero-star" aria-hidden="true">
          <Star strokeWidth={2} />
        </span>
        <div className="sa-hero-text">
          <h1 className="sa-hero-title">Sous</h1>
          <p className="sa-hero-greeting">{greeting}</p>
        </div>
      </div>
      <div className="sa-hero-right">
        <span className="sa-freshness" title="Live Postgres, current session">
          <span className="sa-freshness-dot" aria-hidden="true" />
          PG live · {clockLabel}
        </span>
      </div>
    </div>
  );
}

export default async function SousPage() {
  if (process.env.SOUSAI_ROUTE_ENABLED !== "true") notFound();
  const session = await auth();
  const email = session?.user?.email;
  if (!email) notFound();
  if (!(await canUseSous(email))) notFound();

  const now = new Date();
  const [chips, heroImage, counts] = await Promise.all([
    loadChipsInline(now),
    pickHeroImage(),
    loadDomainCounts(),
  ]);
  const firstName = extractFirstName(session);
  const clockLabel = nowClockLabel();

  return (
    <div className="sa-page sa-animate">
      <div className="sa-shell">
        <SousSurface
          variant="page"
          chips={chips}
          autoFocus
          heroSlot={<SousHero heroImage={heroImage} firstName={firstName} clockLabel={clockLabel} />}
          domainCounts={counts}
          domainExamples={DOMAIN_CARD_EXAMPLES}
        />
      </div>
    </div>
  );
}


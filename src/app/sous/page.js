// ════════════════════════════════════════════════════════════════════════════
// /sous · Train 3 · SousAI page (server component gate + shell)
// ════════════════════════════════════════════════════════════════════════════
//
// Gate order (mirrors /api/sousai handler):
//   1. FLAG   SOUSAI_ROUTE_ENABLED === "true"  -> else notFound
//   2. AUTH   await auth() returns a session   -> else notFound
//   3. TIER   viewerTier === 'slt' OR isCorporateEmail -> else notFound
//
// The client SousSurface talks to the same /api/sousai route it always has;
// this page is UI only. Chips preload server-side to avoid a mount round-trip
// for the SLT surface; overlay in playbook.css fetches chips from the route.
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { viewerTier, isCorporateEmail } from "@/lib/opdAcl";
import { fetchReportRows } from "@/app/sousai/reports/data";
import { repeatQuestions, declineGaps, isoDay, daysAgo, serverToday } from "@/app/sousai/reports/aggregate";
import SousSurface from "./SousSurface";
import "./sous.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sous - KitchFix" };

async function loadChipsInline(email, now) {
  // Server-side: we already have auth, and we mirror the reports page's
  // canViewSousReports allowlist for chip surfacing. If the caller is not on
  // the allowlist, they still see /sous (behind the SLT-or-corp gate above),
  // but their chip row shows the static fallback instead.
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

export default async function SousPage() {
  if (process.env.SOUSAI_ROUTE_ENABLED !== "true") notFound();
  const session = await auth();
  const email = session?.user?.email;
  if (!email) notFound();
  const tier = viewerTier(email);
  const corp = tier === "slt" ? true : await isCorporateEmail(email);
  if (tier !== "slt" && !corp) notFound();

  const chips = await loadChipsInline(email, new Date());

  return (
    <div className="sa-page">
      <div className="sa-page-inner">
        <header className="sa-header">
          <p className="sa-header-mark">Ops Hub</p>
          <h1 className="sa-header-title">Sous</h1>
          <p className="sa-header-sub">
            The operator brain. Answers grounded in the Live Playbook, cited by doc id. Refusals are honest - they mean the corpus does not carry the answer yet.
          </p>
        </header>
        <SousSurface variant="page" chips={chips} autoFocus />
      </div>
    </div>
  );
}

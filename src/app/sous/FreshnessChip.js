"use client";

// ════════════════════════════════════════════════════════════════════════════
// FreshnessChip - the "PG live · h:mm AM" hero chip, client-only
// ════════════════════════════════════════════════════════════════════════════
//
// Renders the current time in the BROWSER's local zone so the chip never
// disagrees with the user's wall clock. The old server-side rendering used
// Vercel's UTC and looked wrong to every US user by 3-8 hours (DR-02).
//
// Two shapes are intentional and must not be unified:
//   - This chip:      short form "PG live · h:mm AM" with the full local
//                     timestamp in title= for on-hover verification.
//   - Tool payloads:  long form "PG live as of h:mm AM ZONE" via
//                     _freshness.pgLiveNow(), consumed by the model.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";

export default function FreshnessChip() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    // Re-tick each minute so the chip stays accurate on long sessions.
    const t = setInterval(update, 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const short = now
    ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "…";
  const full = now
    ? now.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "long" })
    : "";
  return (
    <span className="sa-freshness" title={full ? `PG live, ${full}` : "PG live"}>
      <span className="sa-freshness-dot" aria-hidden="true" />
      PG live · {short}
    </span>
  );
}

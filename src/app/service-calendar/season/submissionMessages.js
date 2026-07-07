"use client";

// Rotating post-submission headlines for the SC momentum toast. Milestone
// lines take precedence over the general pool so the operator sees the
// period-progress cue when they cross it.

const POOL = [
  "Dialed in.",
  "In the books.",
  "Nice work.",
  "That's how it's done.",
  "Clean entry.",
  "Right on the money.",
  "Logged and locked.",
  "Another one down.",
  "Books looking sharp.",
  "Solid - keep rolling.",
  "Buttoned up.",
  "Money.",
];

const BULK_POOL = [
  "{bulkDays} days in - nice haul.",
  "Knocked out {bulkDays} days.",
  "Bulk entry, buttoned up.",
];

// Module-level so we don't immediate-repeat within a page load.
let lastPoolIdx = -1;
let lastBulkIdx = -1;

function pickFromPool(pool, lastIdx) {
  if (pool.length <= 1) return { idx: 0, msg: pool[0] };
  let idx = Math.floor(Math.random() * pool.length);
  if (idx === lastIdx) idx = (idx + 1) % pool.length;
  return { idx, msg: pool[idx] };
}

export function pickHeadline({ daysEntered, totalDays, isBulk, bulkDays }) {
  const hasProgress = Number.isFinite(daysEntered) && Number.isFinite(totalDays) && totalDays > 0;

  if (hasProgress) {
    if (daysEntered === totalDays) {
      return { text: "Period complete. That's a wrap.", milestone: "complete" };
    }
    const remaining = totalDays - daysEntered;
    if (remaining > 0 && remaining <= 3) {
      return { text: `Almost there - ${remaining} to go.`, milestone: "almost" };
    }
    if (daysEntered === Math.ceil(totalDays / 2)) {
      return { text: "Halfway home.", milestone: "halfway" };
    }
    if (daysEntered === 1) {
      return { text: "And we're off.", milestone: "first" };
    }
  }

  if (isBulk) {
    const { idx, msg } = pickFromPool(BULK_POOL, lastBulkIdx);
    lastBulkIdx = idx;
    return { text: msg.replace("{bulkDays}", String(bulkDays ?? "")), milestone: null };
  }

  const { idx, msg } = pickFromPool(POOL, lastPoolIdx);
  lastPoolIdx = idx;
  return { text: msg, milestone: null };
}

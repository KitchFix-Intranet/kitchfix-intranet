// ════════════════════════════════════════════════════════════════════════════
// performanceChain — chain lookup, snapshot helpers
//
// Module: People Portal · Leadership Dugout
// Sprint: 1
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// Sibling: src/lib/incidentActions.js
// ════════════════════════════════════════════════════════════════════════════

import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { TABS, CHAIN_COL } from "@/lib/performanceSchema";

// ─── Read entire chain table ───
// Skips the 3-row header block seeded from the xlsx template:
//   row 1: column names (e.g., "leader_email")
//   row 2: type hints (e.g., "email")
//   row 3: descriptions (e.g., "Primary key. Reviewed Party.")
// Real data starts row 4. Filter on row[0] containing "@" to detect a real
// email, which excludes all three header rows even if their order changes.
export async function readChain() {
  try {
    const { rows } = await readSheetSA(SHEET_IDS.HUB, TABS.CHAIN);
    const entries = (rows || [])
      .filter((r) => {
        const email = String(r[CHAIN_COL.LEADER_EMAIL] || "");
        return email.includes("@") && !email.includes(" "); // skip headers/types/descriptions
      })
      .map(rowToChainEntry);
    console.log("[performanceChain] readChain:", entries.length, "active entries");
    return entries;
  } catch (e) {
    console.error("[performanceChain] readChain failed:", e.message);
    return [];
  }
}

// ─── Find a leader's chain entry by email ───
export async function getChainForLeader(leaderEmail) {
  if (!leaderEmail) return null;
  const chain = await readChain();
  const norm = leaderEmail.toLowerCase().trim();
  return (
    chain.find(
      (entry) =>
        entry.leader_email.toLowerCase() === norm &&
        entry.chain_status === "Active"
    ) || null
  );
}

// ─── List all leaders this user reviews (as Reviewer) ───
export async function getLeadersReviewedBy(reviewerEmail) {
  if (!reviewerEmail) return [];
  const chain = await readChain();
  const norm = reviewerEmail.toLowerCase().trim();
  return chain.filter(
    (entry) =>
      entry.reviewer_email.toLowerCase() === norm &&
      entry.chain_status === "Active"
  );
}

// ─── List all leaders this user has Oversight on ───
export async function getLeadersOverseenBy(oversightEmail) {
  if (!oversightEmail) return [];
  const chain = await readChain();
  const norm = oversightEmail.toLowerCase().trim();
  return chain.filter(
    (entry) =>
      entry.oversight_email.toLowerCase() === norm &&
      entry.chain_status === "Active"
  );
}

// ─── Snapshot chain entry into instance row at instrument creation ───
// Used when a Cycle Review or WOW Plan is opened. The chain at that moment
// becomes immutable for that instance even if the underlying chain changes.
export function snapshotChain(entry) {
  if (!entry) return null;
  return {
    leader_email: entry.leader_email,
    leader_name: entry.leader_name,
    role: entry.role,
    account: entry.account,
    contract_type: entry.contract_type,
    reviewer_email: entry.reviewer_email,
    reviewer_name: entry.reviewer_name,
    oversight_email: entry.oversight_email,
    oversight_name: entry.oversight_name,
  };
}

// ─── Row → object ───
function rowToChainEntry(row) {
  return {
    leader_email: String(row[CHAIN_COL.LEADER_EMAIL] || "").trim(),
    leader_name: String(row[CHAIN_COL.LEADER_NAME] || "").trim(),
    role: String(row[CHAIN_COL.ROLE] || "").trim(),
    account: String(row[CHAIN_COL.ACCOUNT] || "").trim(),
    contract_type: String(row[CHAIN_COL.CONTRACT_TYPE] || "").trim(),
    reviewer_email: String(row[CHAIN_COL.REVIEWER_EMAIL] || "").trim(),
    reviewer_name: String(row[CHAIN_COL.REVIEWER_NAME] || "").trim(),
    oversight_email: String(row[CHAIN_COL.OVERSIGHT_EMAIL] || "").trim(),
    oversight_name: String(row[CHAIN_COL.OVERSIGHT_NAME] || "").trim(),
    chain_effective_date: String(row[CHAIN_COL.CHAIN_EFFECTIVE_DATE] || "").trim(),
    chain_status: String(row[CHAIN_COL.CHAIN_STATUS] || "").trim() || "Active",
    notes: String(row[CHAIN_COL.NOTES] || "").trim(),
  };
}
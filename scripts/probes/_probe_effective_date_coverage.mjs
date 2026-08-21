// Read-only probe: how often would the effective_date-null bug actually fire?
// Q1: review_queue rows with null/empty invoice_date (Mirror A trigger)
// Q2: ai_line_items rows referenced by review_queue with null invoice_date (Mirror B trigger)
// Q3: arithmetic_fail rows specifically - fallback resolvability via invoice_submissions
import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("══════════════════════════════════════════════════════════════");
console.log("Q1 - review_queue null invoice_date (Mirror A trigger)");
console.log("══════════════════════════════════════════════════════════════");

const { count: rqTotal } = await sb.from("review_queue").select("*", { count: "exact", head: true });
const { count: rqNullDate } = await sb.from("review_queue").select("*", { count: "exact", head: true }).is("invoice_date", null);
console.log("  total review_queue rows:                       " + rqTotal);
console.log("  rows with invoice_date IS NULL:                " + rqNullDate);
console.log("  pct:                                           " + (rqTotal ? (rqNullDate / rqTotal * 100).toFixed(1) : "n/a") + "%");

// Also count by status (pending vs already-resolved) since only pending rows
// could actually flow through the writer in the future.
const { count: rqPending } = await sb.from("review_queue").select("*", { count: "exact", head: true }).eq("status", "pending");
const { count: rqPendingNullDate } = await sb.from("review_queue").select("*", { count: "exact", head: true }).eq("status", "pending").is("invoice_date", null);
console.log("  pending rows (would flow through writer):      " + rqPending);
console.log("  pending rows with invoice_date IS NULL:        " + rqPendingNullDate);
console.log("  pct of pending:                                " + (rqPending ? (rqPendingNullDate / rqPending * 100).toFixed(1) : "n/a") + "%");

console.log();
console.log("══════════════════════════════════════════════════════════════");
console.log("Q2 - ai_line_items reachable from review_queue + null invoice_date (Mirror B trigger)");
console.log("══════════════════════════════════════════════════════════════");

// Mirror B's lookup is .eq("invoice_uuid", qrow.invoice_id) AND .eq("description", qrow.line_item_text).
// So an ai_line_items row matters if (invoice_uuid, description) matches some review_queue row.
// Approach: fetch RQ pairs, then for each unique invoice_id pull its ai_line_items rows
// and intersect on description.
const { data: rqRefs } = await sb.from("review_queue")
  .select("invoice_id, line_item_text, reason, status")
  .not("invoice_id", "is", null);
console.log("  review_queue rows with non-null invoice_id:    " + (rqRefs?.length || 0));

const rqByInvoice = new Map();
for (const r of rqRefs || []) {
  if (!rqByInvoice.has(r.invoice_id)) rqByInvoice.set(r.invoice_id, new Set());
  rqByInvoice.get(r.invoice_id).add(r.line_item_text || "");
}
console.log("  distinct invoice_ids referenced:               " + rqByInvoice.size);

let mirrorBTotal = 0, mirrorBNullDate = 0;
for (const [invUuid, descs] of rqByInvoice) {
  const { data: ai } = await sb.from("ai_line_items")
    .select("description, invoice_date")
    .eq("invoice_uuid", invUuid);
  for (const r of ai || []) {
    if (descs.has(r.description)) {
      mirrorBTotal++;
      if (!r.invoice_date) mirrorBNullDate++;
    }
  }
}
console.log("  ai_line_items rows matching any RQ pair:       " + mirrorBTotal);
console.log("  of those, with invoice_date IS NULL:           " + mirrorBNullDate);
console.log("  pct:                                           " + (mirrorBTotal ? (mirrorBNullDate / mirrorBTotal * 100).toFixed(1) : "n/a") + "%");

console.log();
console.log("══════════════════════════════════════════════════════════════");
console.log("Q3 - arithmetic_fail rows: fallback resolvability");
console.log("══════════════════════════════════════════════════════════════");

// Pull arithmetic_fail rows (the ones that actually go through Mirror B)
const { data: arithRows } = await sb.from("review_queue")
  .select("id, invoice_id, invoice_date, status")
  .eq("reason", "arithmetic_fail");
console.log("  total arithmetic_fail rows:                    " + (arithRows?.length || 0));
const arithPending = (arithRows || []).filter((r) => r.status === "pending").length;
console.log("  of those, pending:                             " + arithPending);

const arithNullOwnDate = (arithRows || []).filter((r) => !r.invoice_date);
console.log("  with RQ invoice_date IS NULL:                  " + arithNullOwnDate.length);

// For arithmetic_fail rows with non-null invoice_id, check what invoice_submissions has.
// (a) Of arith rows with null RQ invoice_date, how many have invoice_submissions.invoice_date?
// (b) Of arith rows with null RQ invoice_date AND null ai_line_items.invoice_date,
//     how many have invoice_submissions.invoice_date as the fallback?
const arithInvIds = [...new Set((arithRows || []).map((r) => r.invoice_id).filter(Boolean))];
let invSubMap = new Map();
if (arithInvIds.length > 0) {
  const { data: invs } = await sb.from("invoice_submissions")
    .select("id, invoice_date, submitted_at")
    .in("id", arithInvIds);
  for (const i of invs || []) invSubMap.set(i.id, i);
}

let arithBothNullAndIsResolvable = 0;
let arithBothNullAndUnresolvable = 0;
let arithNoInvoiceId = 0;
for (const r of arithNullOwnDate) {
  if (!r.invoice_id) { arithNoInvoiceId++; continue; }
  const inv = invSubMap.get(r.invoice_id);
  if (inv && inv.invoice_date) arithBothNullAndIsResolvable++;
  else arithBothNullAndUnresolvable++;
}
console.log();
console.log("  Of the " + arithNullOwnDate.length + " arith rows with null RQ invoice_date:");
console.log("    no invoice_id at all (unfixable):            " + arithNoInvoiceId);
console.log("    invoice_submissions.invoice_date AVAILABLE:  " + arithBothNullAndIsResolvable + " (fallback works)");
console.log("    invoice_submissions.invoice_date ALSO null:  " + arithBothNullAndUnresolvable + " (true unresolvable)");

// Also check: of ALL arith rows (not just null-date ones), what % have invoice_submissions.invoice_date populated?
let arithInvSubHasDate = 0;
for (const r of arithRows || []) {
  if (!r.invoice_id) continue;
  const inv = invSubMap.get(r.invoice_id);
  if (inv && inv.invoice_date) arithInvSubHasDate++;
}
console.log();
console.log("  Total arith rows with invoice_submissions.invoice_date populated: " + arithInvSubHasDate + " / " + (arithRows?.length || 0));

// Bonus: distribution of arithmetic_fail status
const statusDist = {};
for (const r of arithRows || []) {
  statusDist[r.status] = (statusDist[r.status] || 0) + 1;
}
console.log();
console.log("  arith rows by status: " + JSON.stringify(statusDist));

process.exit(0);

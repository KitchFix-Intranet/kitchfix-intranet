// Nightly price-change report.
//
// Primary source: `sc_config_changelog` (append-only per sc-4). Every
// app-side price/fee edit inserts a row in the same transaction as the
// underlying `sc_service_prices` / `sc_fee_schedule` write - the
// orchestrator at `src/lib/dataStore/serviceCalendar.js:1801` handles
// that atomically. So this table is the canonical WHAT+WHO+WHY audit
// stream for anything that flowed through the SC admin surface.
//
// Cross-check: `content/documents/REF-141.mdx` (the corpus Price Book,
// generated from PG). If REF-141 drifted vs. the committed copy but
// no changelog rows exist for the window, that's an UNATTRIBUTED
// price drift - almost certainly a Studio direct-SQL edit that
// bypassed the JS orchestrator's changelog write. Surface loudly.
//
// Slack: uses the existing #service-calendar webhook,
// `SLACK_SC_WEBHOOK_URL` (also used by `src/app/api/cron/schedule-drift`
// and Kevin's other SC cron cadence). Message posts only when there
// is something to say - a channel that fires nightly-empty gets muted,
// and then the one night that matters is missed.
//
// Usage:
//   node scripts/price-change-report.mjs                       (24h, no Slack)
//   node scripts/price-change-report.mjs --slack               (24h, post to Slack)
//   node scripts/price-change-report.mjs --since 90d --slack   (90-day widened window)
//   node scripts/price-change-report.mjs --since 2026-06-01    (from a date)
//
// Env (mirrors the other SC workflows):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   query PG
//   SLACK_SC_WEBHOOK_URL                       optional, needed with --slack
//   GITHUB_SERVER_URL, GITHUB_REPOSITORY,      optional; when set, footer
//   GITHUB_RUN_ID                              carries a workflow-run link

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);

const sinceRaw = argVal("--since", "24h");
const doSlack = flag("--slack");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const REF_141 = path.join(REPO_ROOT, "content", "documents", "REF-141.mdx");
const PG_SNAPSHOT = "/tmp/pg_prices.json";
const REGEN_OUT = "/tmp/REF-141-nightly.mdx";

// ── Since → ISO cutoff ───────────────────────────────────────────────────────
// Accepts: NN h / d / w   or an ISO date / timestamp.
function computeCutoffISO(raw) {
  const m = raw.match(/^(\d+)([hdw])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unitMs = { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2]];
    return new Date(Date.now() - n * unitMs).toISOString();
  }
  // Try ISO date/timestamp parse.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`--since: invalid duration or timestamp '${raw}'`);
  }
  return d.toISOString();
}
const cutoffISO = computeCutoffISO(sinceRaw);

// ── Guards ───────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
  process.exit(1);
}
if (doSlack && !process.env.SLACK_SC_WEBHOOK_URL) {
  console.error("ERROR: --slack passed but SLACK_SC_WEBHOOK_URL is not set.");
  process.exit(1);
}
if (!existsSync(REF_141)) {
  console.error(`ERROR: committed REF-141 not found at ${REF_141}. Refusing to run.`);
  process.exit(1);
}

console.error(`[price-report] since=${cutoffISO}  slack=${doSlack}`);

// ── 1. Query changelog (primary source) ─────────────────────────────────────
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: changes, error: eChange } = await sb
  .from("sc_config_changelog")
  .select("account_key,entity_type,entity_id,entity_label,change_type,old_value,new_value,effective_date,reason,requested_by,changed_by,changed_at")
  .in("entity_type", ["price", "fee"])
  .gte("changed_at", cutoffISO)
  .order("changed_at", { ascending: true });

if (eChange) {
  console.error("ERROR: sc_config_changelog query failed:", eChange.message);
  process.exit(1);
}
console.error(`[price-report] changelog rows since cutoff: ${changes.length}`);

// ── 2. Regenerate REF-141 into a temp path for the cross-check ──────────────
// audit-sc-prices.mjs writes /tmp/pg_prices.json; the workflow runs it as a
// prior step. If the snapshot isn't present (e.g. someone invoked this script
// bare from a shell), refuse - never overwrite the committed file with an
// empty result.
if (!existsSync(PG_SNAPSHOT)) {
  console.error(`ERROR: PG snapshot missing at ${PG_SNAPSHOT}. Run \`node scripts/audit-sc-prices.mjs --out ${PG_SNAPSHOT}\` first.`);
  process.exit(1);
}
try {
  const snap = JSON.parse(readFileSync(PG_SNAPSHOT, "utf-8"));
  if (!snap.rows || snap.rows.length === 0) {
    console.error(`ERROR: PG snapshot at ${PG_SNAPSHOT} has 0 rows. Refusing to regenerate REF-141 (would produce an empty book).`);
    process.exit(1);
  }
} catch (e) {
  console.error(`ERROR: PG snapshot at ${PG_SNAPSHOT} is not valid JSON:`, e.message);
  process.exit(1);
}
try {
  execFileSync("node", ["scripts/generate-price-book.mjs", "--out", REGEN_OUT], { cwd: REPO_ROOT, stdio: "inherit" });
} catch (e) {
  console.error("ERROR: generate-price-book.mjs failed. Not overwriting the committed book.", e.message);
  process.exit(1);
}

// ── 3. Diff REF-141 vs regenerated, IGNORING generated-timestamp lines ──────
// The generator emits three lines that always differ per run:
//   - a `**Generated:** YYYY-MM-DD HH:MM:SSZ ...` header line
//   - a `**PG snapshot:** YYYY-MM-DDTHH:MM:SS.mmmZ` header line (bumps each
//     time audit-sc-prices runs, even when the underlying prices didn't move)
//   - a trailing `_Generated YYYY-MM-DDTHH:MM:SS.mmmZ from PG snapshot ...._`
// Strip all three for comparison; anything else that differs is real drift.
function stripVolatile(text) {
  return text
    .replace(/^\*\*Generated:\*\*.*$/gm, "")
    .replace(/^\*\*PG snapshot:\*\*.*$/gm, "")
    .replace(/^_Generated .*_$/gm, "");
}
const committed = readFileSync(REF_141, "utf-8");
const regenerated = readFileSync(REGEN_OUT, "utf-8");
const drifted = stripVolatile(committed) !== stripVolatile(regenerated);
console.error(`[price-report] REF-141 drift vs committed: ${drifted ? "YES" : "no"}`);

// ── 4. Nothing to say? Silence. ─────────────────────────────────────────────
if (changes.length === 0 && !drifted) {
  console.error("[price-report] no changelog rows and no REF-141 drift — no Slack message");
  process.exit(0);
}

// ── 5. Compose the Slack message ────────────────────────────────────────────
const unattributed = drifted && changes.length === 0;

function moneyFmt(v) {
  if (v == null) return "(none)";
  if (typeof v === "number") return "$" + v.toFixed(2);
  return "`" + JSON.stringify(v) + "`";
}
function valueFmt(entityType, jsonb) {
  if (jsonb == null) return "(none)";
  if (entityType === "price" && typeof jsonb.price !== "undefined") return moneyFmt(jsonb.price);
  if (entityType === "fee" && typeof jsonb.amount !== "undefined") return moneyFmt(jsonb.amount);
  // Fallback: compact JSON.
  return "`" + JSON.stringify(jsonb) + "`";
}
function whoFmt(v) {
  if (v == null || v === "") return "_not recorded (Studio edit?)_";
  return "`" + v + "`";
}
function whyFmt(v) {
  if (v == null || v === "") return "_not recorded (Studio edit?)_";
  return v.length > 200 ? v.slice(0, 197) + "..." : v;
}
function tsFmt(iso) {
  return iso.slice(0, 16).replace("T", " ") + "Z";
}

const blocks = [];
const nChanges = changes.length;

if (unattributed) {
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: ":warning: *UNATTRIBUTED price drift* — REF-141 changed but no `sc_config_changelog` entry. Likely a direct Studio / SQL edit that bypassed the app's audit path." },
  });
  blocks.push({ type: "divider" });
}
blocks.push({
  type: "header",
  text: { type: "plain_text", text: `Price changes — ${nChanges} change${nChanges === 1 ? "" : "s"}${nChanges === 0 ? " (drift only)" : ""}` },
});
blocks.push({
  type: "context",
  elements: [{ type: "mrkdwn", text: `_since ${cutoffISO.slice(0, 16).replace("T", " ")}Z · REF-141 drift: ${drifted ? "yes" : "no"}_` }],
});

for (const c of changes) {
  const oldV = valueFmt(c.entity_type, c.old_value);
  const newV = valueFmt(c.entity_type, c.new_value);
  const label = c.entity_label || c.entity_type;
  const eff = c.effective_date ? ` · eff ${c.effective_date}` : "";
  const requested = c.requested_by ? ` · requested by \`${c.requested_by}\`` : "";
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text:
      `*${c.account_key}* · ${label} _(${c.entity_type}, ${c.change_type})_${eff}\n` +
      `${oldV} → *${newV}*\n` +
      `Who: ${whoFmt(c.changed_by)}${requested} · Why: ${whyFmt(c.reason)}\n` +
      `_${tsFmt(c.changed_at)}_`
    },
  });
}

// Footer: workflow-run link when running under Actions.
if (process.env.GITHUB_RUN_ID && process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  blocks.push({ type: "divider" });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${runUrl}|workflow run>` }] });
}

// Plain-text fallback for Slack clients that don't render blocks.
const plain = unattributed
  ? `UNATTRIBUTED price drift + ${nChanges} recorded change(s) — see channel`
  : `Price changes: ${nChanges} change${nChanges === 1 ? "" : "s"}${drifted ? " + REF-141 drift" : ""}`;

// ── 6. Post (or print, for local dry-runs) ─────────────────────────────────
const payload = { text: plain, blocks };

if (!doSlack) {
  console.error("[price-report] --slack not passed; printing payload to stdout instead:");
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

try {
  const res = await fetch(process.env.SLACK_SC_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`ERROR: Slack post failed with ${res.status}: ${body}`);
    process.exit(1);
  }
  console.error(`[price-report] Slack post OK (${nChanges} change${nChanges === 1 ? "" : "s"}, drift=${drifted})`);
} catch (e) {
  console.error("ERROR: Slack post threw:", e.message);
  process.exit(1);
}

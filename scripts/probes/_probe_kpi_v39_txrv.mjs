// scripts/_probe_kpi_v39_txrv.mjs
//
// V37/V39 acceptance for TXR - TX - V. The labor /api route is
// auth-gated (session cookie required) and TEST_MODE only bypasses
// middleware, so this probe verifies the fix in two auth-less ways:
//   1. code-read: the labor route + board.js + StoryBlock.js emit
//      the V37 shape (basis, no envelope carve-out, sub-line word)
//   2. data-read: TXR - TX - V has 7 sc_labor_budgets rows (P4-P10)
//      each satisfying hourly_budget = revenue_forecast x labor_ratio,
//      P8 = 9231; TXR - TX - V has actuals in FYTD; accounts.region
//      places it in West
//
// Usage: node --env-file=.env.local scripts/_probe_kpi_v39_txrv.mjs

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log("=".repeat(72));
  console.log("V37/V39 TXR - TX - V acceptance probe");
  console.log("=".repeat(72));

  console.log("\n[PART A - code-read: V6_ENVELOPE_ACCOUNTS removed, basis wired]");
  const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/kpi/labor/route.js"), "utf8");
  const boardSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/lib/board.js"), "utf8");
  const storySrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/kpi/labor/components/StoryBlock.js"), "utf8");
  const routeNoComments = routeSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const v6Refs = [...routeNoComments.matchAll(/V6_ENVELOPE_ACCOUNTS/g)];
  log(`V6_ENVELOPE_ACCOUNTS references in route (code) = ${v6Refs.length}  (want 0)`, v6Refs.length === 0);
  const envExcluded = [...routeNoComments.matchAll(/envelope_excluded|aggregate_excluded_members|budget_notes/g)];
  log(`envelope_excluded / aggregate_excluded_members / budget_notes references (code) = ${envExcluded.length}  (want 0)`, envExcluded.length === 0);
  log(`labor route defines V37_REVENUE_FLEX_ACCOUNTS`, /V37_REVENUE_FLEX_ACCOUNTS\s*=\s*new\s+Set\(/.test(routeSrc));
  log(`resolveMemberBudget emits basis field`, /basis:\s*isRevenueFlex\s*\?\s*"envelope"\s*:\s*"pnl"/.test(routeSrc));
  log(`single-account path emits basis field`, /basis:\s*isRevenueFlexAcct\s*\?\s*"envelope"/.test(routeSrc));
  log(`board.js reads basis into budget_basis`, /budget_basis:\s*\(/.test(boardSrc) && /basisByPeriod/.test(boardSrc));
  log(`StoryBlock renders board.budget_basis in sub-line`, /board\?\.budget_basis/.test(storySrc));

  console.log("\n[PART B - data-read: TXR - TX - V has the expected shape in PG]");
  const acct = "TXR - TX - V";
  const [budgetsQ, ratioQ, actualsQ] = await Promise.all([
    supa.from("sc_labor_budgets").select("period, hourly_budget, revenue_forecast, reason").eq("account_key", acct).is("superseded_at", null).order("period"),
    supa.from("accounts").select("labor_ratio, region").eq("team_key", acct).single(),
    supa.from("labor_actuals_latest").select("week_start", { count: "exact", head: true }).eq("account_key", acct).gte("week_start", "2025-12-29").lte("week_end", "2026-08-18"),
  ]);
  if (budgetsQ.error) { console.log("  budgets error:", budgetsQ.error.message); hardFail++; }
  if (ratioQ.error)   { console.log("  accounts error:", ratioQ.error.message); hardFail++; }
  if (actualsQ.error) { console.log("  actuals error:", actualsQ.error.message); hardFail++; }

  const budgets = budgetsQ.data || [];
  const ratio = ratioQ.data?.labor_ratio;
  const region = ratioQ.data?.region;
  log(`accounts.labor_ratio = ${ratio}  (want 0.1923)`, Math.abs((ratio ?? 0) - 0.1923) < 1e-6);
  log(`accounts.region = ${region}  (want West)`, region === "West");
  log(`sc_labor_budgets rows = ${budgets.length}  (want 7, P4-P10)`, budgets.length === 7);
  const p8 = budgets.find(b => parseInt(String(b.period), 10) === 8);
  log(`P8 hourly_budget = ${p8?.hourly_budget}  (want 9231)`, p8?.hourly_budget === 9231);
  if (p8 && ratio) {
    const computed = Math.round(p8.revenue_forecast * ratio);
    log(`P8 hourly_budget matches revenue_forecast (${p8.revenue_forecast}) x labor_ratio (${ratio}) = ${computed} within $1.00`,
        Math.abs(computed - p8.hourly_budget) <= 1.0);
  }
  const envelopeCheck = budgets.every(b => {
    const computed = b.revenue_forecast * ratio;
    return Math.abs(computed - b.hourly_budget) <= 1.0;
  });
  log(`every TXR - TX - V budget row satisfies envelope formula within $1.00`, envelopeCheck);
  log(`TXR - TX - V has FYTD actuals rows  count=${actualsQ.count}`, (actualsQ.count || 0) > 0);

  console.log(`\n${"=".repeat(72)}`);
  console.log(hardFail === 0 ? "V37/V39 TXR-V PROBE: PASS" : `V37/V39 TXR-V PROBE: ${hardFail} FAIL`);
  console.log("=".repeat(72));
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });

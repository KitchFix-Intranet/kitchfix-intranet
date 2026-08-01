// PROBE (read-only, service-account): budget-allocation math + TXR-TX-V
// data. Sheets read via service-account. NO WRITES.
//
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_labor_math.mjs

import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const MLB = ["CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V"];
const MLB_SET = new Set(MLB);

function normDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (isoMatch) return isoMatch[1];
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const num = Number(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + num);
    return epoch.toISOString().split("T")[0];
  }
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch {}
  return "";
}

// ═══════════════════════════════════════════════════════════════
// Load HUB period_data + labor_budgets + homestand_schedule
// ═══════════════════════════════════════════════════════════════
console.log("═══ HUB LOAD ═══\n");
const periodsRes = await readSheetSA(SHEET_IDS.HUB, "period_data");
const budgetsRes = await readSheetSA(SHEET_IDS.HUB, "labor_budgets");
const scheduleRes = await readSheetSA(SHEET_IDS.HUB, "homestand_schedule");

const periods = periodsRes.rows.filter(r => r[0]).map(r => ({
  name: String(r[0]).trim(),
  start: normDate(r[1]),
  end: normDate(r[2]),
  due: normDate(r[3]),
}));
console.log(`periods loaded: ${periods.length}`);
console.log(`  headers: ${JSON.stringify(periodsRes.headers)}`);

// ═══════════════════════════════════════════════════════════════
// PART 1 - Budget math per-account
// ═══════════════════════════════════════════════════════════════
function getPeriodForDate(dateStr) {
  for (const p of periods) if (dateStr >= p.start && dateStr <= p.end) return p.name;
  return null;
}

console.log("\n═══ labor_budgets (P4-P10 for MLB accounts) ═══");
console.log(`headers: ${JSON.stringify(budgetsRes.headers)}\n`);

const budgets = budgetsRes.rows
  .filter(r => MLB_SET.has(String(r[0] || "").trim()))
  .map(r => ({
    account: String(r[0]).trim(),
    period: String(r[1]).trim(),
    hourlyBudget: Number(r[2]) || 0,
    salaryBudget: Number(r[3]) || 0,
    revenue: Number(r[4]) || 0,
    foodBudget: Number(r[5]) || 0,
    packagingBudget: Number(r[6]) || 0,
  }));

const budgetByAcctPeriod = new Map();
for (const b of budgets) budgetByAcctPeriod.set(`${b.account}|${b.period}`, b);

// Print budgets table
console.log("account         period   hourlyBudget   salaryBudget   revenue        foodBudget    packagingBudget");
for (const acct of MLB) {
  for (const b of budgets.filter(x => x.account === acct).sort((a,b) => a.period.localeCompare(b.period))) {
    console.log(
      `${acct.padEnd(14)}  ${b.period.padEnd(6)}   ${String(b.hourlyBudget).padStart(12)}   ${String(b.salaryBudget).padStart(12)}   ${String(b.revenue).padStart(12)}   ${String(b.foodBudget).padStart(11)}   ${String(b.packagingBudget).padStart(15)}`
    );
  }
  console.log("");
}

// Parse homestand schedule per account. Applies buildLaborContext filtering:
// account match, dayType uppercase.
function buildScheduleForAccount(acct) {
  return scheduleRes.rows
    .filter(r => String(r[0] || "").trim() === acct)
    .map(r => ({
      account: acct,
      date: normDate(r[1]),
      dayOfWeek: String(r[2] || "").trim(),
      dayType: String(r[3] || "").trim().toUpperCase(),
      opponent: String(r[4] || "").trim(),
      homestandId: String(r[5] || "").trim(),
    }))
    .filter(r => r.date && r.dayType)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Reproduce buildLaborContext math per account
function computeLaborContext(acct) {
  const schedule = buildScheduleForAccount(acct);
  const acctBudgets = budgets.filter(b => b.account === acct);
  const workingDaysPerPeriod = {};
  for (const day of schedule) {
    const p = getPeriodForDate(day.date);
    if (p) workingDaysPerPeriod[p] = (workingDaysPerPeriod[p] || 0) + 1;
  }
  const dailyRates = {};
  for (const b of acctBudgets) {
    const wd = workingDaysPerPeriod[b.period] || 1;
    dailyRates[b.period] = b.hourlyBudget / wd;
  }
  // Group by homestand_id
  const hsGroups = {};
  const hsOrder = [];
  const seen = new Set();
  for (const day of schedule) {
    const id = day.homestandId || "(none)";
    if (!hsGroups[id]) hsGroups[id] = [];
    hsGroups[id].push(day);
    if (!seen.has(id)) { seen.add(id); hsOrder.push(id); }
  }
  const homestands = [];
  for (const hsId of hsOrder) {
    if (hsId === "CLEAN" || hsId === "(none)") continue;
    const days = hsGroups[hsId];
    if (!days || !days.length) continue;
    const dayTypeCounts = new Map();
    for (const d of days) dayTypeCounts.set(d.dayType, (dayTypeCounts.get(d.dayType) || 0) + 1);
    let envelope = 0;
    const periodsTouched = new Set();
    for (const day of days) {
      const p = getPeriodForDate(day.date);
      if (p && dailyRates[p]) {
        envelope += dailyRates[p];
        periodsTouched.add(p);
      }
    }
    envelope = Math.round(envelope);
    homestands.push({
      hsId,
      startDate: days[0].date,
      endDate: days[days.length - 1].date,
      totalDays: days.length,
      gameDays: (dayTypeCounts.get("GAME") || 0),
      prepDays: (dayTypeCounts.get("PREP") || 0),
      openDays: (dayTypeCounts.get("OPEN") || 0),
      closeDays: (dayTypeCounts.get("CLOSE") || 0),
      cleanDays: (dayTypeCounts.get("CLEAN") || 0),
      dayTypes: [...dayTypeCounts.entries()].map(([k, v]) => `${k}=${v}`).join(","),
      periods: [...periodsTouched],
      envelope,
    });
  }
  return { schedule, workingDaysPerPeriod, dailyRates, homestands, acctBudgets };
}

const cinCtx = computeLaborContext("CIN - OH");

// PART 1.2: what counts as a homestand day
console.log("\n═══ CIN-OH: homestand day-type distribution per HS ═══\n");
console.log("hs      start        end          totalDays  dayTypes");
for (const h of cinCtx.homestands) {
  console.log(`${h.hsId.padEnd(6)}  ${h.startDate}   ${h.endDate}   ${String(h.totalDays).padStart(9)}  ${h.dayTypes}`);
}

// PART 1.3: CIN-OH 13 homestands, tool-span vs game-derived-span
console.log("\n═══ CIN-OH tool vs game-derived span ═══");
console.log("Tool span = HS bounds from HUB sheet (includes PREP/OPEN/CLOSE/CLEAN).");
console.log("Game-derived = SC sc_homestand_schedule game rows only.\n");

// Load SC-side game-derived
async function fetchScGames(account) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("sc_homestand_schedule")
      .select("service_date, day_type, opponent, homestand_id")
      .eq("account_key", account)
      .in("day_type", ["GAME", "AWAY", "EXHIBITION"])
      .order("service_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error(account, error.message); return []; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
// Compute game-derived blocks (GAME runs bounded by AWAY)
function deriveGameBlocks(rows) {
  const seasonRows = rows.filter(r => r.day_type === "GAME" || r.day_type === "AWAY")
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
  const blocks = [];
  let curr = null;
  for (const r of seasonRows) {
    if (r.day_type === "GAME") {
      if (!curr) curr = { first: r.service_date, last: r.service_date, gameCount: 0 };
      curr.last = r.service_date;
      curr.gameCount += 1;
    } else {
      if (curr) { blocks.push(curr); curr = null; }
    }
  }
  if (curr) blocks.push(curr);
  return blocks;
}

const cinGames = await fetchScGames("CIN - OH");
const cinGameBlocks = deriveGameBlocks(cinGames);
console.log(`ord  tool_span                        tool_days   game_span                         game_days`);
const cinTool = cinCtx.homestands;
const maxLen = Math.max(cinTool.length, cinGameBlocks.length);
for (let i = 0; i < maxLen; i++) {
  const t = cinTool[i];
  const g = cinGameBlocks[i];
  const toolLen = t ? Math.round((new Date(t.endDate + "T00:00:00") - new Date(t.startDate + "T00:00:00")) / 86400000) + 1 : 0;
  const gameLen = g ? Math.round((new Date(g.last + "T00:00:00") - new Date(g.first + "T00:00:00")) / 86400000) + 1 : 0;
  console.log(
    `${String(i+1).padStart(3)}  ${(t ? `${t.hsId} ${t.startDate}..${t.endDate}` : "(none)").padEnd(32)}  ${String(toolLen).padStart(9)}   ${(g ? `${g.first}..${g.last}` : "(none)").padEnd(32)}  ${String(gameLen).padStart(9)}`
  );
}

// PART 1.4: prep-day distribution
console.log("\n═══ CIN-OH prep-day census (per HS, count of each preceding day-type) ═══\n");
for (const h of cinCtx.homestands) {
  console.log(`${h.hsId}  ${h.startDate}..${h.endDate}  ${h.dayTypes}`);
}

// PART 1.5: self-consistency check per account (game-derived envelope sum vs P&L season hourly)
console.log("\n═══ Self-consistency check ═══\n");
console.log("Tool math: sum(envelope) across HSes vs sum(hourlyBudget) across periods\n");
console.log("account         tool_env_sum   season_hourly   diff");
for (const acct of MLB) {
  const ctx = computeLaborContext(acct);
  const envSum = ctx.homestands.reduce((s, h) => s + h.envelope, 0);
  const seasonHourly = ctx.acctBudgets.reduce((s, b) => s + b.hourlyBudget, 0);
  console.log(`${acct.padEnd(14)}  ${String(envSum).padStart(12)}   ${String(seasonHourly).padStart(13)}   ${String(envSum - seasonHourly).padStart(4)}`);
}

// PART 1.6: daily rate table per account P4-P10
console.log("\n═══ Daily rate by period (tool math), P4-P10 ═══\n");
console.log("acct            period   hourlyBudget   working_days_in_period   dailyRate");
for (const acct of MLB) {
  const ctx = computeLaborContext(acct);
  const seen = new Set();
  for (const b of ctx.acctBudgets.sort((a, b) => a.period.localeCompare(b.period))) {
    const wd = ctx.workingDaysPerPeriod[b.period] || 0;
    const rate = ctx.dailyRates[b.period] || 0;
    console.log(
      `${acct.padEnd(14)}  ${b.period.padEnd(6)}   ${String(b.hourlyBudget).padStart(12)}   ${String(wd).padStart(22)}   ${rate.toFixed(4).padStart(9)}`
    );
    seen.add(b.period);
  }
  console.log("");
}

// PART 1.5 alt (self-consistency using game-derived spans as both divisor and multiplier)
console.log("\n═══ Self-consistency (game-derived spans as both divisor + multiplier) ═══\n");
for (const acct of MLB) {
  const gameRows = await fetchScGames(acct);
  const gameBlocks = deriveGameBlocks(gameRows);
  const acctBudgets = budgets.filter(b => b.account === acct);
  // total game-derived days per period (each day counted once, if inside period)
  const gameDaysPerPeriod = {};
  for (const b of gameBlocks) {
    for (let d = new Date(b.first + "T00:00:00"); d <= new Date(b.last + "T00:00:00"); d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const p = getPeriodForDate(iso);
      if (p) gameDaysPerPeriod[p] = (gameDaysPerPeriod[p] || 0) + 1;
    }
  }
  const gameRates = {};
  for (const b of acctBudgets) {
    const wd = gameDaysPerPeriod[b.period] || 1;
    gameRates[b.period] = b.hourlyBudget / wd;
  }
  // sum envelope for each block
  let envSum = 0;
  for (const b of gameBlocks) {
    for (let d = new Date(b.first + "T00:00:00"); d <= new Date(b.last + "T00:00:00"); d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const p = getPeriodForDate(iso);
      if (p && gameRates[p]) envSum += gameRates[p];
    }
  }
  const seasonHourly = acctBudgets.reduce((s, b) => s + b.hourlyBudget, 0);
  console.log(`${acct.padEnd(14)}  game_env_sum=${envSum.toFixed(2).padStart(10)}   season_hourly=${String(seasonHourly).padStart(6)}   diff=${(envSum - seasonHourly).toFixed(2)}`);
}

// ═══════════════════════════════════════════════════════════════
// PART 2 - TXR-TX-V labor_sold_revenue
// ═══════════════════════════════════════════════════════════════
console.log("\n\n═══ TXR-TX-V labor_sold_revenue ═══\n");
const soldRes = await readSheetSA(SHEET_IDS.COLLECTION, "labor_sold_revenue");
console.log(`headers: ${JSON.stringify(soldRes.headers)}`);
console.log(`total rows: ${soldRes.rows.length}`);
const txrRows = soldRes.rows
  .filter(r => String(r[0] || "").trim() === "TXR - TX - V");
console.log(`TXR-TX-V rows: ${txrRows.length}`);
if (txrRows.length) {
  console.log("\naccount         hsId   soldRevenue   enteredBy                       enteredAt");
  for (const r of txrRows) {
    console.log(
      `${String(r[0]).padEnd(14)}  ${String(r[1]||"").padEnd(5)}  ${String(r[2]||"").padStart(11)}   ${String(r[3]||"").padEnd(30)}  ${String(r[4]||"")}`
    );
  }
  // duplicates
  const perHs = new Map();
  for (const r of txrRows) {
    const hs = String(r[1] || "");
    perHs.set(hs, (perHs.get(hs) || 0) + 1);
  }
  const dupes = [...perHs.entries()].filter(([, c]) => c > 1);
  console.log(`\nhs with >1 rows: ${dupes.length}${dupes.length ? " -> " + dupes.map(([k, c]) => `${k}(${c})`).join(", ") : ""}`);
}

// ═══════════════════════════════════════════════════════════════
// PART 3 - accounts + fee_schedule PG
// ═══════════════════════════════════════════════════════════════
console.log("\n\n═══ sc_fee_schedule (MLB accounts) ═══\n");
const { data: feeRows, error: feeErr } = await supa
  .from("sc_fee_schedule")
  .select("*")
  .in("account_key", MLB)
  .order("account_key")
  .order("effective_date", { ascending: false });
if (feeErr) console.error(feeErr.message);
else {
  console.log(`rows: ${feeRows.length}`);
  if (feeRows.length) console.log(`cols: ${Object.keys(feeRows[0]).join(", ")}\n`);
  for (const r of feeRows) {
    console.log(`  ${r.account_key.padEnd(14)}  amount=${r.amount}  effective=${r.effective_date}  cadence=${r.payment_cadence || ""}  covered_by=${r.covered_by_account_key || "(null)"}  reason="${r.reason.slice(0, 50)}"`);
  }
}

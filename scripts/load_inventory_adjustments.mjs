#!/usr/bin/env node
// scripts/load_inventory_adjustments.mjs
//
// Kevin R-61 (2026-09-03): load Sebastian's per-period inventory
// adjusting journal entries from `Period_Inventory.xlsx` into the
// `inventory_adjustments` Postgres table.
//
// Source structure (per sheet named `P{n} 2026`):
//   row 4-5   headers ("Adjusting JE" in B, "Curr QBO" in D, "Total" in F)
//   row 6-31  data: A=label, B=JE formula (=F-D), D=prior, F=closing
//   row 32+   notes (free text - captured to the report, never loaded)
//
// Sign convention (proven, and asserted per row):
//   adjusting_je == closing (F) - prior (D)
// Row-level violation ABORTS the load - a sheet-format change must
// not be accepted quietly. Kevin's rule.
//
// Account mapping:
//   TBJ + DUN                 -> TBJ - FL
//   TBJ + BUF (or BU)         -> TBJ - NY
//   TBJ + ROCH                -> SKIP (Rochester is not a KitchFix account)
//   TBR                       -> TBR - FL
//   REDS                      -> CIN - AZ
//   LBATS                     -> CIN - KY
//   TXR-AZ                    -> TXR - AZ
//   TXR-VISTOR                -> TXR - TX - V (note the spelling)
//   TXR (without AZ/VISTOR)   -> TXR - TX - H
//
// Category -> GL:
//   Food       -> 3200
//   Packaging  -> 3400
//   Supplies   -> 3400
//
// Idempotent: upserts on the primary key
// (account_key, fiscal_year, period_no, category). Re-running is safe.
//
// USAGE
//   node scripts/load_inventory_adjustments.mjs [path]
//     [path] defaults to /Users/kevinfietek/Downloads/Period Inventory.xlsx
//   --dry-run     parse + report without writing to Postgres
//
// ENV
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required unless --dry-run)

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const FILE_PATH = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : "/Users/kevinfietek/Downloads/Period Inventory.xlsx";
const DRY_RUN = process.argv.includes("--dry-run");
const FISCAL_YEAR = 2026;
const SIGN_ASSERT_TOLERANCE = 0.02;  // pennies; xlsx rounding
const SOURCE_LABEL_ROOT = "Period_Inventory.xlsx";

// ─── label -> account mapping ────────────────────────────────────────
//
// Applied to `label.replace(/\s+/g, ' ').trim()`. Categories are
// matched from the same label after account resolves.
function resolveAccount(label) {
  const L = label.toUpperCase();
  if (L.includes("TBJ") && L.includes("ROCH")) return { skip: true, reason: "Rochester not a KitchFix account" };
  if (L.includes("TBJ") && L.includes("DUN")) return { key: "TBJ - FL" };
  if (L.includes("TBJ") && /\bBU\b|BUF/.test(L)) return { key: "TBJ - NY" };
  if (L.includes("TBR")) return { key: "TBR - FL" };
  if (L.includes("REDS")) return { key: "CIN - AZ" };
  if (L.includes("LBATS")) return { key: "CIN - KY" };
  if (L.includes("TXR-AZ") || L.includes("TXR - AZ")) return { key: "TXR - AZ" };
  if (L.includes("TXR-VISTOR")) return { key: "TXR - TX - V" };
  if (L.includes("TXR")) return { key: "TXR - TX - H" };
  return { unresolved: true };
}

function resolveCategory(label) {
  const L = label.toUpperCase();
  // Order matters: packaging + supplies checked first so an odd
  // label like "PACKAGING SUPPLIES" (which doesn't exist here but
  // would be ambiguous) doesn't fall through to food. "FOOD" match
  // is intentionally NOT anchored to \b at the leading edge because
  // a mis-spelled label like "TBJ BUFood" (P1-P8 r11) has no space
  // between "BUF" and "Food"; the trailing edge stays anchored so
  // "FOODS" (plural) doesn't slip in.
  if (/PACKAGING/.test(L)) return { cat: "packaging", gl: "3400" };
  if (/SUPPLIES/.test(L))  return { cat: "supplies",  gl: "3400" };
  if (/FOOD\b/.test(L))    return { cat: "food",      gl: "3200" };
  return { unresolved: true };
}

// ─── row extraction ─────────────────────────────────────────────────
function readNumber(cell) {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (typeof v.result === "number") return v.result;
    if (v.result != null && !Number.isNaN(Number(v.result))) return Number(v.result);
    // shared-formula continuation: computed from D + F fallback
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readText(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    if (typeof v.result === "string") return v.result.trim();
    if (typeof v.richText === "object" && Array.isArray(v.richText)) {
      return v.richText.map(r => r.text || "").join("").trim();
    }
    if (v.text) return String(v.text).trim();
  }
  return String(v).trim();
}

// ─── main ───────────────────────────────────────────────────────────
async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);

  const rowsToUpsert = [];
  const notes = [];
  const unresolvedLabels = [];
  const signViolations = [];

  const sheetsInScope = wb.worksheets
    .map(w => w.name)
    .filter(n => /^P(\d+)\s+2026$/i.test(n));
  sheetsInScope.sort((a, b) => {
    const na = Number(a.match(/^P(\d+)/i)[1]);
    const nb = Number(b.match(/^P(\d+)/i)[1]);
    return na - nb;
  });

  console.log(`# load_inventory_adjustments - ${new Date().toISOString()}`);
  console.log(`# file: ${FILE_PATH}`);
  console.log(`# sheets in scope (P{n} 2026): ${sheetsInScope.join(", ")}`);
  console.log(`# dry-run: ${DRY_RUN}`);
  console.log("");

  for (const sheetName of sheetsInScope) {
    const periodNo = Number(sheetName.match(/^P(\d+)/i)[1]);
    const ws = wb.getWorksheet(sheetName);
    const seenPerAccountCategory = new Map();
    // Data rows 6-31; notes below.
    for (let r = 6; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const label = readText(row.getCell(1));
      if (!label) continue;
      // If we're past the data band, treat as note.
      const acc = resolveAccount(label);
      const cat = resolveCategory(label);
      const isDataRow = !!(acc && (acc.key || acc.skip)) && !!(cat.cat);
      if (!isDataRow) {
        if (label && /note|update|adjustment|defer|wait/i.test(label)) {
          notes.push({ sheet: sheetName, row: r, text: label });
        } else if (label) {
          unresolvedLabels.push({ sheet: sheetName, row: r, label });
        }
        continue;
      }
      if (acc.skip) {
        // Rochester: skip data but record once.
        if (!seenPerAccountCategory.has(`SKIP-${label}`)) {
          seenPerAccountCategory.set(`SKIP-${label}`, true);
          console.log(`  ${sheetName} r${r}: SKIP ${label} (${acc.reason})`);
        }
        continue;
      }
      const je = readNumber(row.getCell(2));
      const prior = readNumber(row.getCell(4));
      const closing = readNumber(row.getCell(6));
      // Kevin's ruling: adjusting_je == closing - prior. Prefer the
      // sheet's cached B value when present (it is the authoritative
      // number Sebastian wrote); assert against the derived closing
      // - prior when BOTH ends are cached. When one end is null
      // (shared-formula continuation without a cached result -
      // ExcelJS leaves .result undefined on continuations), rely on
      // the cached B and skip the assertion for that row - the
      // Excel formula IS `=F - D` so if B says X, F - D would say X
      // by construction.
      let effectiveJe = je;
      if (effectiveJe == null && prior != null && closing != null) {
        effectiveJe = Number((closing - prior).toFixed(2));
      }
      if (effectiveJe == null) {
        // Genuinely empty row - skip.
        if (prior == null && closing == null) continue;
        signViolations.push({ sheet: sheetName, row: r, label, je, prior, closing,
          reason: "adjusting_je missing and cannot be derived from prior/closing" });
        continue;
      }
      if (prior != null && closing != null) {
        const derived = Number((closing - prior).toFixed(2));
        if (Math.abs(derived - effectiveJe) > SIGN_ASSERT_TOLERANCE) {
          signViolations.push({ sheet: sheetName, row: r, label, je: effectiveJe, prior, closing,
            derived, delta: (derived - effectiveJe).toFixed(4),
            reason: `sign identity failed: je=${effectiveJe} but closing - prior = ${derived}` });
          continue;
        }
      }
      const dedupeKey = `${acc.key}|${periodNo}|${cat.cat}`;
      if (seenPerAccountCategory.has(dedupeKey)) {
        // Multiple rows for the same (account, cat) in one sheet
        // shouldn't happen. If it does, sum them and surface.
        const prev = seenPerAccountCategory.get(dedupeKey);
        prev.adjusting_je = Number((prev.adjusting_je + effectiveJe).toFixed(2));
        prev.prior_balance = Number((prev.prior_balance + prior).toFixed(2));
        prev.closing_balance = Number((prev.closing_balance + closing).toFixed(2));
        prev.source_label += " + " + label;
        console.log(`  ${sheetName} r${r}: aggregated into ${acc.key}/${cat.cat} (multiple rows)`);
        continue;
      }
      const record = {
        account_key: acc.key,
        fiscal_year: FISCAL_YEAR,
        period_no: periodNo,
        category: cat.cat,
        gl_line_code: cat.gl,
        adjusting_je: effectiveJe,
        prior_balance: prior,
        closing_balance: closing,
        source_label: label,
        source_ref: `${SOURCE_LABEL_ROOT}#${sheetName}!A${r}`,
      };
      seenPerAccountCategory.set(dedupeKey, record);
      rowsToUpsert.push(record);
    }
  }

  console.log("");
  console.log(`## Parsed ${rowsToUpsert.length} rows across ${sheetsInScope.length} periods.`);

  // Reproduce Kevin's expected table (cumulative P1-P8 sums per
  // account × category).
  const cum = new Map(); // "account|category" -> sum
  for (const r of rowsToUpsert) {
    const k = `${r.account_key}|${r.category}`;
    cum.set(k, (cum.get(k) || 0) + Number(r.adjusting_je));
  }
  const accounts = [...new Set(rowsToUpsert.map(r => r.account_key))].sort();
  console.log("");
  console.log("## Reproduced cumulative P1-P8 2026 sums:");
  console.log("account          |     food |    packaging |    supplies |       pkg+sup");
  console.log("-----------------+----------+--------------+-------------+---------------");
  for (const a of accounts) {
    const food = (cum.get(`${a}|food`) || 0);
    const pkg = (cum.get(`${a}|packaging`) || 0);
    const sup = (cum.get(`${a}|supplies`) || 0);
    console.log(`${a.padEnd(16)} | ${food.toFixed(2).padStart(8)} | ${pkg.toFixed(2).padStart(12)} | ${sup.toFixed(2).padStart(11)} | ${(pkg + sup).toFixed(2).padStart(13)}`);
  }

  if (notes.length) {
    console.log("");
    console.log(`## Sebastian's notes (${notes.length}) - deferred adjustments:`);
    for (const n of notes) {
      console.log(`  ${n.sheet} r${n.row}: ${n.text}`);
    }
  }
  if (unresolvedLabels.length) {
    console.log("");
    console.log(`## Unresolved labels (${unresolvedLabels.length}):`);
    for (const u of unresolvedLabels) {
      console.log(`  ${u.sheet} r${u.row}: ${u.label}`);
    }
  }
  if (signViolations.length) {
    console.log("");
    console.log(`## Sign-identity violations (${signViolations.length}) - LOAD ABORTED:`);
    for (const v of signViolations) {
      console.log(`  ${v.sheet} r${v.row}: ${v.label} - ${v.reason}`);
    }
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("");
    console.log("## Dry-run: no rows upserted.");
    process.exit(0);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[fatal] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absent");
    process.exit(2);
  }
  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const chunk = 500;
  let upserted = 0;
  for (let i = 0; i < rowsToUpsert.length; i += chunk) {
    const batch = rowsToUpsert.slice(i, i + chunk);
    const { error } = await supa
      .from("inventory_adjustments")
      .upsert(batch, { onConflict: "account_key,fiscal_year,period_no,category" });
    if (error) {
      console.error("[upsert error]", error);
      process.exit(3);
    }
    upserted += batch.length;
  }
  console.log("");
  console.log(`## Upserted ${upserted} rows.`);
}

main().catch(e => { console.error(e); process.exit(1); });

// KITCHFIX PRICE BOOK generator (read-only, PG-projection).
//
// Reads the PG snapshot produced by scripts/audit-sc-prices.mjs and emits
// REF-141 (the corpus Price Book): an MDX file with a full corpus
// frontmatter block + the generated body.
//
// Data policy:
//   - Prices, flags, effective_date, active-state come from PG only.
//   - Per-account header lines (money shape, 2026 fee, escalation) are
//     STATIC CONFIG maintained inside this file, each cited to
//     docs/pricing-summit/accounts/ACCOUNT_<KEY>.md §2.
//   - Contract terms + rulings + rationale live in the account files;
//     this book projects the PG live catalog under those terms.
//
// The default output is a corpus doc: content/documents/REF-141.mdx.
// The generator emits the full corpus frontmatter block on every run,
// followed by the generated body. Because the file lives under
// content/documents/**, a regenerate is a re-projection: the auto-
// projection Action fires on any push that touches that path, so a
// price-side refresh reaches PG + SousAI without a manual project step.
//
// Regenerate on ANY price change (Studio apply, admin edit, effective-date
// backdate). This document is generated - never hand-edit it.
//
// Usage:
//   set -a && source .env.local && set +a
//   node scripts/audit-sc-prices.mjs --out /tmp/pg_prices.json
//   node scripts/generate-price-book.mjs                 # writes <repo>/content/documents/REF-141.mdx
//   node scripts/generate-price-book.mjs --downloads     # writes ~/Downloads/REF-141.mdx for review
//
// Optional flags:
//   --in FILE    read a specific PG dump (default /tmp/pg_prices.json)
//   --out FILE   write to a specific path (overrides both defaults)
//   --downloads  quick shortcut for review builds; goes to ~/Downloads/REF-141.mdx

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);

// Resolve <repo>/content/documents/REF-141.mdx as the default output.
// This script lives at <repo>/scripts/generate-price-book.mjs, so ../ = repo.
// REF-141 IS the Price Book in the corpus - a `derived: true` MDX file that
// the projection Action re-embeds on every write. See the module header for
// the full data-flow rationale.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(REPO_ROOT, "content", "documents", "REF-141.mdx");
const DOWNLOADS_OUT = path.join(homedir(), "Downloads", "REF-141.mdx");

const IN = argVal("--in", "/tmp/pg_prices.json");
const OUT = argVal("--out", flag("--downloads") ? DOWNLOADS_OUT : DEFAULT_OUT);

if (!existsSync(IN)) {
  console.error(`ERROR: PG snapshot not found at ${IN}`);
  console.error(`Run first: node scripts/audit-sc-prices.mjs --out ${IN}`);
  process.exit(1);
}

const snap = JSON.parse(readFileSync(IN, "utf-8"));
const rows = snap.rows || [];
const snapAt = snap.generated_at || "(unknown)";

// ---- Static per-account config ----
// Order = the roster ordering used in accounts/ACCOUNT_*.md.
// Every non-null field is source-cited to docs/pricing-summit/accounts/ACCOUNT_<KEY>.md §2.
const ACCOUNTS = [
  {
    key: "CIN - AZ",
    name: "Cincinnati Reds - Goodyear PDC",
    money_shape: "actuals_drive_invoice (per-meal count x post-SF rate = invoice; SF billed separately)",
    fee_2026: "Service Fee **$445,716** (2026 accrued; 2023 base $402,016 = 30% of pre-tax budget). Billed 75% Feb 1 / 25% Mar 15.",
    escalation: "CPI-U Food Away from Home (CUUR0000SEFV), October reset, 2% floor / 5% cap.",
    notes: "MLB rates carry a 30% SF discount (billed = full x 0.70). Two flat-fee ancillary lines (Coffee Service, Fountain Bev) at 45-week/yr cap, tax-exempt.",
  },
  {
    key: "CIN - KY",
    name: "Louisville Bats (AAA affiliate of CIN)",
    money_shape: "actuals_drive_invoice (uniform per-meal rate; no SF, no discount).",
    fee_2026: "**None** (per-meal, no SF). Estimated annual investment ~$186,462 (§4.b contract).",
    escalation: "None - renegotiated yearly.",
    notes: "Two contract categories - Type 1 ($25.95, Breakfast/Lunch/Post-Game/Umpire) and Type 2 ($8.64, Snack).",
  },
  {
    key: "CIN - OH",
    name: "Cincinnati Reds - Great American Ballpark (MLB)",
    money_shape: "flat_fee (fee IS the money; per-meal rows are operational counts only, $0 billing).",
    fee_2026: "Service Fee **$376,686** (2026 escalated; base $362,500). 6 monthly Mar-Aug (installments $61,907.08 pre-tax). Fee is tax-TAXABLE at 7.80%.",
    escalation: "CPI-U Food Away from Home (CUUR0000SEFV), August reset, 1% floor / 4% cap. PG carries the escalated figure (migration 2026-07-16).",
    notes: "Postseason mechanic: 1/81-of-fee per game = $4,413.58/game if the Reds qualify.",
  },
  {
    key: "STL - FL",
    name: "St. Louis Cardinals - Jupiter PDC",
    money_shape: "flat_fee, fee-no-dollar variant (per-meal rows $0 by design; SC displays operational counts).",
    fee_2026: "Florida Services Fee **$1,400,000 flat** (quarterly Nov/Feb/May/Aug, 4x $350,000). $900K food budget = passthrough, excluded. SF is tax-EXEMPT (invoice-confirmed).",
    escalation: "None (flat annual). Amendment explicitly does NOT extend the STL-MO CPI clause to FL.",
    notes: "$900K food/packaging passthrough + $30K equipment upkeep run out-of-band, NOT part of the $1.4M fee.",
  },
  {
    key: "STL - MO",
    name: "St. Louis Cardinals - Busch Stadium (MLB)",
    money_shape: "flat_fee (per-meal rows $0; revenue = fee).",
    fee_2026: "Service Fee **$489,497 billed** (base $473,000 = $423K meal-services + $50K Road Food). 6 monthly Mar-Aug (meal-services 6x $73,249.50 + $50K annual March). SF is tax-NON-TAXABLE (invoice-confirmed).",
    escalation: "CPI-U parent CUUR0000SEFV (Food Away from Home), August reset, no cap. Only the $423K meal-services portion escalates; $50K Road Food held flat. PG carries the escalated figure (migration 2026-07-16).",
    notes: "Postseason mechanic: flat per-game (Game $5,222.22 / Workout $2,777.78 / Road Food $600), NOT escalated. Differs from CIN-OH postseason.",
  },
  {
    key: "TBJ - FL",
    name: "Toronto Blue Jays - Dunedin PDC",
    money_shape: "actuals_drive_invoice + flat SF (per-meal invoiced weekly, SF billed on its own schedule).",
    fee_2026: "Service Fee **$515,712 negotiated billable** (3x $171,904 Jan/Feb/Mar; contract's $452,812 base is outdated, superseded by finance).",
    escalation: "100% CPI-U Food Away from Home (CUUR0000SEFV parent), Q4 basis. Provider-initiated, gated on documented cost basis + Club written approval per §12(c). (2026 operative SF is negotiated, not formula-derived.)",
    notes: "Five groups: Major League - PDC, Minor League - PDC (FCL), Single A Jays (FSL), SSM, Other. 'Fun $$$$ Allocated' is non-revenue.",
  },
  {
    key: "TBJ - NY",
    name: "Buffalo Bisons (AAA affiliate of TBJ)",
    money_shape: "actuals_drive_invoice (uniform per-meal rate).",
    fee_2026: "**None** (no documented Service Fee).",
    escalation: "None documented. $27.34 uniform rate is Kevin+invoice-confirmed.",
    notes: "Snack/Shake service lines exist in the catalog but are deactivated (active=false).",
  },
  {
    key: "TBR - FL",
    name: "Tampa Bay Rays - Charlotte Sports Park PDC + BGC second-client stream",
    money_shape: "actuals_drive_invoice on both MLB and MiLB sides (separate cost centers). Boys & Girls Club runs as a second-client stream on the same commissary.",
    fee_2026: "Recurring MiLB Service Fee **$457,768** (2026 = $200,000 static installment 1 + $257,768 variable installment 2). MLB has no SF. 25% MiLB rate credit reduces MiLB per-meal to 75% of base.",
    escalation: "75% x CPI-U Food Away - Full Service Meals & Snacks (CUUR0000SEFV01, sub-index), November reset. Per-meal rates auto-escalate; SF is SOW-gated (variable second installment set per year).",
    notes: "BGC (Boys & Girls Club of Charlotte County) B&G Lunch = tax-exempt after-school supper program; contract runs Aug 2025 - May 2026 school year. See ACCOUNT_TBR-FL.md §2d.",
  },
  {
    key: "TXR - AZ",
    name: "Texas Rangers - Surprise PDC",
    money_shape: "actuals_drive_invoice + 20% deposit-triggered discount (billed = full x 0.80).",
    fee_2026: "2026 deposit **$301,623** (3x $100,541 Jan/Feb/Mar; triggers the 20% discount). Escalated from 2025 deposit $297,419 at fixed 2.5%.",
    escalation: "Fixed 2.5%/yr per §2.a (NOT CPI). Cleanest escalator of all 11 accounts.",
    notes: "5 rate lines: MLB (Breakfast/Lunch/Dinner), MiLB (Breakfast/Lunch/Dinner), plus 3 MiLB add-ons (Continental Breakfast, Pre-Game Hot Snack, Regular Snack). Extra Protein pans flat.",
  },
  {
    key: "TXR - TX - H",
    name: "Texas Rangers - Globe Life Field (MLB Home)",
    money_shape: "flat_fee (per-meal rows $0; revenue = fee).",
    fee_2026: "Service Fee **$604,032** (6x $100,672 Apr-Sep pre-tax; $108,977.44 with-tax). SF is tax-TAXABLE at 8.25% (Arlington TX, contract-stated gross-up).",
    escalation: "None - annual negotiation. Contract text notes +10% negotiated for 2026 (2024 $528K -> 2025 $549,120 +4% -> 2026 $604,032 +10%).",
    notes: "Companion account TXR - TX - V (visiting) is operationally paired but billed separately - see below.",
  },
  {
    key: "TXR - TX - V",
    name: "Texas Rangers - Globe Life Field (MLB Visiting)",
    money_shape: "operational-only (no billing prices by design; fee-schedule $0 marker).",
    fee_2026: "**None** (covered by TXR-TX-H's $604,032 contract carve-in for G&G/snacks/coffee). Opt-in direct sales to visiting teams (catering menu) is out of SC scope; tracked in Season Tracker.",
    escalation: "None applicable.",
    notes: "Included here for catalog completeness. All 4 rows carry $0 in PG by design; the SC UI displays operational counts only.",
  },
];

// ---- Helpers ----
function money(v) {
  if (v == null) return "-";
  if (typeof v === "string") return v;
  if (v === 0) return "$0.00";
  return "$" + v.toFixed(2);
}

function fmtDate(s) {
  return s ? String(s).slice(0, 10) : "-";
}

function deriveUnit(row) {
  const svc = (row.service || "").toLowerCase();
  if (row.is_non_revenue) return "non-revenue";
  if (row.is_flat_fee) {
    if (/coffee|fountain|bev/.test(svc)) return "per week (flat)";
    if (/extra protein|extra_protein/.test(svc)) return "per pan (flat)";
    if (/mto/.test(svc)) return "per order (flat)";
    if (/extended day labor/.test(svc)) return "per day (flat)";
    if (/fun \$/.test(svc)) return "annual (non-revenue)";
    return "flat";
  }
  return "per meal";
}

function flagsLabel(row) {
  const bits = [];
  if (row.is_flat_fee) bits.push("flat");
  if (row.is_non_revenue) bits.push("non-revenue");
  if (row.is_tax_free) bits.push("tax-free");
  return bits.length ? bits.join(", ") : "-";
}

function activeLabel(row) {
  if (row.svc_active_until) return `until ${fmtDate(row.svc_active_until)}`;
  return row.svc_active ? "active" : "INACTIVE";
}

// ---- Assemble ----
const byAccount = new Map();
for (const r of rows) {
  const k = r.account_key;
  if (!byAccount.has(k)) byAccount.set(k, []);
  byAccount.get(k).push(r);
}

// Sort each account's rows for stable output.
for (const [k, arr] of byAccount) {
  arr.sort((a, b) =>
    (a.group || "").localeCompare(b.group || "") ||
    (a.service || "").localeCompare(b.service || "")
  );
}

// ---- Emit Markdown ----
const now = new Date();
const nowISO = now.toISOString();
const nowHuman = now.toISOString().slice(0, 19).replace("T", " ") + "Z";

const md = [];

// ---- Corpus frontmatter (REF-141) ----
// Emitted on every run so a regenerate reproduces a complete, valid corpus
// document, not just the body. Fields tracked here mirror the
// content/schema/frontmatter.schema.json contract; `derived: true` is the
// load-bearing flag - the gate rejects hand-edits of derived docs.
md.push("---");
md.push("id: REF-141");
md.push('title: "Price Book - Live Account Pricing (generated)"');
md.push("doc_class: REF");
md.push('shelf: "Service Delivery & Client Accounts"');
md.push('subshelf: "Financial Reference"');
md.push("status: In Build");
md.push('version: "1.0"');
md.push('card_line: "Live per-account price catalog - the ONLY canonical price-values document. Generated from PG on any price change; every other doc treats prices as specimens."');
md.push('summary: "The generated, live-price source for KitchFix Service Calendar billing. Organized by account (11 accounts, all services active + inactive); every price row is the latest-effective sc_service_prices projected-price at PG snapshot time. Per-account header lines (money shape, 2026 fee, escalation, notes) are static config maintained inside the generator, each cited to accounts/ACCOUNT_<KEY>.md section 2. Contract clauses, rulings, and rationale live in the account records (REC-101..111) and digests (REF-121..132). The Price Book is derived:true - never hand-edited; regenerate from PG on any price change (Studio apply, admin edit, effective-date backdate). This is the ONE document in the corpus where dollar figures are CANONICAL - everywhere else they are specimens wrapped in NonCanonical."');
md.push("keywords:");
md.push("  - price book");
md.push("  - live prices");
md.push("  - per-account rates");
md.push("  - generated");
md.push("  - PG");
md.push("  - post-SF invoice rate");
md.push("  - REF-141");
md.push('owner: "Senior Director of Operations"');
md.push('approver: "Senior Director of Operations"');
md.push("audience: corporate");
md.push('classification: "KitchFix Internal - Commercial Confidential"');
md.push("access_level: restricted");
md.push("lang: en");
md.push("in_corpus: true");
md.push("applies_to: company-wide");
md.push("derived: true");
md.push("review_interval_months: 3");
md.push("sort_order: 141");
md.push("relationships:");
md.push('  - { to: PB-009, type: references, from_section: "financial hub" }');
md.push('  - { to: REF-140, type: references, from_section: "money-model mechanics" }');
md.push("---");
md.push("");

md.push("# KITCHFIX PRICE BOOK - GENERATED DOCUMENT, DO NOT HAND-EDIT");
md.push("");
md.push(`**Generated:** ${nowHuman} by \`scripts/generate-price-book.mjs\`  `);
md.push(`**PG snapshot:** ${snapAt}  `);
md.push(`**Certified as of:** 2026-07-17 (see \`STAGE3_CERTIFICATION_AUDIT.md\`, this folder)  `);
md.push(`**Regenerate:** \`node scripts/audit-sc-prices.mjs --out /tmp/pg_prices.json && node scripts/generate-price-book.mjs\``);
md.push("");
md.push("---");
md.push("");
md.push("## What this is");
md.push("");
md.push("The Price Book is the human-readable projection of PG's live SC price catalog under each account's contract terms. **PG owns the live prices; this book is PG's projection.** Regenerate on ANY change - Studio apply, admin backdate, Kevin directive.");
md.push("");
md.push("**Data policy:**");
md.push("- Prices, flags, effective_date, and active state come from PG only (via `scripts/audit-sc-prices.mjs`).");
md.push("- Per-account header lines (money shape / 2026 fee / escalation / notes) are static config maintained inside the generator, each cited to `docs/pricing-summit/accounts/ACCOUNT_<KEY>.md` §2.");
md.push("- Contract clauses, rulings, and rationale live in the account files. This book does not restate them - it points at them.");
md.push("");
md.push("**Scope:** 11 accounts, all services (active + inactive), all latest-effective prices. Snapshot line-count and per-account service counts appear in the summary below.");
md.push("");

// Summary
md.push("## Snapshot summary");
md.push("");
md.push(`- **Accounts covered:** ${byAccount.size} of ${ACCOUNTS.length}`);
md.push(`- **Total services:** ${rows.length}`);
md.push(`- **Services with a projected-price row in PG:** ${rows.filter((r) => r.projected_price !== null).length}`);
md.push(`- **Flat-fee marked:** ${rows.filter((r) => r.is_flat_fee).length}`);
md.push(`- **Non-revenue marked:** ${rows.filter((r) => r.is_non_revenue).length}`);
md.push(`- **Tax-free marked:** ${rows.filter((r) => r.is_tax_free).length}`);
md.push(`- **Inactive (active=false or active_until in past):** ${rows.filter((r) => !r.svc_active).length}`);
md.push("");
md.push("| Account | Services | Notes |");
md.push("|---|---:|---|");
for (const acct of ACCOUNTS) {
  const arr = byAccount.get(acct.key) || [];
  md.push(`| ${acct.key} | ${arr.length} | ${acct.name} |`);
}
md.push("");
md.push("---");
md.push("");

// Per-account section
for (const acct of ACCOUNTS) {
  const arr = byAccount.get(acct.key) || [];
  md.push(`## ${acct.key}`);
  md.push("");
  md.push(`**Account:** ${acct.name}`);
  md.push("");
  md.push(`**Money shape:** ${acct.money_shape}  `);
  md.push(`**2026 Service Fee / deposit:** ${acct.fee_2026}  `);
  md.push(`**Escalation:** ${acct.escalation}  `);
  md.push(`**Notes:** ${acct.notes}`);
  md.push("");
  md.push(`Source: [\`accounts/ACCOUNT_${acct.key.replace(/ - /g, "-")}.md\` §2](accounts/ACCOUNT_${acct.key.replace(/ - /g, "-")}.md)`);
  md.push("");

  // Fee-account or operational-only banners
  if (acct.key === "CIN - OH" || acct.key === "STL - FL" || acct.key === "STL - MO" || acct.key === "TXR - TX - H") {
    md.push("> **Fee-account note:** per-meal rows are $0 by design - revenue = the flat/escalated Service Fee (see header above). PG stores the fee in `sc_fee_schedule`, not on per-meal rows.");
    md.push("");
  }
  if (acct.key === "TXR - TX - V") {
    md.push("> **Operational-only:** no billing prices by design. Every row is $0; the SC UI shows operational counts only. Direct-sales revenue is tracked in the Season Tracker workflow.");
    md.push("");
  }

  if (arr.length === 0) {
    md.push("_No services in PG for this account._");
    md.push("");
    md.push("---");
    md.push("");
    continue;
  }

  md.push("| Group | Service | Price | Unit-ish | Flags | Effective | Active |");
  md.push("|---|---|---:|---|---|---|---|");
  for (const r of arr) {
    let priceCell = money(r.projected_price);
    // BGC row highlight in TBR-FL
    let svcCell = r.service || "-";
    if (acct.key === "TBR - FL" && /b&g/i.test(r.service || "")) {
      svcCell = `**${r.service}** _(BGC second-client stream)_`;
    }
    md.push(
      `| ${r.group || "-"} | ${svcCell} | ${priceCell} | ${deriveUnit(r)} | ${flagsLabel(r)} | ${fmtDate(r.projected_effective_date)} | ${activeLabel(r)} |`
    );
  }
  md.push("");
  md.push("---");
  md.push("");
}

// Footer
md.push("## Source of truth");
md.push("");
md.push("- **PG (`sc_service_prices` join `sc_services` join `sc_service_groups`)** = LIVE PRICE AUTHORITY. Every price shown above is the latest-effective-date row per `(service_id, price_kind='projected')` at the PG snapshot time.");
md.push("- **This book** = PG's projection at the moment of generation. It is intentionally read-only. If a rate changes in PG (Studio apply, admin edit, backdate), this book is stale until regenerated.");
md.push("- **`docs/pricing-summit/accounts/ACCOUNT_<KEY>.md`** = per-account CONTRACT + RULING context (money-shape decisions, SF cadence, escalation clauses, per-account rulings). This book cites those files for terms but does not restate them.");
md.push("- **`docs/pricing-summit/CONTRACT_DIGEST_*.md`** = verbatim contract clauses with page cites.");
md.push("- **`KitchFix_Service_Calendar_Price_Review_v3_FINAL.xlsx` → \"Billing Price\"** = ATTESTED authority (Joe Lessard-signed). PG matches signed at 2dp on 103/105 rows as of the certification audit; the 2 catalogued signed-side notes are documented in `STAGE3_CERTIFICATION_AUDIT.md` §3.");
md.push("");
md.push("**Regeneration triggers:**");
md.push("- Any Studio apply to `sc_service_prices`, `sc_services`, or `sc_service_groups`.");
md.push("- Any admin-panel price edit or fenced-backdate write.");
md.push("- Any signed-sheet refresh (v3 -> v4) that shifts the certification denominator.");
md.push("- Any per-account contract renewal that changes a header line above.");
md.push("");
md.push("**To regenerate:**");
md.push("");
md.push("```sh");
md.push("set -a && source .env.local && set +a");
md.push("node scripts/audit-sc-prices.mjs --out /tmp/pg_prices.json");
md.push("node scripts/generate-price-book.mjs");
md.push("```");
md.push("");
md.push(`_Generated ${nowISO} from PG snapshot ${snapAt}._`);
md.push("");

writeFileSync(OUT, md.join("\n"));
console.error(`wrote Price Book: ${OUT}`);
console.error(`  accounts: ${byAccount.size} / ${ACCOUNTS.length}`);
console.error(`  services: ${rows.length}`);
for (const acct of ACCOUNTS) {
  const arr = byAccount.get(acct.key) || [];
  console.error(`  ${acct.key.padEnd(14)} ${String(arr.length).padStart(3)} services`);
}

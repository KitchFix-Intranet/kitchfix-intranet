#!/usr/bin/env node
// Guard 3 · 32 Overview + Labor payload capture.
//
// Purchasing reskin prompt § THE GUARDS · Guard 3:
//   Overview  2 accounts × 4 ranges × 2 toggle states = 16
//   Labor     2 accounts × 4 ranges × 2 toggle states = 16
// Both sets must be byte-identical after the reskin work.
//
// Usage:
//   node scripts/probes/_probe_guard3_payloads.mjs BEFORE   # write baseline
//   node scripts/probes/_probe_guard3_payloads.mjs AFTER    # write current
//   node scripts/probes/_probe_guard3_payloads.mjs DIFF     # summarize BEFORE vs AFTER
//
// Output dir: /tmp/kf-guard3/{BEFORE,AFTER}/{board}_{account}_{range}_{toggle}.json

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const BASE = process.env.BASE || "http://localhost:3000";
const HEADER = { "x-test-user": "kevin@kitchfix.com" };
const OUT_ROOT = "/tmp/kf-guard3";

const ACCOUNTS = ["TBJ - FL", "TBR - FL"];
const RANGES = [
  { key: "cy", start: "2025-12-29", end: "2026-08-09" },  // R-93 FYTD end (P1..P8 closed today)
  { key: "lp", start: "2026-08-10", end: "2026-09-06" },  // P9
  { key: "cp", start: "2026-09-07", end: "2026-10-04" },  // P10 (today = 2026-09-14)
  { key: "np", start: "2026-10-05", end: "2026-11-01" },  // P11
];
const TOGGLES = ["hourly", "salary"];  // ?salary=1 vs default hourly

async function fetchJson(path) {
  const r = await fetch(`${BASE}${path}`, { headers: HEADER });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch (e) { return { status: r.status, body: { raw: t.slice(0, 2000) } }; }
}

function stripNoisy(payload) {
  // Payload contains freshness timestamps that shift every fetch;
  // strip them so byte-identical comparison is meaningful. Also
  // strip anything that walks the clock (elapsed_frac, elapsedFrac,
  // etc). PR does NOT ship if these are the only diffs; Guard 3 is
  // about the SHAPED figures.
  const clone = JSON.parse(JSON.stringify(payload));
  const strip = (o) => {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (
        /^(freshness|derive_freshness|last_(walk|report|report_ingest)_at|_generated_at|generated_at|elapsed_frac|elapsedFrac|fetched_at|generated_ts|_fetched_at|report_age_hours|report_ingest_age_hours)$/.test(k)
      ) {
        delete o[k];
        continue;
      }
      if (typeof o[k] === "object") strip(o[k]);
    }
  };
  strip(clone);
  return clone;
}

function sortedStringify(v) {
  // Deterministic JSON so the hash and diff are byte-stable across runs.
  const walk = (x) => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      return Object.keys(x).sort().reduce((acc, k) => { acc[k] = walk(x[k]); return acc; }, {});
    }
    return x;
  };
  return JSON.stringify(walk(v), null, 2);
}

async function capture(mode) {
  const outDir = path.join(OUT_ROOT, mode);
  await fs.mkdir(outDir, { recursive: true });

  const jobs = [];
  for (const board of ["overview", "labor"]) {
    for (const account of ACCOUNTS) {
      const enc = encodeURIComponent(account);
      for (const rng of RANGES) {
        for (const toggle of TOGGLES) {
          const qs = new URLSearchParams({ account, start: rng.start, end: rng.end });
          if (toggle === "salary") qs.set("include_salary", "1");
          const url = `/api/kpi/${board}?${qs.toString()}`;
          const key = `${board}_${account.replace(/[^a-z0-9]/gi, "_")}_${rng.key}_${toggle}`;
          jobs.push({ board, account, rng, toggle, url, key });
        }
      }
    }
  }

  console.log(`Capturing ${jobs.length} payloads to ${outDir}/`);
  let failed = 0;
  for (const j of jobs) {
    process.stdout.write(`  ${j.key}... `);
    const t0 = Date.now();
    const { status, body } = await fetchJson(j.url);
    const elapsed = Date.now() - t0;
    if (status !== 200) {
      failed++;
      console.log(`HTTP ${status} in ${elapsed}ms`);
      await fs.writeFile(path.join(outDir, `${j.key}.err.json`), JSON.stringify({ status, body }, null, 2));
      continue;
    }
    const stripped = stripNoisy(body);
    const stable = sortedStringify(stripped);
    const hash = crypto.createHash("sha256").update(stable).digest("hex").slice(0, 12);
    await fs.writeFile(path.join(outDir, `${j.key}.json`), stable);
    console.log(`ok · ${(stable.length / 1024).toFixed(1)}kb · ${hash} · ${elapsed}ms`);
  }
  console.log(failed === 0 ? "\nAll payloads captured." : `\n${failed} failed.`);
  return failed;
}

async function diff() {
  const before = path.join(OUT_ROOT, "BEFORE");
  const after = path.join(OUT_ROOT, "AFTER");
  const files = (await fs.readdir(before)).filter(f => f.endsWith(".json"));
  let mismatched = 0;
  let missing = 0;
  for (const f of files) {
    const b = await fs.readFile(path.join(before, f), "utf8").catch(() => null);
    const a = await fs.readFile(path.join(after, f), "utf8").catch(() => null);
    if (!a) { console.log(`MISSING: ${f}`); missing++; continue; }
    if (a === b) continue;
    mismatched++;
    // brief diff summary
    const bLines = b.split("\n").length;
    const aLines = a.split("\n").length;
    console.log(`DIFF: ${f} (before ${bLines}l, after ${aLines}l)`);
    // Print first differing line pair for orientation
    const bArr = b.split("\n"), aArr = a.split("\n");
    for (let i = 0; i < Math.min(bArr.length, aArr.length); i++) {
      if (bArr[i] !== aArr[i]) {
        console.log(`  line ${i}:`);
        console.log(`    before: ${bArr[i].slice(0, 180)}`);
        console.log(`    after:  ${aArr[i].slice(0, 180)}`);
        break;
      }
    }
  }
  console.log(`\n${files.length} files · ${mismatched} DIFF · ${missing} MISSING`);
  process.exit((mismatched + missing) === 0 ? 0 : 1);
}

const mode = (process.argv[2] || "").toUpperCase();
if (mode === "BEFORE" || mode === "AFTER") {
  const failed = await capture(mode);
  process.exit(failed === 0 ? 0 : 1);
} else if (mode === "DIFF") {
  await diff();
} else {
  console.error("usage: node scripts/probes/_probe_guard3_payloads.mjs {BEFORE|AFTER|DIFF}");
  process.exit(2);
}

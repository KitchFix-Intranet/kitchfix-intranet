#!/usr/bin/env node
// Static verification for the in-card People & Access admin panel.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DIRV   = "src/components/people/DirectoryView.js";
const PANEL  = "src/components/people/PeopleAccessAdmin.js";
const PCSS   = "src/app/people/people.css";
const API_D  = "src/app/api/directory/route.js";
const OLD_P  = "src/components/directory/DirectoryAdmin.js";
const OLD_PG = "src/app/directory/page.js";
const API_P  = "src/app/api/people/route.js";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dirv  = read(DIRV);
const panel = read(PANEL);
const pcss  = read(PCSS);
const apid  = read(API_D);

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); }

// 1. Gear opens in-card admin mode; no overlay/slide-over; no legacy nav or toast.
record(
  `${DIRV}: gear sets adminOpen=true`,
  /className="pp-dir-admin-btn"[\s\S]{0,200}onClick=\{\(\)\s*=>\s*setAdminOpen\(true\)\}/.test(dirv),
  "setAdminOpen wired"
);
record(
  `${DIRV}: admin mode replaces the directory body in place`,
  /if\s*\(\s*adminOpen\s*\)\s*\{[\s\S]{0,400}pp-dir-card--admin[\s\S]{0,200}<PeopleAccessAdmin/.test(dirv),
  "in-card swap present"
);
record(
  `${DIRV}: no legacy onNavigate("admin")`,
  !/onNavigate\(\s*["']admin["']\s*\)/.test(dirv),
  "no legacy nav"
);
record(
  `${DIRV}: no "Admin editing coming soon." placeholder`,
  !/Admin editing coming soon/.test(dirv),
  "placeholder gone"
);
record(
  `${PANEL}: no overlay / slide-over wrapper (no pp-access-overlay / pp-access-drawer)`,
  !/pp-access-overlay/.test(panel) && !/pp-access-drawer/.test(panel),
  "no modal wrapper"
);

// 2. Back-to-Directory control.
record(
  `${PANEL}: back-to-Directory control present (calls onClose)`,
  /pp-access-back[\s\S]{0,300}onClick=\{onClose\}/.test(panel) ||
  /onClick=\{onClose\}[\s\S]{0,200}pp-access-back/.test(panel) ||
  /<button[^>]*className="pp-access-back"[^>]*onClick=\{onClose\}/.test(panel),
  "back control wired"
);

// 3. Region / account grouping.
record(
  `${PANEL}: region groups render Corporate/East/West`,
  /REGION_LABEL\s*=\s*\{[\s\S]{0,200}CORP:[\s\S]{0,10}"Corporate"[\s\S]{0,200}East[\s\S]{0,200}West/.test(panel),
  "labels present"
);
record(
  `${PANEL}: account sub-headers (pp-access-account-head)`,
  /pp-access-account-head/.test(panel),
  "account sub-header class present"
);
record(
  `${PANEL}: grouping reads account.region (not editable region column)`,
  /p\?\.account\?\.region|person\?\.account\?\.region|p\.account\?\.region/.test(panel),
  "grouping uses derived region"
);

// 4. API additive change on admin-people-list.
record(
  `${API_D}: admin-people-list returns team_key per person`,
  /team_key:\s*teamKey/.test(apid),
  "team_key field added"
);
record(
  `${API_D}: admin-people-list returns account.region per person`,
  /account:\s*teamKey\s*\?\s*\{[\s\S]{0,120}region:/.test(apid),
  "account.region field added"
);
record(
  `${API_D}: account_key added to the people SELECT`,
  /PEOPLE_IDENTITY_COLS\s*=\s*"[^"]*account_key/.test(apid),
  "SELECT widened"
);

// 5. Super-admin lock chip.
record(
  `${PANEL}: lock chip replaces toggle on super-admin ops leadership`,
  /isSuperAdminLock\s*=\s*col\s*===\s*"is_ops_leadership"\s*&&\s*!!person\.is_super_admin/.test(panel),
  "lock-chip gate"
);
record(
  `${PANEL}: pp-access-lock-chip rendered`,
  /pp-access-lock-chip/.test(panel),
  "lock chip JSX"
);

// 6. Fetches + update POST payload.
record(
  `${PANEL}: fetches admin-people-list`,
  /\/api\/directory\?action=admin-people-list/.test(panel),
  "list fetch"
);
record(
  `${PANEL}: fetches admin-changelog`,
  /\/api\/directory\?action=admin-changelog/.test(panel),
  "changelog fetch"
);
record(
  `${PANEL}: POSTs admin-people-update with email/column/value/reason`,
  /action:\s*"admin-people-update"[\s\S]{0,400}\bemail:[\s\S]{0,400}\bcolumn:[\s\S]{0,400}\bvalue:[\s\S]{0,400}\breason/.test(panel),
  "update payload wired"
);

// 6b. Final-tweak assertions (expanded groups / work_email filter / dropdown).
record(
  `${PANEL}: region/account groups default EXPANDED (collapsed state starts empty)`,
  /useState\(\(\)\s*=>\s*\(\{\s*regions:\s*new\s+Set\(\)\s*,\s*accounts:\s*new\s+Set\(\)\s*\}\)\)/.test(panel),
  "initial collapsed Sets are empty - all open"
);
record(
  `${PANEL}: list excludes rows without a work_email`,
  /filter\(\s*\(p\)\s*=>\s*String\(p\.work_email\s*\|\|\s*""\)\.trim\(\)\s*!==\s*""\s*\)/.test(panel),
  "work_email filter present"
);
record(
  `${PANEL}: filter control is a <select>, no chip buttons`,
  /<select[\s\S]{0,200}value=\{chip\}[\s\S]{0,200}onChange=\{\(e\)\s*=>\s*setChip\(e\.target\.value\)\}/.test(panel) &&
    !/pp-access-chip--on/.test(panel) &&
    !/className=\{`pp-access-chip\$/.test(panel),
  "select wired, chip buttons removed"
);
record(
  `${PANEL}: dropdown offers the five options (All / Ops / SC Access / SC Admin / KPI)`,
  /CHIPS\.map\(\(c\)\s*=>\s*\(\s*<option/.test(panel) &&
    /\{\s*key:\s*"all"[\s\S]{0,20}label:\s*"All"/.test(panel) &&
    /\{\s*key:\s*"ops"[\s\S]{0,20}label:\s*"Ops Leadership"/.test(panel) &&
    /\{\s*key:\s*"sc"[\s\S]{0,20}label:\s*"SC Access"/.test(panel) &&
    /\{\s*key:\s*"scadm"[\s\S]{0,20}label:\s*"SC Admin"/.test(panel) &&
    /\{\s*key:\s*"kpi"[\s\S]{0,20}label:\s*"KPI"/.test(panel),
  "five options mapped via CHIPS -> <option>"
);

// 7. No out-of-scope admin actions; no directory.css / td-adm-/td-admin-.
for (const bad of ["admin-update-account", "admin-update-contacts", "admin-update-heroes", "admin-add-account", "admin-deactivate-account", "admin-reactivate-account"]) {
  record(
    `${PANEL}: does NOT reference ${bad}`,
    !new RegExp(bad.replace(/-/g, "\\-")).test(panel),
    "out-of-scope action absent"
  );
}
const combined = panel + "\n" + dirv + "\n" + pcss;
record(
  `No directory.css import on People Portal path`,
  !/directory\/directory\.css/.test(combined) && !/@import\s+["'][^"']*directory\.css["']/.test(combined),
  "clean"
);
const classUseRe = (sel) => new RegExp(`(className=["\\\`][^"\\\`]*${sel})|(["'\\\`]${sel})|(\\\.${sel})`);
record(
  `No td-adm- class USE on People Portal path`,
  !classUseRe("td-adm-").test(combined),
  "no className/selector use"
);
record(
  `No td-admin- class USE on People Portal path`,
  !classUseRe("td-admin-").test(combined),
  "no className/selector use"
);

// 8. API diff scope: directory route changed (expected), others not.
function gitDiff(file) {
  try {
    const out = execSync(`git diff --stat origin/main -- '${file}'`, { cwd: ROOT, encoding: "utf8" });
    return out.trim();
  } catch (err) {
    return `(git error: ${err.message})`;
  }
}
for (const f of [OLD_P, OLD_PG, API_P]) {
  const diff = gitDiff(f);
  record(
    `${f}: unchanged vs origin/main`,
    diff === "",
    diff === "" ? "clean" : `CHANGED: ${diff}`
  );
}
// /api/directory IS changed; verify the diff is scoped to admin-people-list only
// by asserting neither auth helper nor other admin actions were edited (grep for
// unmodified identity of their first lines).
{
  const key = /if\s+\(action\s*===\s*"admin-people-update"\)[\s\S]{0,100}const\s+authResult\s*=\s*await\s+requirePeopleAdmin/.test(apid);
  record(
    `${API_D}: admin-people-update handler shape intact`,
    key,
    key ? "intact" : "shape changed - check scope"
  );
}

// ─── Report ───────────────────────────────────────────────────────
console.log("");
console.log("PEOPLE & ACCESS ADMIN VERIFY (in-card revision)");
console.log("===============================================");
let allPass = true;
for (const r of results) {
  const tag = r.pass ? "PASS ✓" : "FAIL ✗";
  console.log(`${r.name.padEnd(84)} ${tag}  ${r.detail}`);
  if (!r.pass) allPass = false;
}
console.log("");
console.log(`RESULT: ${allPass ? "ALL PASS" : "FAIL - see rows above"}`);
process.exit(allPass ? 0 : 1);

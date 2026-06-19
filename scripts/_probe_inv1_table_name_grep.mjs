import { execSync } from "child_process";
const cwd = process.cwd();

function grepBoth(name, base, label) {
  try {
    const out = execSync(
      `grep -rn --include='*.js' --include='*.ts' --include='*.mjs' --include='*.tsx' --include='*.jsx' --include='*.sql' --include='*.md' "${name}" ${base} 2>/dev/null | grep -v -E "${cwd}/(node_modules|\\.next|_corpus_results|backups)"`,
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );
    return out.split("\n").filter(Boolean);
  } catch (e) {
    return [];
  }
}

function summarize(lines) {
  const byFile = new Map();
  for (const ln of lines) {
    const m = ln.match(/^([^:]+):(\d+):/);
    if (!m) continue;
    const file = m[1].replace(cwd + "/", "");
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(parseInt(m[2], 10));
  }
  return byFile;
}

const intranetCatalog = grepBoth("\\bitem_catalog\\b", ".", "intranet");
const intranetInvitems = grepBoth("\\binventory_items\\b", ".", "intranet");

const catSum = summarize(intranetCatalog);
const invSum = summarize(intranetInvitems);

console.log("═══════════════════════════════════════════════════════════════");
console.log("INTRANET grep results");
console.log("═══════════════════════════════════════════════════════════════");
console.log("\nFiles referencing 'item_catalog' (" + catSum.size + " files, " + intranetCatalog.length + " hits):");
for (const [file, lines] of [...catSum.entries()].sort()) {
  console.log("  " + file + " : lines " + lines.slice(0, 8).join(",") + (lines.length > 8 ? "..." : ""));
}
console.log("\nFiles referencing 'inventory_items' (" + invSum.size + " files, " + intranetInvitems.length + " hits):");
for (const [file, lines] of [...invSum.entries()].sort()) {
  console.log("  " + file + " : lines " + lines.slice(0, 8).join(",") + (lines.length > 8 ? "..." : ""));
}

// Files that reference BOTH - those are the ones to spec rewire for
const both = new Set([...catSum.keys()].filter((f) => invSum.has(f)));
console.log("\nFiles referencing BOTH (" + both.size + "):");
for (const f of [...both].sort()) console.log("  " + f);

// Write-context filter: which item_catalog references are WRITES vs reads?
// Approximate by looking for INSERT/UPDATE/DELETE/from()/.from("item_catalog")/append/batch
console.log("\nitem_catalog hits with WRITE keywords nearby:");
for (const ln of intranetCatalog) {
  if (/INSERT|UPDATE|DELETE|appendRowSA|batchUpdateRangesSA|writeRow|setValues|push|insert|upsert/i.test(ln)) {
    console.log("  " + ln.replace(cwd + "/", ""));
  }
}
console.log("\ninventory_items hits with WRITE keywords nearby:");
for (const ln of intranetInvitems) {
  if (/INSERT|UPDATE|DELETE|\.from\(.inventory_items.\)|insert\(|update\(|upsert\(/i.test(ln)) {
    console.log("  " + ln.replace(cwd + "/", ""));
  }
}

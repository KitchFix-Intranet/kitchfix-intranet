#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_qbo_customer_emails.mjs
// Confirm PrimaryEmailAddr on TBR + TBJ + CIN customers.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Kevin's CC prompt item 3: Sebastian's ZZ TEST draft had an empty
// email. Confirm whether the LIVE customers carry PrimaryEmailAddr
// today. If yes: no BillEmail work needed. If either missing: report
// what setting BillEmail explicitly would take.
//
// Also queries the ZZ TEST customer (22463) so we can see the diff -
// the recon's read was that empty email was a ZZ TEST artifact.
//
// Run with:
//   node --env-file=.env.local scripts/probes/_probe_qbo_customer_emails.mjs

const req = ["QBO_PROXY_BASE", "QBO_PROXY_KEY", "QBO_REALM_ID"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) {
    console.error(`\nABORT: ${k} missing`);
    process.exit(2);
  }
}

const base = process.env.QBO_PROXY_BASE.replace(/\/+$/, "");
const realm = encodeURIComponent(process.env.QBO_REALM_ID);

async function fetchCustomer(id) {
  const url = `${base}/v3/company/${realm}/customer/${id}?minorversion=75`;
  const res = await fetch(url, {
    headers: { "X-API-Key": process.env.QBO_PROXY_KEY, "Accept": "application/json" },
  });
  if (!res.ok) return { id, error: `${res.status} ${res.statusText}`, body: (await res.text()).slice(0, 200) };
  const json = await res.json();
  const c = json?.Customer;
  return {
    id,
    displayName: c?.DisplayName,
    companyName: c?.CompanyName,
    active: c?.Active,
    primaryEmail: c?.PrimaryEmailAddr?.Address || null,
    billEmail: c?.BillEmail?.Address || null,
    salesTerm: c?.SalesTermRef ? { id: c.SalesTermRef.value, name: c.SalesTermRef.name } : null,
  };
}

// Pull the account map to find every live QBO customer we invoice
// against - so this probe surfaces future customers too, not just
// the three named in the prompt.
async function pullAccountMap() {
  // Not going through Supabase here to keep the probe standalone;
  // hardcode the three customers named in the recon + the ZZ TEST
  // record for comparison.
  // IDs read from sc_qbo_account_map 2026-09-09.
  return [
    { label: "TBR - FL (Rays)",    customerId: "17860" },
    { label: "TBJ - FL (Jays)",    customerId: "16971" },
    { label: "CIN - AZ (Reds)",    customerId: "17752" },
    { label: "TXR - AZ (Rangers)", customerId: "19000" },
    { label: "ZZ TEST",            customerId: "22463" },
  ];
}

const customers = await pullAccountMap();
console.log(`\nQuerying ${customers.length} customers for PrimaryEmailAddr:\n`);
console.log("─".repeat(90));
for (const c of customers) {
  const r = await fetchCustomer(c.customerId);
  if (r.error) {
    console.log(`  ${c.label.padEnd(28)}  Id=${c.customerId}  ERROR: ${r.error}`);
    continue;
  }
  const email = r.primaryEmail || "(none)";
  const bill  = r.billEmail    || "(none)";
  const term  = r.salesTerm ? `${r.salesTerm.name} (Id=${r.salesTerm.id})` : "(no default term set)";
  const active = r.active ? "ACTIVE" : "INACTIVE";
  console.log(`  ${c.label.padEnd(28)}  Id=${c.customerId}  ${active}`);
  console.log(`    DisplayName:   ${r.displayName || "(none)"}`);
  console.log(`    PrimaryEmail:  ${email}`);
  console.log(`    BillEmail:     ${bill}`);
  console.log(`    SalesTermRef:  ${term}`);
  console.log("");
}
console.log("─".repeat(90));
console.log("\nDefinition of complete: PrimaryEmailAddr non-empty AND active.");
console.log("If any real (non-ZZ) customer shows PrimaryEmail=(none), BillEmail work is needed.");

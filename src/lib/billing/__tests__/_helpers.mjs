// Shared test helpers for the buildInvoicePayload fixture parity suite.
// The invoice JSON fixtures under __fixtures__/ are LIVE QBO
// responses (stripped of client contact fields; see B6 grep proof in
// the PR body).
//
// Strategy: each test REVERSE-ENGINEERS synthetic sc_daily_revenue
// rows from the invoice lines themselves (parses aggregate
// descriptions like "Breakfast - 100 & Lunch - 100" back into
// per-service rows). The builder then round-trips those rows and
// the test asserts line-level equality with the fixture. This
// proves the transform's shape (aggregation, rounding, description,
// splits, sort, TxnDate). Rate correctness IS guaranteed because
// the row's rate IS the fixture's UnitPrice, but that's fine - K-2
// ("SC is rate truth") lands in the RUNTIME path (diff harness +
// PR-C adapter), and this suite proves the TRANSFORM.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name) {
  const path = resolve(__dirname, "..", "__fixtures__", name);
  return JSON.parse(readFileSync(path, "utf8"));
}

// ─── Pilot maps mirror sc-31 seeds exactly ────────────────────────
export const TXR_AZ_ACCOUNT_MAP = {
  account_key:       "TXR - AZ",
  qbo_customer_id:   "19000",
  qbo_customer_name: "Texas Rangers - Surprise, AZ",
  qbo_taxcode_id:    "36",
  cadence:           "weekly",
  biweekly_anchor:   null,
  active:            true,
};

export const TXR_AZ_SERVICE_MAP = [
  { service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f", account_key: "TXR - AZ", qbo_item_id: "3333", qbo_line_description: "TXR-AZ MiLB - Breakfast/Lunch/Dinner", aggregate_group: "txr-milb-bld", invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "3ec66570-b1dd-4189-a9ff-a0f9aba47797", account_key: "TXR - AZ", qbo_item_id: "3333", qbo_line_description: "TXR-AZ MiLB - Breakfast/Lunch/Dinner", aggregate_group: "txr-milb-bld", invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "b6b449b7-04f3-4da8-ab21-81874fcb6b93", account_key: "TXR - AZ", qbo_item_id: "3333", qbo_line_description: "TXR-AZ MiLB - Breakfast/Lunch/Dinner", aggregate_group: "txr-milb-bld", invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "6871d41e-08a8-4603-92c4-ba399a3a3674", account_key: "TXR - AZ", qbo_item_id: "3336", qbo_line_description: "TXR-AZ - Continental Breakfast", aggregate_group: null, invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "e47abd8c-a866-4108-84c8-24685f8ea96a", account_key: "TXR - AZ", qbo_item_id: "3337", qbo_line_description: "TXR-AZ - Pre-Game Hot Snack", aggregate_group: null, invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "b5b0d24b-1162-4a80-a546-42bb6231470d", account_key: "TXR - AZ", qbo_item_id: "3338", qbo_line_description: "TXR-AZ - Regular Snack", aggregate_group: null, invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "28aa24de-aaf3-49aa-957b-76b95e1a13b6", account_key: "TXR - AZ", qbo_item_id: "3334", qbo_line_description: "TXR-AZ MLB - Breakfast/Lunch/Dinner", aggregate_group: "txr-mlb-bld", invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "91cd69db-68c5-40ef-b45a-9200c071972d", account_key: "TXR - AZ", qbo_item_id: "3334", qbo_line_description: "TXR-AZ MLB - Breakfast/Lunch/Dinner", aggregate_group: "txr-mlb-bld", invoice_slot: "main", tax_override: null, line_desc_style: null },
  { service_id: "3f591244-cb3d-49d1-9525-fddbc5979905", account_key: "TXR - AZ", qbo_item_id: "3334", qbo_line_description: "TXR-AZ MLB - Breakfast/Lunch/Dinner", aggregate_group: "txr-mlb-bld", invoice_slot: "main", tax_override: null, line_desc_style: null },
];

export const CIN_AZ_ACCOUNT_MAP = {
  account_key:       "CIN - AZ",
  qbo_customer_id:   "17752",
  qbo_customer_name: "Cincinnati Reds (Goodyear, AZ)",
  qbo_taxcode_id:    "37",
  cadence:           "biweekly",
  biweekly_anchor:   "2026-05-31",
  active:            true,
};

export const CIN_AZ_SERVICE_MAP = [
  { service_id: "82fd6db3-35ec-4904-907d-5c52a74f625e", account_key: "CIN - AZ", qbo_item_id: "3300", qbo_line_description: "REDS MiLB - Meal Service", aggregate_group: "cin-milb-bld", invoice_slot: "main",  tax_override: null, line_desc_style: null },
  { service_id: "ed628578-527c-4dc9-9f91-3b94efb72846", account_key: "CIN - AZ", qbo_item_id: "3300", qbo_line_description: "REDS MiLB - Meal Service", aggregate_group: "cin-milb-bld", invoice_slot: "main",  tax_override: null, line_desc_style: null },
  { service_id: "54679d87-820a-4a04-ba9e-76c431fce90e", account_key: "CIN - AZ", qbo_item_id: "3300", qbo_line_description: "REDS MiLB - Meal Service", aggregate_group: "cin-milb-bld", invoice_slot: "main",  tax_override: null, line_desc_style: null },
  // sc-31a (owner ruling 2026-08-10): plain_name lines use qbo_line_description
  // as the invoice description, so qbo_line_description here carries
  // Sebastian's typed convention (not the QB item's registered Name).
  { service_id: "5529584a-ab40-4cb6-81d1-ac30372c9978", account_key: "CIN - AZ", qbo_item_id: "3322", qbo_line_description: "Pre-Game Snack",            aggregate_group: null,           invoice_slot: "main",  tax_override: null, line_desc_style: "plain_name" },
  { service_id: "3e5ac4cb-7391-46db-ae38-cb71435d4e03", account_key: "CIN - AZ", qbo_item_id: "3371", qbo_line_description: "Coffee Service",            aggregate_group: null,           invoice_slot: "main",  tax_override: "NON", line_desc_style: "plain_name" },
  { service_id: "d9e368ee-916a-4f03-96f5-1079bb520cc7", account_key: "CIN - AZ", qbo_item_id: "3372", qbo_line_description: "Fountain Beverages",        aggregate_group: null,           invoice_slot: "main",  tax_override: "NON", line_desc_style: "plain_name" },
  { service_id: "1e5a337d-610b-4b7d-9154-3f8787e8ccf8", account_key: "CIN - AZ", qbo_item_id: "3302", qbo_line_description: "REDS MLB - Meal Service",  aggregate_group: "cin-mlb-bld",  invoice_slot: "main",  tax_override: null, line_desc_style: null },
  { service_id: "b00eaf5a-0849-4e97-90bc-760afc320dd3", account_key: "CIN - AZ", qbo_item_id: "3302", qbo_line_description: "REDS MLB - Meal Service",  aggregate_group: "cin-mlb-bld",  invoice_slot: "main",  tax_override: null, line_desc_style: null },
  { service_id: "6b8919dd-17ce-4e7b-87b9-6787b2220e2e", account_key: "CIN - AZ", qbo_item_id: "3302", qbo_line_description: "REDS MLB - Meal Service",  aggregate_group: "cin-mlb-bld",  invoice_slot: "main",  tax_override: null, line_desc_style: null },
  { service_id: "4f0cc3af-2fef-4f5a-8762-3f87c45de3a3", account_key: "CIN - AZ", qbo_item_id: "3327", qbo_line_description: "REDS Rehab - Meal Service",aggregate_group: "cin-rehab-meal",invoice_slot:"rehab", tax_override: null, line_desc_style: null },
  { service_id: "30efb290-f371-4f1a-8267-488f568ec08a", account_key: "CIN - AZ", qbo_item_id: "3327", qbo_line_description: "REDS Rehab - Meal Service",aggregate_group: "cin-rehab-meal",invoice_slot:"rehab", tax_override: null, line_desc_style: null },
  { service_id: "2b2be535-c41d-49a1-8519-6ac4dc06cdb9", account_key: "CIN - AZ", qbo_item_id: "3327", qbo_line_description: "REDS Rehab - Meal Service",aggregate_group: "cin-rehab-meal",invoice_slot:"rehab", tax_override: null, line_desc_style: null },
  { service_id: "c667d4e5-db72-4e37-9da8-06342881e76f", account_key: "CIN - AZ", qbo_item_id: "3327", qbo_line_description: "Continental Plus",          aggregate_group: null,            invoice_slot:"rehab", tax_override: null, line_desc_style: "plain_name" },
];

// Name -> preferred service_id used when reversing an aggregate
// description back into synthetic SC rows. The alphabetical mismatch
// (Dinner < Lunch) makes this deterministic-lookup safer than a
// naive .find(s => s.name === ...).
export const NAME_TO_SVC_ID = {
  "TXR - AZ": {
    "txr-milb-bld": {
      "Breakfast":  "5d626ec9-2505-470f-abe6-d7f3168ddf8f",
      "Lunch":      "3ec66570-b1dd-4189-a9ff-a0f9aba47797",
      "Dinner":     "b6b449b7-04f3-4da8-ab21-81874fcb6b93",
    },
    "txr-mlb-bld": {
      "Breakfast":  "28aa24de-aaf3-49aa-957b-76b95e1a13b6",
      "Lunch":      "91cd69db-68c5-40ef-b45a-9200c071972d",
      "Dinner":     "3f591244-cb3d-49d1-9525-fddbc5979905",
    },
    // Non-aggregate items (own line) - map by item id -> service_id.
    "__solo__by_item": {
      "3336": "6871d41e-08a8-4603-92c4-ba399a3a3674", // Continental Breakfast
      "3337": "e47abd8c-a866-4108-84c8-24685f8ea96a", // Pre-Game Hot Snack
      "3338": "b5b0d24b-1162-4a80-a546-42bb6231470d", // Regular Snack
    },
  },
  "CIN - AZ": {
    "cin-milb-bld": {
      "Breakfast":  "82fd6db3-35ec-4904-907d-5c52a74f625e",
      "Lunch":      "ed628578-527c-4dc9-9f91-3b94efb72846",
      "Dinner":     "54679d87-820a-4a04-ba9e-76c431fce90e",
    },
    "cin-mlb-bld": {
      "Breakfast":  "1e5a337d-610b-4b7d-9154-3f8787e8ccf8",
      "Lunch":      "b00eaf5a-0849-4e97-90bc-760afc320dd3",
      "Dinner":     "6b8919dd-17ce-4e7b-87b9-6787b2220e2e",
    },
    "cin-rehab-meal": {
      "Breakfast":  "4f0cc3af-2fef-4f5a-8762-3f87c45de3a3",
      "Lunch":      "30efb290-f371-4f1a-8267-488f568ec08a",
      "Dinner":     "2b2be535-c41d-49a1-8519-6ac4dc06cdb9",
    },
    "__solo__by_item": {
      "3322": "5529584a-ab40-4cb6-81d1-ac30372c9978", // Pre-Game Snack
      "3371": "3e5ac4cb-7391-46db-ae38-cb71435d4e03", // Coffee Service (FF TF)
      "3372": "d9e368ee-916a-4f03-96f5-1079bb520cc7", // Fountain Beverages (FF TF)
    },
    "__solo__continental_plus": "c667d4e5-db72-4e37-9da8-06342881e76f",
  },
};

// Parse an aggregate description like "Breakfast - 100 & Lunch - 100.
// Total = 200." into { components: [{name, qty}], total }. Returns
// null for plain-name descriptions ("Lunch") or missing descriptions.
export function parseAggregateDescription(desc) {
  if (!desc) return null;
  const m = desc.match(/^(.+?)\.\s*Total\s*=\s*(\d+)\.$/);
  if (!m) return null;
  const body = m[1];
  const total = Number(m[2]);
  const cleaned = body.replace(/,\s*&/g, ",").replace(/\s*&\s*/g, ",");
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const components = parts.map((p) => {
    const pm = p.match(/^(.+?)\s+-\s+(\d+)$/);
    if (!pm) throw new Error(`Cannot parse component "${p}" from description "${desc}"`);
    return { name: pm[1].trim(), qty: Number(pm[2]) };
  });
  return { components, total };
}

// Reverse-engineer synthetic sc_daily_revenue rows from a QBO
// fixture (main slot lines only for the given invoice - caller
// passes both slots for CIN - AZ).
//
// For agg-group lines: parse description, spread qty across
// per-component services with the fixture's UnitPrice as the
// per-day rate. For solo (no aggregate_group) lines: single row.
// For FF (Coffee, Fountain): pick one representative day in the
// week to attach the FF row (builder emits qty=1 per week
// regardless of how many days carry the row).
export function synthRowsFromInvoice(fixture, {
  accountKey,
  serviceMap,
  nameToSvc,
  periodByDate,     // Map<isoDate, {period, week_label}>
}) {
  const rows = [];
  const svcById = new Map(serviceMap.map((s) => [s.service_id, s]));

  // Group lines by ItemRef.value to find aggregation.
  for (const line of (fixture.Line || []).filter((l) => l.DetailType === "SalesItemLineDetail")) {
    const sil = line.SalesItemLineDetail;
    const itemId = sil.ItemRef.value;
    const svcDate = sil.ServiceDate;
    const qty = Number(sil.Qty);
    const rate = Number(sil.UnitPrice);
    const meta = periodByDate.get(svcDate) || { period: null, week_label: null };
    const groupSvcs = serviceMap.filter((s) => s.qbo_item_id === itemId && s.aggregate_group);

    // FF service lookup (Coffee / Fountain) - by item id in solo table.
    const soloSvcId = nameToSvc["__solo__by_item"]?.[itemId];
    const soloSvc = soloSvcId ? svcById.get(soloSvcId) : null;

    // The Rehab Continental Plus special: itemId 3327 + rate NOT
    // matching the aggregated Rehab rate. If the line's rate does
    // NOT match the rate of the aggregate members, it is Continental
    // Plus (or another split by rate-guard).
    const isRehabItem = accountKey === "CIN - AZ" && itemId === "3327";

    // Aggregate-group descriptor lines with 2+ components (Sebastian's
    // "Total =" composition).
    const parsed = parseAggregateDescription(line.Description);
    const isMultiComp = groupSvcs.length > 0 && parsed && parsed.components.length >= 2;

    if (isMultiComp && !(isRehabItem && rate < 10)) {
      // Attach per-component synthetic rows.
      const groupName = groupSvcs[0].aggregate_group;
      for (const comp of parsed.components) {
        const svcId = nameToSvc[groupName]?.[comp.name];
        if (!svcId) throw new Error(`No svc id for ${accountKey} ${groupName} / ${comp.name}`);
        rows.push({
          service_date: svcDate,
          service_id:   svcId,
          service_name: comp.name,
          account_key:  accountKey,
          is_flat_fee:  false,
          is_tax_free:  false,
          is_non_revenue: false,
          actual_count: comp.qty,
          actual_price_at_date: rate,
          price_at_date: rate,
          period: meta.period,
          week_label: meta.week_label,
          has_actuals: true,
          has_projection: false,
        });
      }
    } else if (isRehabItem && rate < 10) {
      // Continental Plus (rate ~ $6.36) - own service_id.
      const svcId = nameToSvc["__solo__continental_plus"];
      rows.push({
        service_date: svcDate,
        service_id:   svcId,
        service_name: "Continental Plus",
        account_key:  accountKey,
        is_flat_fee: false, is_tax_free: false, is_non_revenue: false,
        actual_count: qty,
        actual_price_at_date: rate,
        price_at_date: rate,
        period: meta.period, week_label: meta.week_label,
        has_actuals: true, has_projection: false,
      });
    } else if (groupSvcs.length > 0 && line.Description) {
      // Single-meal aggregate-group day (Rehab convention: plain
      // "Lunch" as description, one service_id from the group).
      const groupName = groupSvcs[0].aggregate_group;
      const svcId = nameToSvc[groupName]?.[line.Description];
      if (!svcId) {
        throw new Error(`Rehab-style single-meal line "${line.Description}" on ${svcDate}: no svc id in ${accountKey}/${groupName}`);
      }
      rows.push({
        service_date: svcDate,
        service_id:   svcId,
        service_name: line.Description,
        account_key:  accountKey,
        is_flat_fee: false, is_tax_free: false, is_non_revenue: false,
        actual_count: qty,
        actual_price_at_date: rate,
        price_at_date: rate,
        period: meta.period, week_label: meta.week_label,
        has_actuals: true, has_projection: false,
      });
    } else if (soloSvc) {
      // Solo line (Regular Snack, Pre-Game Hot Snack, Snack, Coffee, Fountain).
      // The line's description on the fixture is the SC service_name
      // (for plain_name items) or empty. Use it as service_name.
      // If empty, fall back to a lookup.
      const isFF = itemId === "3371" || itemId === "3372"; // Coffee, Fountain
      const scNameByItem = {
        "3336": "Continental Breakfast",
        "3337": "Pre-Game Hot Snack",
        "3338": "Regular Snack",
        "3322": "Pre-Game Snack",
        "3371": "Coffee Service",
        "3372": "Fountain Beverages",
      };
      const svcName = line.Description || scNameByItem[itemId] || "?";
      rows.push({
        service_date: svcDate,
        service_id:   soloSvc.service_id,
        service_name: svcName,
        account_key:  accountKey,
        is_flat_fee:  isFF,
        is_tax_free:  isFF,
        is_non_revenue: false,
        actual_count: isFF ? 1 : qty,  // FF: pick 1 as sentinel; builder ignores value
        actual_price_at_date: rate,
        price_at_date: rate,
        period: meta.period, week_label: meta.week_label,
        has_actuals: true, has_projection: false,
      });
    } else {
      throw new Error(`Cannot synth row for ${accountKey} item ${itemId} on ${svcDate} rate ${rate}`);
    }
  }
  return rows;
}

// Extract the fixture's SalesItemLineDetail lines into a canonical
// comparable shape.
export function normaliseLines(source) {
  const items = (source.Line || []).filter((l) => l.DetailType === "SalesItemLineDetail");
  const shaped = items.map((l) => ({
    ServiceDate: l.SalesItemLineDetail.ServiceDate,
    ItemRefId:   l.SalesItemLineDetail.ItemRef.value,
    ItemRefName: l.SalesItemLineDetail.ItemRef.name,
    UnitPrice:   Number(l.SalesItemLineDetail.UnitPrice),
    Qty:         Number(l.SalesItemLineDetail.Qty),
    Amount:      Number(l.Amount),
    Description: l.Description || "",
    TaxCodeRef:  l.SalesItemLineDetail.TaxCodeRef?.value || "TAX",
  }));
  shaped.sort((a, b) => {
    if (a.ServiceDate !== b.ServiceDate) return a.ServiceDate.localeCompare(b.ServiceDate);
    if (a.ItemRefId !== b.ItemRefId) return a.ItemRefId.localeCompare(b.ItemRefId);
    if (b.Amount !== a.Amount) return b.Amount - a.Amount;
    return b.Qty - a.Qty;
  });
  return shaped;
}

export function preTaxSubtotal(shapedLines) {
  return shapedLines.reduce((s, l) => s + l.Amount, 0);
}

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

console.log("=== Sheets vs PG counts (inventory tables) ===");
console.log("Sheets counts come from xlsx; PG counts pulled live.");

const tables = ["inventory_items", "item_aliases", "price_history", "review_queue", "merge_history", "merge_history_items", "count_sessions", "count_items", "storage_locations"];
for (const t of tables) {
  const { count } = await supa.from(t).select("*", { count: "exact", head: true });
  console.log("  PG " + t.padEnd(22) + " " + count);
}

console.log();
console.log("=== Latest writes (PG side, freeze check) ===");
// inventory_items
const { data: latestII } = await supa.from("inventory_items").select("created_at, updated_at").order("created_at", { ascending: false }).limit(1);
console.log("  inventory_items latest created_at: " + (latestII?.[0]?.created_at || "(none)"));
console.log("  inventory_items latest updated_at: " + (latestII?.[0]?.updated_at || "(none)"));
const { data: latestUpd } = await supa.from("inventory_items").select("updated_at").order("updated_at", { ascending: false }).limit(1);
console.log("  inventory_items MAX updated_at: " + (latestUpd?.[0]?.updated_at || "(none)"));

const { data: latestAlias } = await supa.from("item_aliases").select("learned_at").order("learned_at", { ascending: false }).limit(1);
console.log("  item_aliases   latest learned_at: " + (latestAlias?.[0]?.learned_at || "(none)"));

const { data: latestPH } = await supa.from("price_history").select("recorded_at").order("recorded_at", { ascending: false }).limit(1);
console.log("  price_history  latest recorded_at: " + (latestPH?.[0]?.recorded_at || "(none)"));

const { data: latestRQ } = await supa.from("review_queue").select("created_at").order("created_at", { ascending: false }).limit(1);
console.log("  review_queue   latest created_at: " + (latestRQ?.[0]?.created_at || "(none)"));

const { data: latestMH } = await supa.from("merge_history").select("created_at").order("created_at", { ascending: false }).limit(1);
console.log("  merge_history  latest created_at: " + (latestMH?.[0]?.created_at || "(none)"));

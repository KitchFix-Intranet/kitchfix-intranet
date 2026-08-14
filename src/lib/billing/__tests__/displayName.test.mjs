// displayName.js - contacts-backed display name resolver.
// PR-F1 2026-08-14 - owner ruling: N1 lead sentence uses names, not
// raw email addresses; Gmail auto-link avoidance means no visible
// email addresses in body.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDisplayNames,
  resolveOneDisplayName,
  titlecaseLocalPart,
} from "../displayName.js";

// Fake supabase-js client: returns predefined `contacts` rows.
function makeSupaFake(contacts) {
  return {
    from(table) {
      return {
        select() { return this; },
        in(_col, arr) {
          const lowerSet = new Set(arr.map((e) => String(e).toLowerCase()));
          const data = contacts.filter((c) => lowerSet.has(String(c.email).toLowerCase()));
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}

test("titlecaseLocalPart handles common shapes", () => {
  assert.equal(titlecaseLocalPart("k.fietek@kitchfix.com"), "K Fietek");
  assert.equal(titlecaseLocalPart("jordan.rogers@kitchfix.com"), "Jordan Rogers");
  assert.equal(titlecaseLocalPart("ochoa@kitchfix.com"), "Ochoa");
  assert.equal(titlecaseLocalPart("l.ochoa@kitchfix.com"), "L Ochoa");
  assert.equal(titlecaseLocalPart("first_last@kitchfix.com"), "First Last");
  assert.equal(titlecaseLocalPart(""), "");
  assert.equal(titlecaseLocalPart(null), "");
});

test("resolveDisplayNames: DB hit wins over fallback", async () => {
  const supa = makeSupaFake([
    { name: "Kevin Fietek", email: "k.fietek@kitchfix.com" },
  ]);
  const map = await resolveDisplayNames(["k.fietek@kitchfix.com"], { supa });
  assert.equal(map.get("k.fietek@kitchfix.com"), "Kevin Fietek");
});

test("resolveDisplayNames: DB miss falls back to titlecase local-part", async () => {
  const supa = makeSupaFake([]); // no rows returned
  const map = await resolveDisplayNames(["unknown.person@kitchfix.com"], { supa });
  assert.equal(map.get("unknown.person@kitchfix.com"), "Unknown Person");
});

test("resolveDisplayNames: case-insensitive email match", async () => {
  const supa = makeSupaFake([
    { name: "Kevin Fietek", email: "K.Fietek@KitchFix.COM" },
  ]);
  const map = await resolveDisplayNames(["k.fietek@kitchfix.com"], { supa });
  assert.equal(map.get("k.fietek@kitchfix.com"), "Kevin Fietek");
});

test("resolveDisplayNames: batch with mixed hits + misses", async () => {
  const supa = makeSupaFake([
    { name: "Kevin Fietek", email: "k.fietek@kitchfix.com" },
    { name: "Sebastian Castro", email: "sebastian@kitchfix.com" },
  ]);
  const map = await resolveDisplayNames([
    "k.fietek@kitchfix.com",
    "sebastian@kitchfix.com",
    "l.ochoa@kitchfix.com",
  ], { supa });
  assert.equal(map.get("k.fietek@kitchfix.com"), "Kevin Fietek");
  assert.equal(map.get("sebastian@kitchfix.com"), "Sebastian Castro");
  assert.equal(map.get("l.ochoa@kitchfix.com"), "L Ochoa"); // titlecase fallback
});

test("resolveDisplayNames: empty input returns empty map without DB call", async () => {
  let called = false;
  const supa = { from() { called = true; return { select() { return this; }, in() { return Promise.resolve({ data: [], error: null }); } }; } };
  const map = await resolveDisplayNames([], { supa });
  assert.equal(map.size, 0);
  assert.equal(called, false, "no DB round trip on empty input");
});

test("resolveDisplayNames: DB error surfaces as fallback (does not throw)", async () => {
  const supa = {
    from() {
      return {
        select() { return this; },
        in() { return Promise.resolve({ data: null, error: { message: "connection reset" } }); },
      };
    },
  };
  const map = await resolveDisplayNames(["k.fietek@kitchfix.com"], { supa });
  // Fallback seeded before DB attempt = titlecase local-part.
  assert.equal(map.get("k.fietek@kitchfix.com"), "K Fietek");
});

test("resolveOneDisplayName: single-email convenience", async () => {
  const supa = makeSupaFake([{ name: "Jordan Rogers", email: "jordan.rogers@kitchfix.com" }]);
  assert.equal(await resolveOneDisplayName("jordan.rogers@kitchfix.com", { supa }), "Jordan Rogers");
  assert.equal(await resolveOneDisplayName("noone@x.com", { supa }), "Noone");
});

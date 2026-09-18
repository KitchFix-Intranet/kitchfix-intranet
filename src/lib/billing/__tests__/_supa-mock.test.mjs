// Direct coverage on the _supa-mock chain. The mock has silently
// hidden real production behaviour three times now - .rpc() and
// .not() were caught during sc-48 / #1161 rollout when tests
// aborted early; .order()'s single-slot + wrong-default was caught
// only when Kevin ran the whole suite against a clean main and
// noticed. A mock kinder than production hides defects. Pin the
// specific shapes here so the next drift lights up on the FIRST
// test run rather than the third arc downstream.
//
// Run via: node --import ./scripts/_setup/register-aliases.mjs --test \
//          src/lib/billing/__tests__/_supa-mock.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { makeSupaMock } from "./_supa-mock.mjs";

// ─── .order() multi-column + default direction + nullsFirst ────

test(".order() accumulates multiple calls into primary-then-secondary sort", async () => {
  const s = makeSupaMock({ tables: { people: [
    { work_email: "adam@kitchfix.com",  is_site_leader: false, display_name: "Adam" },
    { work_email: "zoe@kitchfix.com",   is_site_leader: true,  display_name: "Zoe"  },
    { work_email: "mira@kitchfix.com",  is_site_leader: true,  display_name: "Mira" },
    { work_email: "beth@kitchfix.com",  is_site_leader: false, display_name: "Beth" },
  ] } });
  // Mirrors getSalariedManagerEmails: site-leader-first, then
  // display_name ascending.
  const { data } = await s.from("people")
    .select("work_email")
    .order("is_site_leader", { ascending: false, nullsFirst: false })
    .order("display_name",   { ascending: true });
  assert.deepEqual(
    data.map(r => r.work_email),
    // Site leaders (Mira, Zoe) come first, alphabetical within;
    // non-leaders (Adam, Beth) follow, alphabetical within.
    ["mira@kitchfix.com", "zoe@kitchfix.com", "adam@kitchfix.com", "beth@kitchfix.com"],
    "second .order() must not silently overwrite the first"
  );
});

test(".order() default direction is ascending when opts omitted", async () => {
  const s = makeSupaMock({ tables: { t: [
    { name: "c" }, { name: "a" }, { name: "b" },
  ] } });
  const { data } = await s.from("t").select("name").order("name");
  assert.deepEqual(data.map(r => r.name), ["a", "b", "c"],
    "supabase-js defaults ascending=true; the mock previously defaulted descending via !!opts?.ascending");
});

test(".order() nullsFirst=false pushes nulls to the end (default)", async () => {
  const s = makeSupaMock({ tables: { t: [
    { v: 2 }, { v: null }, { v: 1 }, { v: null }, { v: 3 },
  ] } });
  const { data } = await s.from("t").select("v").order("v", { ascending: true });
  assert.deepEqual(data.map(r => r.v), [1, 2, 3, null, null],
    "default nullsFirst=false places NULLs after non-null values regardless of direction");
});

test(".order() nullsFirst=true places nulls before non-null values", async () => {
  const s = makeSupaMock({ tables: { t: [
    { v: 2 }, { v: null }, { v: 1 },
  ] } });
  const { data } = await s.from("t").select("v").order("v", { ascending: true, nullsFirst: true });
  assert.deepEqual(data.map(r => r.v), [null, 1, 2]);
});

// ─── .not(col, "is", null) ─────────────────────────────────────

test(".not(col, 'is', null) filters out null and undefined", async () => {
  const s = makeSupaMock({ tables: { people: [
    { work_email: "a@kitchfix.com" },
    { work_email: null },
    { work_email: "b@kitchfix.com" },
    { work_email: undefined },
  ] } });
  const { data } = await s.from("people").select("work_email").not("work_email", "is", null);
  assert.deepEqual(
    data.map(r => r.work_email).sort(),
    ["a@kitchfix.com", "b@kitchfix.com"]
  );
});

// .rpc() coverage lives on the sc-48 branch (#1182) alongside the
// sc-48 code that introduces it. Not duplicating that here to avoid
// two PRs owning the same test.

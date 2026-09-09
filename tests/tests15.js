/* Cash reserves as a dated series: changing today must not rewrite the past. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function base(readings) {
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F", monthlyAllotment: 500 }],
    ledger: [{ id: "e", fundId: "f", amount: 2000, date: "2026-01-01", kind: "allotment" }],
    cashReadings: readings || [] });
}

sec("a reading is a point in time");
base([
  { id: "r1", date: "2026-06-01", amount: 50000, note: "opening" },
  { id: "r2", date: "2026-08-01", amount: 74197, note: "bonus" },
]);
eq("today uses the newest reading", cashNow(), 74197);
eq("a date before any reading is zero", cashAt("2026-01-01"), 0);
eq("on the first reading's day", cashAt("2026-06-01"), 50000);
eq("between readings holds the earlier one", cashAt("2026-07-15"), 50000);
eq("on the second reading's day", cashAt("2026-08-01"), 74197);
eq("after the last, it holds", cashAt("2027-01-01"), 74197);

sec("adding a new reading leaves history intact");
base([{ id: "r1", date: "2026-06-01", amount: 50000, note: "opening" }]);
var before = cashAt("2026-06-15");
setCashReading(51000, "2026-08-25", "extra $1,000");
eq("the past is unchanged", cashAt("2026-06-15"), before);
eq("  still the original figure", cashAt("2026-06-15"), 50000);
eq("today reflects the new one", cashNow(), 51000);
ok("both readings are kept", state.cashReadings.length === 2, String(state.cashReadings.length));
ok("stored oldest-first", state.cashReadings[0].date < state.cashReadings[1].date);

sec("re-entering the same date corrects rather than duplicates");
base([{ id: "r1", date: "2026-08-25", amount: 50000 }]);
setCashReading(52000, "2026-08-25", "typo fix");
ok("still one reading", state.cashReadings.length === 1, String(state.cashReadings.length));
eq("with the corrected amount", cashNow(), 52000);
ok("and the new note", state.cashReadings[0].note === "typo fix");

sec("back-dating slots into the right place");
base([
  { id: "r1", date: "2026-06-01", amount: 50000 },
  { id: "r3", date: "2026-08-01", amount: 74197 },
]);
setCashReading(60000, "2026-07-01", "forgot to log");
ok("three readings", state.cashReadings.length === 3);
ok("in date order", state.cashReadings.map(function (r) { return r.date; }).join(",")
   === "2026-06-01,2026-07-01,2026-08-01");
eq("the back-dated value applies from its date", cashAt("2026-07-15"), 60000);
eq("earlier is untouched", cashAt("2026-06-15"), 50000);
eq("later is untouched", cashNow(), 74197);

sec("unallocated tracks the reading, not a frozen number");
base([{ id: "r1", date: "2026-08-01", amount: 10000 }]);
eq("allocated is the fund total", allocated(), 2000);
eq("unallocated now", unallocated(), 8000);
setCashReading(11000, "2026-08-25", "bonus");
eq("a new reading moves unallocated", unallocated(), 9000);
ok("without touching the fund", balanceOfFund("f") === 2000);

sec("migration from the old single figure");
(function () {
  var old = normalize({
    meta: { cashReserves: 74197, cashUpdatedAt: "2026-08-20" },
    categories: [{ id: "c", name: "C" }], funds: [], ledger: [] });
  ok("a reading was seeded", old.cashReadings.length === 1, String(old.cashReadings.length));
  eq("with the old amount", old.cashReadings[0].amount, 74197);
  ok("dated when it was last set", old.cashReadings[0].date === "2026-08-20", old.cashReadings[0].date);
  ok("labelled", /opening/i.test(old.cashReadings[0].note), old.cashReadings[0].note);
  state = old;
  eq("and reads the same as before", cashNow(), 74197);

  var none = normalize({ categories: [], funds: [], ledger: [] });
  ok("no reserves means no readings", none.cashReadings.length === 0);
  state = none;
  eq("cashNow is zero", cashNow(), 0);

  var already = normalize({ meta: { cashReserves: 999 },
    cashReadings: [{ id: "x", date: "2026-08-01", amount: 5000 }],
    categories: [], funds: [], ledger: [] });
  ok("an existing series is not re-seeded", already.cashReadings.length === 1);
  eq("  and wins over the stale scalar", already.cashReadings[0].amount, 5000);
})();

sec("hardening");
(function () {
  var n = normalize({ categories: [], funds: [], ledger: [],
    cashReadings: [
      { id: "a", date: "2026-08-01", amount: "5000" },
      { id: "b", date: "2026-07-01", amount: -20 },
      { id: "c", date: "2026-09-01", amount: "junk" },
    ] });
  eq("strings coerce", n.cashReadings.filter(function (r) { return r.id === "a"; })[0].amount, 5000);
  eq("negatives clamp to zero", n.cashReadings.filter(function (r) { return r.id === "b"; })[0].amount, 0);
  eq("garbage becomes zero", n.cashReadings.filter(function (r) { return r.id === "c"; })[0].amount, 0);
  ok("sorted on load", n.cashReadings.map(function (r) { return r.date; }).join(",")
     === "2026-07-01,2026-08-01,2026-09-01");
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));
})();

sec("deleting a reading");
base([
  { id: "r1", date: "2026-06-01", amount: 50000 },
  { id: "r2", date: "2026-08-01", amount: 74197 },
]);
state.cashReadings = state.cashReadings.filter(function (r) { return r.id !== "r2"; });
state.meta.deleted.push("r2");
eq("removing the newest falls back to the earlier one", cashNow(), 50000);
ok("tombstoned", state.meta.deleted.indexOf("r2") >= 0);
var round = normalize(JSON.parse(JSON.stringify(state)));
ok("and it stays gone after a reload", round.cashReadings.length === 1);

sec("merge keeps readings from both sides");
(function () {
  var disk = { schemaVersion: 5, meta: { deleted: [] }, categories: [], funds: [], ledger: [], plans: [],
    cashReadings: [{ id: "a", date: "2026-06-01", amount: 50000 }] };
  var mirror = { schemaVersion: 5, meta: { deleted: [] }, categories: [], funds: [], ledger: [], plans: [],
    cashReadings: [{ id: "b", date: "2026-08-01", amount: 74197 }] };
  var m = normalize(mergeStates(disk, mirror));
  ok("both survive", m.cashReadings.length === 2, String(m.cashReadings.length));
  state = m;
  eq("newest wins for today", cashNow(), 74197);
  eq("history still readable", cashAt("2026-07-01"), 50000);
})();

/* Credit card balance owed: same dated-series shape as cash reserves, and it
 * now has to come out of unallocated too — spending on the card already
 * shrank the fund it came from, but the money hasn't left the bank yet. */

sec("card owed is a point in time, same as cash");
base([{ id: "r1", date: "2026-08-01", amount: 74197 }]);
state.cardReadings = [
  { id: "k1", date: "2026-06-01", amount: 500 },
  { id: "k2", date: "2026-08-01", amount: 900 },
];
eq("today uses the newest reading", cardNow(), 900);
eq("a date before any reading is zero", cardAt("2026-01-01"), 0);
eq("between readings holds the earlier one", cardAt("2026-07-15"), 500);

sec("setCardReading behaves exactly like setCashReading");
base([{ id: "r1", date: "2026-08-01", amount: 74197 }]);
setCardReading(300, "2026-08-01", "opening balance");
eq("recorded", cardNow(), 300);
setCardReading(450, "2026-08-01", "checked again");
ok("same date corrects rather than duplicates", state.cardReadings.length === 1,
   String(state.cardReadings.length));
eq("with the corrected amount", cardNow(), 450);
setCardReading(200, "2026-06-01", "forgot to log");
ok("back-dating slots into place", state.cardReadings.map(function (r) { return r.date; }).join(",")
   === "2026-06-01,2026-08-01");
eq("later reading still wins for today", cardNow(), 450);

sec("unallocated now subtracts what's owed on the card too");
base([{ id: "r1", date: "2026-08-01", amount: 10000 }]);
eq("allocated is the fund total", allocated(), 2000);
eq("no card debt yet — same as before", unallocated(), 8000);
setCardReading(1500, "2026-08-01", "");
eq("card debt comes off unallocated", unallocated(), 6500);
ok("without touching the fund balance", balanceOfFund("f") === 2000);
ok("or the cash reading itself", cashNow() === 10000);

sec("no card debt is the default — old files are unaffected");
(function () {
  var n = normalize({ categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F" }], ledger: [] });
  ok("cardReadings defaults to empty", n.cardReadings.length === 0);
  state = n;
  eq("cardNow is zero with no readings", cardNow(), 0);
})();

sec("hardening — same coercion rules as cash");
(function () {
  var n = normalize({ categories: [], funds: [], ledger: [],
    cardReadings: [
      { id: "a", date: "2026-08-01", amount: "500" },
      { id: "b", date: "2026-07-01", amount: -20 },
      { id: "c", date: "2026-09-01", amount: "junk" },
    ] });
  eq("strings coerce", n.cardReadings.filter(function (r) { return r.id === "a"; })[0].amount, 500);
  eq("negatives clamp to zero", n.cardReadings.filter(function (r) { return r.id === "b"; })[0].amount, 0);
  eq("garbage becomes zero", n.cardReadings.filter(function (r) { return r.id === "c"; })[0].amount, 0);
  ok("sorted on load", n.cardReadings.map(function (r) { return r.date; }).join(",")
     === "2026-07-01,2026-08-01,2026-09-01");
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));
})();

sec("deleting a card reading, tombstoned like any other");
base([{ id: "r1", date: "2026-08-01", amount: 74197 }]);
state.cardReadings = [
  { id: "k1", date: "2026-06-01", amount: 500 },
  { id: "k2", date: "2026-08-01", amount: 900 },
];
state.cardReadings = state.cardReadings.filter(function (r) { return r.id !== "k2"; });
state.meta.deleted.push("k2");
eq("removing the newest falls back to the earlier one", cardNow(), 500);
ok("tombstoned", state.meta.deleted.indexOf("k2") >= 0);
var roundCard = normalize(JSON.parse(JSON.stringify(state)));
ok("and it stays gone after a reload", roundCard.cardReadings.length === 1);

sec("merge keeps card readings from both sides, same as cash");
(function () {
  var disk = { schemaVersion: 10, meta: { deleted: [] }, categories: [], funds: [], ledger: [], plans: [],
    cashReadings: [], cardReadings: [{ id: "a", date: "2026-06-01", amount: 500 }] };
  var mirror = { schemaVersion: 10, meta: { deleted: [] }, categories: [], funds: [], ledger: [], plans: [],
    cashReadings: [], cardReadings: [{ id: "b", date: "2026-08-01", amount: 900 }] };
  var m = normalize(mergeStates(disk, mirror));
  ok("both survive", m.cardReadings.length === 2, String(m.cardReadings.length));
  state = m;
  eq("newest wins for today", cardNow(), 900);
  eq("history still readable", cardAt("2026-07-01"), 500);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

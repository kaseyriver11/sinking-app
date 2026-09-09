/* Earmarks: a named claim on money a fund already holds. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function setup(plans) {
  state = normalize({
    categories: [{ id: "tv", name: "Travel" }],
    funds: [{ id: "trav", categoryId: "tv", name: "Travel", monthlyAllotment: 1000 },
            { id: "dvc", categoryId: "tv", name: "DVC Dues", monthlyAllotment: 137.83,
              schedule: { amount: 1654, months: [1] } }],
    ledger: [{ id: "l1", fundId: "trav", amount: 7000, date: "2026-08-01", note: "balance" },
             { id: "l2", fundId: "dvc", amount: 1103, date: "2026-08-01", note: "balance" }],
    plans: plans || [] });
}

sec("the Scotland case");
setup([{ id: "sc", fundId: "trav", name: "Scotland", amount: 6000, month: "2027-05" }]);
eq("the fund balance is untouched — no money moved", balanceOfFund("trav"), 7000);
ok("no ledger entry was created", state.ledger.length === 2, String(state.ledger.length));
eq("the earmark claims its amount", earmarkedOfFund("trav"), 6000);
(function () {
  var q = commitmentParts(fundById("trav"));
  eq("the earmark claims its full amount", q.earmarks, 6000);
  eq("this month's budget claims the rest", q.dueNow, 1000);
  eq("so the whole fund is spoken for", q.free, 0);
  eq("committed is both claims together", committedOfFund(fundById("trav")), 7000);
})();
eq("category rolls it up alongside the DVC bill", committedOfCat("tv"), 7964.83);
eq("only DVC's over-accumulation is spare", freeOfCat("tv"), 138.17);
eq("category balance unchanged", balanceOfCat("tv"), 8103);

sec("earmarks and a schedule coexist on one fund");
setup([{ id: "x", fundId: "dvc", name: "Extra", amount: 200, month: "2027-03" }]);
// DVC must keep $827 for its January bill; the earmark takes $200 of the rest
(function () {
  // this month's contribution is not assumed, so more of the balance must stay
  var q = commitmentParts(fundById("dvc"));
  // January is not this month, so none of it is "due now" — the bill and the
  // named plan are both money held for later, and share one bucket
  eq("nothing is due this month", q.dueNow, 0);
  eq("the bill and the plan together hold the balance", q.earmarks, 1103);
  eq("leaving nothing spare", q.free, 0);
  eq("so the whole balance is committed", committedOfFund(fundById("dvc")), 1103);
  ok("the plan alone wanted more than the fund could give it",
     earmarkedOfFund("dvc") > 0 && earmarkedOfFund("dvc") + 964.83 > 1103);
})();

sec("earmarking more than the fund holds");
setup([{ id: "big", fundId: "trav", name: "Antarctica", amount: 20000, month: "2028-01" }]);
eq("committed caps at the balance", committedOfFund(fundById("trav")), 7000);
eq("free floors at zero, never negative", balanceOfFund("trav") - committedOfFund(fundById("trav")), 0);
eq("but the earmark itself keeps its full size", earmarkedOfFund("trav"), 20000);

sec("several earmarks, soonest first");
setup([
  { id: "c", fundId: "trav", name: "Later", amount: 500, month: "2028-01" },
  { id: "a", fundId: "trav", name: "Sooner", amount: 800, month: "2026-12" },
  { id: "b", fundId: "trav", name: "Undated", amount: 300, month: "" },
]);
ok("ordered by date, undated last",
   earmarksOf("trav").map(function (p) { return p.name; }).join(",") === "Sooner,Later,Undated",
   earmarksOf("trav").map(function (p) { return p.name; }).join(","));
eq("all three claim together", earmarkedOfFund("trav"), 1600);

sec("spending an earmark");
setup([{ id: "sc", fundId: "trav", name: "Scotland", amount: 6000, month: "2027-05" }]);
settlePlan("sc", 5800, "2027-05-12");
eq("an expense is recorded for what it actually cost", balanceOfFund("trav"), 1200);
ok("the expense carries the earmark's name",
   state.ledger.some(function (e) { return e.note === "Scotland" && e.amount === -5800; }));
eq("the earmark stops claiming", earmarkedOfFund("trav"), 0);
ok("it is settled, not deleted", state.plans.length === 1 && !!state.plans[0].settledAt);
ok("and drops out of the outstanding list", earmarksOf("trav").length === 0);
eq("only the monthly budget still claims", committedOfFund(fundById("trav")), 1000);

sec("removing an earmark moves no money");
setup([{ id: "sc", fundId: "trav", name: "Scotland", amount: 6000, month: "2027-05" }]);
var before = balanceOfFund("trav");
deletePlan("sc");
eq("balance untouched", balanceOfFund("trav"), before);
ok("the plan is gone", state.plans.length === 0);
ok("and tombstoned so a merge can't revive it", state.meta.deleted.indexOf("sc") >= 0);
eq("only the monthly budget claims once the earmark goes", committedOfFund(fundById("trav")), 1000);

sec("editing");
setup([{ id: "sc", fundId: "trav", name: "Scotland", amount: 6000, month: "2027-05" }]);
updatePlan("sc", { amount: 4500, month: "2027-06" });
eq("amount updated", earmarkedOfFund("trav"), 4500);
ok("month updated", earmarksOf("trav")[0].month === "2027-06");
eq("free recalculates around both claims", balanceOfFund("trav") - committedOfFund(fundById("trav")), 1500);

sec("hardening");
(function () {
  var n = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F" }],
    ledger: [],
    plans: [
      { id: "ok", fundId: "f", name: "Fine", amount: 100, month: "2027-05" },
      { id: "orphan", fundId: "nope", name: "Orphan", amount: 50 },
      { id: "zero", fundId: "f", name: "Zero", amount: 0 },
      { id: "badmonth", fundId: "f", name: "Bad month", amount: 10, month: "nonsense" },
      { id: "strnum", fundId: "f", name: "String", amount: "250" },
    ] });
  ok("an earmark on a missing fund is dropped", !n.plans.some(function (p) { return p.id === "orphan"; }));
  ok("a zero-amount earmark is dropped", !n.plans.some(function (p) { return p.id === "zero"; }));
  ok("a bad month is blanked, not kept", n.plans.filter(function (p) { return p.id === "badmonth"; })[0].month === "");
  ok("a string amount coerces", n.plans.filter(function (p) { return p.id === "strnum"; })[0].amount === 250);
  ok("three survive", n.plans.length === 3, String(n.plans.length));
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));
})();

sec("older files without plans still load");
(function () {
  var v3 = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F" }],
    ledger: [{ id: "e", fundId: "f", amount: 100, date: "2026-08-01" }] });
  ok("plans defaults to empty", Array.isArray(v3.plans) && v3.plans.length === 0);
  ok("schemaVersion is a positive integer",
   Number.isInteger(blankState().schemaVersion) && blankState().schemaVersion >= 6,
   String(blankState().schemaVersion));
  state = v3;
  eq("nothing committed without a schedule or earmark", committedOfFund(fundById("f")), 0);
})();

sec("merge keeps earmarks and honours their tombstones");
(function () {
  var base = { schemaVersion: 4, meta: { deleted: [] },
    categories: [{ id: "c", name: "C" }], funds: [{ id: "f", categoryId: "c", name: "F" }],
    ledger: [], plans: [{ id: "p1", fundId: "f", name: "Kept", amount: 100 },
                        { id: "p2", fundId: "f", name: "Doomed", amount: 50 }] };
  var mirror = { schemaVersion: 4, meta: { deleted: ["p2"] },
    categories: base.categories, funds: base.funds, ledger: [],
    plans: [{ id: "p3", fundId: "f", name: "New", amount: 25 }] };
  var m = normalize(mergeStates(base, mirror));
  ok("an earmark only on disk survives", m.plans.some(function (p) { return p.id === "p1"; }));
  ok("one only in the browser survives", m.plans.some(function (p) { return p.id === "p3"; }));
  ok("one deleted offline stays deleted", !m.plans.some(function (p) { return p.id === "p2"; }));
  ok("two remain", m.plans.length === 2, String(m.plans.length));
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

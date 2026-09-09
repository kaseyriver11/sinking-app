/* The needs-attention list: what's wrong, worst first, dismissable per month. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function setup() {
  state = normalize({
    meta: { planStart: "2026-08" },
    categories: [{ id: "c", name: "Home" }],
    funds: [
      { id: "ok1", categoryId: "c", name: "Fine", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 100 }] },
      { id: "over", categoryId: "c", name: "Overdrawn", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 100 }] },
      { id: "spend", categoryId: "c", name: "Overspent", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 100 }] },
      { id: "sched", categoryId: "c", name: "Short fund", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 50 }],
        schedule: { amount: 600, months: [9] } },
    ],
    ledger: [
      { id: "a", fundId: "ok1", amount: 100, date: "2026-08-01", kind: "allotment" },
      { id: "b", fundId: "over", amount: -75, date: "2026-08-05" },
      { id: "c1", fundId: "spend", amount: 400, date: "2026-08-01", kind: "allotment" },
      { id: "c2", fundId: "spend", amount: -260, date: "2026-08-10" },
    ] });
  dismissed = {};
}

sec("what lands on the list");
setup();
var list = issues();
var names = list.map(function (i) { return i.fund.name; });
ok("the healthy fund is absent", names.indexOf("Fine") < 0, names.join(","));
ok("the overdrawn fund is listed", names.indexOf("Overdrawn") >= 0);
ok("the overspent fund is listed", names.indexOf("Overspent") >= 0);
ok("the short scheduled fund is listed", names.indexOf("Short fund") >= 0);
ok("three issues in total", list.length === 3, String(list.length));

sec("ordered by how much it matters");
ok("overdrawn comes first", list[0].fund.name === "Overdrawn", list[0].fund.name);
ok("ranks are non-decreasing", list.every(function (i, k) {
  return k === 0 || list[k - 1].rank <= i.rank; }),
  list.map(function (i) { return i.status.key; }).join(","));

sec("each carries what it would take to fix");
(function () {
  var s = list.filter(function (i) { return i.fund.name === "Short fund"; })[0];
  ok("a shortfall quotes an amount", s.fix > 0, String(s.fix));
  eq("  matching the fund's own gap", s.fix, cycleOutlook(fundById("sched")).gap);
  var o = list.filter(function (i) { return i.fund.name === "Overspent"; })[0];
  ok("overspending has no single fix amount", !o.fix);
})();

sec("ignoring is per month");
setup();
var key = issues()[0].key;
dismissed[key] = thisMonth();
var live = issues().filter(function (i) { return dismissed[i.key] !== thisMonth(); });
ok("the ignored one drops out", live.length === 2, String(live.length));
ok("but it is still an issue underneath", issues().length === 3);
dismissed[key] = monthShift(thisMonth(), -1);
live = issues().filter(function (i) { return dismissed[i.key] !== thisMonth(); });
ok("last month's dismissal does not carry over", live.length === 3, String(live.length));

sec("the key is stable but reflects the problem");
setup();
var before = issues().filter(function (i) { return i.fund.name === "Overdrawn"; })[0].key;
ok("keyed by fund and status", before === "over:over", before);
addEntry("over", 500, "2026-08-20", "fixed it");
var after = issues().map(function (i) { return i.fund.name; });
ok("fixing it removes it from the list", after.indexOf("Overdrawn") < 0, after.join(","));

sec("a clean set of books produces nothing");
state = normalize({
  meta: { planStart: "2026-08" },
  categories: [{ id: "c", name: "C" }],
  funds: [{ id: "f", categoryId: "c", name: "F", createdAt: "2026-01-01",
            budgets: [{ from: "2026-01", amount: 100 }] }],
  ledger: [{ id: "a", fundId: "f", amount: 100, date: "2026-08-01", kind: "allotment" }] });
ok("no issues", issues().length === 0);

sec("archived funds never appear");
setup();
updateFund("over", { archivedAt: "2026-08-26" });
ok("archiving removes it from the list",
   issues().map(function (i) { return i.fund.name; }).indexOf("Overdrawn") < 0);

/* A Fixed bill's optional due day: overdue-and-unpaid is a THIRD kind of
 * issue, neither a shortfall (needs a credit) nor a surplus (release) — it
 * needs marking paid, an expense, so it carries `pay` rather than `fix`. */

function fixedWorld(dueDay, paidAlready) {
  // Funded first, same as any real month — otherwise paying it just makes
  // the fund overdrawn, which correctly outranks "billoverdue" and would
  // mask the very thing these tests are checking.
  var ledger = [{ id: "a", fundId: "phone", amount: 60, date: "2026-08-01", kind: "allotment" }];
  if (paidAlready) ledger.push({ id: "p", fundId: "phone", amount: -60, date: "2026-08-05" });
  state = normalize({
    meta: { planStart: "2026-08" },
    categories: [{ id: "c", name: "Home" }],
    funds: [{ id: "phone", categoryId: "c", name: "Cell Phone", createdAt: "2026-01-01",
              fixed: true, dueDay: dueDay, budgets: [{ from: "2026-01", amount: 60 }] }],
    ledger: ledger });
  dismissed = {};
  return fundById("phone");
}

sec("no due day set: never flagged, whatever the balance");
(function () {
  var f = fixedWorld(0, false);
  ok("not marked overdue", !fixedPaid(f).overdue);
  ok("status is just ok, not billoverdue", baseStatus(f).key === "ok", baseStatus(f).key);
  ok("absent from the list", issues().map(function (i) { return i.fund.id; }).indexOf("phone") < 0);
})();

sec("due day set and already passed, still unpaid: billoverdue");
(function () {
  var f = fixedWorld(15, false);   // "today" is pinned to the 31st
  var fx = fixedPaid(f);
  ok("flagged overdue", fx.overdue, JSON.stringify(fx));
  ok("not merely due today", !fx.dueToday);
  var st = baseStatus(f);
  ok("status key is billoverdue, not the generic overspent/ok", st.key === "billoverdue", st.key);
  eq("carries the amount owed", st.pay, 60);

  var item = issues().filter(function (i) { return i.fund.id === "phone"; })[0];
  ok("appears in the list", !!item);
  eq("as a pay amount, not a fix", item.pay, 60);
  ok("not a fix — the wrong button would credit instead of recording an expense", !item.fix);
  eq("ranked alongside other urgent-but-not-catastrophic issues", item.rank, RANKS.short);
})();

sec("due day reached exactly today: a badge, not yet a needs-attention item");
(function () {
  var f = fixedWorld(31, false);   // "today" IS the 31st — due, not overdue
  var fx = fixedPaid(f);
  ok("due today", fx.dueToday, JSON.stringify(fx));
  ok("not overdue — the day hasn't passed, it's arrived", !fx.overdue);
  ok("status stays ok — no premature nag", baseStatus(f).key === "ok", baseStatus(f).key);
  ok("absent from the needs-attention list", issues().map(function (i) { return i.fund.id; }).indexOf("phone") < 0);
})();

sec("already paid this month: never overdue, whatever the due day");
(function () {
  var f = fixedWorld(1, true);
  ok("not overdue once paid", !fixedPaid(f).overdue);
  ok("status is ok", baseStatus(f).key === "ok", baseStatus(f).key);
})();

sec("marking it paid removes it from the list, same as any other fix");
(function () {
  fixedWorld(15, false);
  ok("starts on the list", issues().map(function (i) { return i.fund.id; }).indexOf("phone") >= 0);
  payFixed("phone");
  ok("gone once paid", issues().map(function (i) { return i.fund.id; }).indexOf("phone") < 0);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

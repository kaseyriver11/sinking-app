/* Obligations: naming what the committed money is committed to. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var M = thisMonth(), NEXT = monthShift(M, 1);
var sum = function (rows) { return rows.reduce(function (a, r) { return a + r.amount; }, 0); };
var kinds = function (k) { return obligations().filter(function (r) { return r.kind === k; }); };

function world(funds, plans, ledger) {
  state = normalize({ meta: { planStart: "2025-01" },
    cashReadings: [{ id: "r", date: "2025-01-01", amount: 50000 }],
    categories: [{ id: "c", name: "Home" }, { id: "d", name: "Travel" }],
    funds: funds, plans: plans || [], ledger: ledger || [] });
}
var give = function (fundId, amt) {
  return { id: "g" + fundId, fundId: fundId, amount: amt, date: "2026-01-01" }; };

sec("THE INVARIANT: the rows always add up to what the rail says is committed");
(function () {
  world([
    { id: "tax", categoryId: "c", name: "Property Taxes", createdAt: "2025-01-01",
      schedule: { amount: 6000, months: [9] } },
    { id: "pre", categoryId: "c", name: "Preschool", createdAt: "2025-01-01",
      schedule: { amount: 315, months: [1,2,3,4,5,9,10,11,12] } },
    { id: "gro", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
      budgets: [{ from: "2025-01", amount: 1390 }] },
    { id: "hea", categoryId: "c", name: "Healthcare", createdAt: "2025-01-01",
      buffer: true, floor: 1000, budgets: [{ from: "2025-01", amount: 250 }] },
    { id: "tra", categoryId: "d", name: "Travel", createdAt: "2025-01-01" },
  ], [{ id: "p1", fundId: "tra", name: "Scotland", amount: 6000, month: "2027-05" }],
     [give("tax", 5670), give("pre", 708.75), give("gro", 1390),
      give("hea", 2000), give("tra", 7000)]);

  eq("every obligation accounted for", sum(obligations()), partsTotal().committed);
  ok("and there is something to show", obligations().length >= 5, String(obligations().length));
})();

sec("each kind is named and dated");
(function () {
  var byWhat = {};
  obligations().forEach(function (r) { byWhat[r.what] = r; });

  var tax = byWhat["Bill due Sep"];
  ok("a once-a-year bill reads as a date", !!tax, Object.keys(byWhat).join(" | "));
  // NOT the whole $5,670 balance: the curve only needs $5,500 by now, so the
  // extra $170 stays free rather than being reported as spoken for
  eq("  holding what the cycle needs", tax.amount, 5500);
  eq("  the surplus above the curve stays free", commitmentParts(fundById("tax")).free, 170);
  ok("  dated to the bill month", tax.when === "2026-09", tax.when);
  ok("  and knows its fund", tax.fund === "Property Taxes", tax.fund);

  var pre = obligations().filter(function (r) { return r.fund === "Preschool"; })[0];
  ok("a run of bills reads as a stretch", /^Bills through /.test(pre.what), pre.what);

  var sc = byWhat["Scotland"];
  ok("an earmark keeps its own name", !!sc);
  eq("  at its full amount", sc.amount, 6000);
  ok("  on its own month", sc.when === "2027-05", sc.when);
  ok("  labelled an earmark", sc.kind === "earmark", sc.kind);

  var res = obligations().filter(function (r) { return r.kind === "reserve"; })[0];
  ok("a buffer floor is a reserve", !!res);
  eq("  worth the whole balance, not just the floor", res.amount, 2000);
  ok("  with no date — it is open-ended", res.when === "", res.when);

  var bud = obligations().filter(function (r) { return r.kind === "budget"; })[0];
  ok("this month's budget appears", !!bud);
  ok("  dated to this month", bud.when === M, bud.when);
})();

sec("sorted by when the money is wanted, not by size");
(function () {
  var w = obligations().map(function (r) { return r.when || "9999-99"; });
  var sorted = w.slice().sort();
  ok("soonest first", JSON.stringify(w) === JSON.stringify(sorted), w.join(","));
  ok("the open-ended reserve sorts last",
     obligations()[obligations().length - 1].kind === "reserve",
     obligations()[obligations().length - 1].kind);
})();

sec("a once-a-year bill is dated to when it's actually due, not to next calendar month");
(function () {
  // The bug: `when` was hardcoded to monthShift(mk, 1) regardless of the
  // bill's real due month. That went unnoticed because the suite's other
  // fixture happens to have its bill land in exactly "next month" — so this
  // one deliberately puts the due month several months out, where the two
  // values diverge, the way a real January bill checked in August did.
  var far = monthShift(M, 4);
  world([{ id: "ins", categoryId: "c", name: "Insurance", createdAt: "2025-01-01",
    schedule: { amount: 1300, months: [Number(far.slice(5, 7))] } }],
    [], [give("ins", 800)]);
  var row = obligations().filter(function (r) { return r.fund === "Insurance"; })[0];
  ok("found the row", !!row);
  ok("dated to the real due month, not next month",
     row.when === far && row.when !== NEXT, row.when + " (want " + far + ", not " + NEXT + ")");
  ok("the label agrees with the date", row.what === "Bill due " + monthLabel(far), row.what);
})();

sec("a fund that can't cover its own earmarks says so");
(function () {
  world([{ id: "tra", categoryId: "d", name: "Travel", createdAt: "2025-01-01" }],
        [{ id: "p1", fundId: "tra", name: "Scotland", amount: 6000, month: "2027-05" },
         { id: "p2", fundId: "tra", name: "Japan", amount: 4000, month: "2027-09" }],
        [give("tra", 7000)]);
  var rows = obligations();
  eq("still reconciles", sum(rows), partsTotal().committed);
  eq("the nearer earmark is covered in full", rows[0].amount, 6000);
  ok("  and is not flagged short", !rows[0].shortOf, String(rows[0].shortOf));
  eq("the later one gets what's left", rows[1].amount, 1000);
  eq("  and reports the full ask", rows[1].shortOf, 4000);
  eq("nothing is invented", sum(rows), 7000);
})();

sec("an empty or uncommitted world produces an empty list");
(function () {
  world([{ id: "x", categoryId: "c", name: "Slush", createdAt: "2025-01-01" }], [], [give("x", 500)]);
  eq("no obligations", obligations().length, 0);
  eq("  and nothing committed to reconcile against", partsTotal().committed, 0);
  eq("  the money is simply free", partsTotal().free, 500);

  world([], [], []);
  eq("no funds at all", obligations().length, 0);
})();

sec("archived funds drop out, and settled earmarks with them");
(function () {
  world([{ id: "tra", categoryId: "d", name: "Travel", createdAt: "2025-01-01",
           archivedAt: "2026-02-01" }],
        [{ id: "p1", fundId: "tra", name: "Scotland", amount: 6000, month: "2027-05" }],
        [give("tra", 7000)]);
  eq("an archived fund contributes nothing", obligations().length, 0);

  world([{ id: "tra", categoryId: "d", name: "Travel", createdAt: "2025-01-01" }],
        [{ id: "p1", fundId: "tra", name: "Scotland", amount: 6000, month: "2027-05",
           settledAt: "2026-03-01" }],
        [give("tra", 7000)]);
  eq("a settled earmark is done with", kinds("earmark").length, 0);
})();

sec("an overdrawn fund can't commit money it hasn't got");
(function () {
  world([{ id: "tax", categoryId: "c", name: "Property Taxes", createdAt: "2025-01-01",
           schedule: { amount: 6000, months: [9] } }], [], [give("tax", -200)]);
  eq("nothing is claimed against a negative balance", sum(obligations()), 0);
  eq("  matching the rail", partsTotal().committed, 0);
})();

sec("it survives every fund kind at once without double-counting");
(function () {
  world([
    { id: "tax", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
      schedule: { amount: 6000, months: [9] } },
    { id: "hea", categoryId: "c", name: "Healthcare", createdAt: "2025-01-01",
      buffer: true, floor: 500, budgets: [{ from: "2025-01", amount: 250 }] },
    { id: "gro", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
      budgets: [{ from: "2025-01", amount: 300 }] },
    { id: "lap", categoryId: "c", name: "Laptop", createdAt: "2025-01-01", target: 2400 },
  ], [{ id: "p1", fundId: "gro", name: "Big shop", amount: 100, month: NEXT }],
     [give("tax", 3000), give("hea", 900), give("gro", 400), give("lap", 1000)]);
  eq("reconciles across all four kinds", sum(obligations()), partsTotal().committed);
  eq("  one reserve", kinds("reserve").length, 1);
  ok("  the plan and the later bills are both 'for later'", kinds("earmark").length >= 1,
     String(kinds("earmark").length));
  ok("  every kind is one the legend knows",
     obligations().every(function (r) { return ["budget","earmark","reserve"].indexOf(r.kind) >= 0; }),
     obligations().map(function (r) { return r.kind; }).join(","));
  ok("  no row is negative", obligations().every(function (r) { return r.amount > 0; }));
  ok("  every row names a fund", obligations().every(function (r) { return !!r.fund; }));
  ok("  every row names a kind we can colour",
     obligations().every(function (r) {
       return ["bill", "earmark", "reserve", "budget"].indexOf(r.kind) >= 0; }));
})();


sec("the view collapses budget rows but must not lose a penny");
(function () {
  world([
    { id: "a", categoryId: "c", name: "Netflix", createdAt: "2025-01-01",
      budgets: [{ from: "2025-01", amount: 15 }] },
    { id: "b", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
      budgets: [{ from: "2025-01", amount: 300 }] },
    { id: "e", categoryId: "c", name: "Spotify", createdAt: "2025-01-01",
      budgets: [{ from: "2025-01", amount: 11 }] },
    { id: "t", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
      schedule: { amount: 1200, months: [9] } },
  ], [], [give("a", 15), give("b", 300), give("e", 11), give("t", 600)]);

  // mirrors what the dialog does before rendering
  var all = obligations();
  var buds = all.filter(function (r) { return r.kind === "budget"; });
  var shown = all.filter(function (r) { return r.kind !== "budget"; });
  if (buds.length) shown.push({ kind: "budget", when: buds[0].when,
    amount: buds.reduce(function (a, r) { return a + r.amount; }, 0) });

  eq("three separate budgets in the data", buds.length, 3);
  eq("one row in the view", shown.filter(function (r) { return r.kind === "budget"; }).length, 1);
  eq("carrying their combined value", shown.filter(function (r) {
    return r.kind === "budget"; })[0].amount, 326);
  eq("the collapsed view still reconciles", sum(shown), partsTotal().committed);
  eq("  exactly as the uncollapsed data does", sum(all), sum(shown));
  ok("nothing but the budget rows is collapsed",
     shown.filter(function (r) { return r.kind === "earmark"; }).length
       === all.filter(function (r) { return r.kind === "earmark"; }).length);
})();


sec("the legend never advertises a colour the bar doesn't draw");
(function () {
  // mirrors how the dialog builds its segments
  var build = function () {
    var all = obligations(), p = partsTotal();
    return [{ label: "This month", value: p.dueNow },
            { label: "Earmarks", value: p.earmarks },
            { label: "Sinking", value: p.reserve },
            { label: "Free", value: p.free }]
      .filter(function (x) { return x.value > 0.005; });
  };

  // the reported bug: no earmarks anywhere, yet a blue "Earmarks" swatch showed
  world([{ id: "t", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
           schedule: { amount: 1200, months: [9] } }], [], [give("t", 600)]);
  var segs = build();
  ok("no sinking segment when there are no sinking funds",
     !segs.some(function (x) { return x.label === "Sinking"; }),
     segs.map(function (x) { return x.label; }).join(","));
  ok("every segment shown has a real value",
     segs.every(function (x) { return x.value > 0.005; }));

  // and when they DO exist, they appear
  world([{ id: "t", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
           schedule: { amount: 1200, months: [9] } },
         { id: "h", categoryId: "c", name: "Health", createdAt: "2025-01-01",
           buffer: true, floor: 300 },
         { id: "v", categoryId: "d", name: "Travel", createdAt: "2025-01-01" }],
        [{ id: "p1", fundId: "v", name: "Scotland", amount: 900, month: "2027-05" }],
        [give("t", 600), give("h", 400), give("v", 1000)]);
  var segs2 = build();
  ok("earmarks appear once they exist",
     segs2.some(function (x) { return x.label === "Earmarks"; }),
     segs2.map(function (x) { return x.label; }).join(","));
  ok("  as do sinking funds", segs2.some(function (x) { return x.label === "Sinking"; }));

  // the bar's own total is the allocated figure, NOT the bank
  var span = segs2.reduce(function (a, x) { return a + x.value; }, 0);
  eq("the segments span exactly what is allocated to funds", span, allocated());
  ok("  which is far less than the bank holds", cashNow() > allocated(),
     money0(cashNow()) + " vs " + money0(allocated()));
  eq("  committed plus free is the same thing",
     partsTotal().committed + partsTotal().free, allocated());
})();


sec("a contingency fund is not a discretionary one");
(function () {
  // the reported case: Auto Maintenance, floor $1,000, holding $1,150
  world([{ id: "a", categoryId: "c", name: "Auto Maintenance", createdAt: "2025-01-01",
           buffer: true, floor: 1000, budgets: [{ from: "2025-01", amount: 100 }] },
         { id: "t", categoryId: "d", name: "Travel", createdAt: "2025-01-01" }],
        [], [give("a", 1150), give("t", 1150)]);

  var auto = commitmentParts(fundById("a"));
  eq("the whole balance is reserved", auto.reserve, 1150);
  eq("  not $150 of it free", auto.free, 0);
  eq("  and none of it filed as bills", auto.dueNow, 0);

  var trav = commitmentParts(fundById("t"));
  eq("identical money in a discretionary fund IS free", trav.free, 1150);
  eq("  with nothing reserved", trav.reserve, 0);
  ok("same balance, opposite meaning",
     balanceOfFund("a") === balanceOfFund("t") && auto.free !== trav.free);

  // and the obligations list says which is which
  var res = obligations().filter(function (r) { return r.kind === "reserve"; });
  eq("the reserve is listed", res.length, 1);
  eq("  at the full balance", res[0].amount, 1150);
  ok("  described as a sinking fund, not as a bill",
     /^Sinking fund/.test(res[0].what), res[0].what);
  ok("  and never as a bill or a budget",
     !/bill|budget/i.test(res[0].what), res[0].what);
  ok("  the discretionary fund raises no obligation",
     !obligations().some(function (r) { return r.fund === "Travel"; }));
  eq("still reconciles", sum(obligations()), partsTotal().committed);
})();

sec("the reserve is its own bucket, everywhere it is totalled");
(function () {
  world([{ id: "a", categoryId: "c", name: "Auto", createdAt: "2025-01-01",
           buffer: true, floor: 500 },
         { id: "x", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
           schedule: { amount: 1200, months: [9] } }], [], [give("a", 800), give("x", 600)]);
  var t = partsTotal();
  eq("reserves roll up on their own", t.reserve, 800);
  ok("  later bills are their own figure", t.earmarks > 0, String(t.earmarks));
  eq("  committed is the sum of the buckets",
     t.dueNow + t.earmarks + t.reserve, t.committed);
  eq("  committed plus free is the balance", t.committed + t.free, allocated());
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

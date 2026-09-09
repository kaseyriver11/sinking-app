/* The commitment split, bucketed by WHEN the money is needed. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var M = thisMonth();

function setup(ledger, plans) {
  state = normalize({
    categories: [{ id: "h", name: "House" }],
    funds: [
      { id: "tax", categoryId: "h", name: "Property Taxes", monthlyAllotment: 472.50,
        schedule: { amount: 5670, months: [9] } },
      { id: "gas", categoryId: "h", name: "House Gas", monthlyAllotment: 100,
        schedule: { amounts: [50,50,50,50,50,50,50,50,50,50,50,650] } },
      { id: "food", categoryId: "h", name: "Groceries", monthlyAllotment: 1500 },
      { id: "trav", categoryId: "h", name: "Travel", monthlyAllotment: 1000 },
      { id: "car", categoryId: "h", name: "Car repairs", monthlyAllotment: 200, buffer: true },
    ],
    ledger: ledger, plans: plans || [] });
}
var credit = function (id, amt) {
  return { id: "c" + id, fundId: id, amount: amt, date: M + "-01", kind: "allotment" }; };

sec("THE RULE: soonest claim first — this month, then later, then undated");
setup([credit("food", 1500)]);
var p = commitmentParts(fundById("food"));
eq("this month's unspent budget is due now", p.dueNow, 1500);
eq("  nothing is for later", p.earmarks, 0);
eq("  nothing is spare", p.free, 0);
eq("  committed equals it", p.committed, 1500);

sec("spending drops out of 'due now' — that is the whole point");
setup([credit("food", 1500), { id: "s", fundId: "food", amount: -600, date: M + "-10" }]);
p = commitmentParts(fundById("food"));
eq("balance after spending", balanceOfFund("food"), 900);
eq("only what is still to be paid counts", p.dueNow, 900);
eq("  nothing spare", p.free, 0);

setup([credit("food", 1500), { id: "s", fundId: "food", amount: -1500, date: M + "-10" }]);
eq("a fully spent budget owes nothing this month", commitmentParts(fundById("food")).dueNow, 0);

sec("a Varying fund splits: this month's slice vs the rest of the cycle");
// House Gas: $50 due every month except a $650 December. Holding $454.
setup([credit("gas", 454)]);
p = commitmentParts(fundById("gas"));
eq("this month's bill is due now", p.dueNow, 50);
ok("  and the rest is held for later bills", p.earmarks > 0, String(p.earmarks));
eq("  the two account for everything committed", p.dueNow + p.earmarks, p.committed);
eq("  and with free, for the whole balance", p.committed + p.free, 454);

// once this month's bill is paid, it leaves 'due now' entirely
setup([credit("gas", 454), { id: "s", fundId: "gas", amount: -50, date: M + "-05" }]);
p = commitmentParts(fundById("gas"));
eq("a paid bill is no longer due", p.dueNow, 0);
eq("  the remainder is all for later", p.earmarks, p.committed);

sec("a Varying fund with nothing due this month owes nothing now");
setup([credit("tax", 5670)]);
p = commitmentParts(fundById("tax"));
eq("the September bill is not due in August", p.dueNow, 0);
eq("  it is all held for later", p.earmarks, 5197.50);
eq("  over-accumulation is still spare", p.free, 472.50);
ok("  which matches the cycle's low point",
   Math.abs(cycleOutlook(fundById("tax")).lowest - p.free) < 0.02,
   String(cycleOutlook(fundById("tax")).lowest));

sec("a rolled-over Budget fund keeps one month and frees the rest");
setup([credit("trav", 7000)]);
p = commitmentParts(fundById("trav"));
eq("one month is due", p.dueNow, 1000);
eq("  the rest is genuinely free", p.free, 6000);

sec("a Sinking fund is all reserve, whatever the month");
setup([credit("car", 3000)]);
p = commitmentParts(fundById("car"));
eq("nothing is due this month — it is not a bill", p.dueNow, 0);
eq("  all of it is reserve", p.reserve, 3000);
eq("  none of it free", p.free, 0);

sec("when money is short, the soonest claim wins");
setup([credit("food", 400)], [{ id: "e", fundId: "food", name: "Party", amount: 1000, month: "2026-12" }]);
p = commitmentParts(fundById("food"));
eq("this month takes what there is", p.dueNow, 400);
eq("  December's earmark gets nothing", p.earmarks, 0);
eq("  and nothing is free", p.free, 0);
eq("  claims never exceed the balance", p.committed, 400);

sec("parts always reconstruct the balance");
[[[credit("food", 2400)], null],
 [[credit("trav", 500)], null],
 [[credit("tax", 100)], null],
 [[credit("gas", 20)], null],
 [[credit("car", 900)], null],
 [[credit("food", 300)], [{ id: "e", fundId: "food", name: "P", amount: 90, month: "2027-01" }]],
 [[], null]].forEach(function (fx, i) {
  setup(fx[0], fx[1]);
  allFunds().forEach(function (f) {
    var q = commitmentParts(f);
    eq("  case " + i + " " + f.name + ": parts sum to the balance",
       q.dueNow + q.earmarks + q.reserve + q.free, Math.max(0, balanceOfFund(f.id)));
    ok("  case " + i + " " + f.name + ": no part is negative",
       q.dueNow >= 0 && q.earmarks >= 0 && q.reserve >= 0 && q.free >= 0);
    eq("  case " + i + " " + f.name + ": committed is the three claims",
       q.committed, q.dueNow + q.earmarks + q.reserve);
  });
});

sec("a negative balance commits nothing");
setup([{ id: "a", fundId: "food", amount: -200, date: M + "-01" }]);
p = commitmentParts(fundById("food"));
eq("no claims", p.committed, 0);
eq("no free either", p.free, 0);

sec("roll-ups");
setup([credit("tax", 5670), credit("food", 1500), credit("trav", 7000)]);
var cp = partsOfCat("h");
eq("this month rolls up across funds", cp.dueNow, 2500);
eq("later bills roll up", cp.earmarks, 5197.50);
eq("free rolls up", cp.free, 6472.50);
eq("committed is the sum of the claims", cp.committed, 7697.50);
eq("everything reconciles to the category balance", cp.committed + cp.free, balanceOfCat("h"));
eq("one category means the total agrees", partsTotal().committed, cp.committed);
eq("committedOfCat agrees", committedOfCat("h"), 7697.50);
eq("freeOfCat agrees", freeOfCat("h"), 6472.50);

sec("archived funds stay out");
updateFund("trav", { archivedAt: M + "-25" });
eq("free drops with the archived fund", partsOfCat("h").free, 472.50);
eq("so does its share of this month", partsOfCat("h").dueNow, 1500);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

/* Monthly income vs what the plan costs. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function setup(income, budgets) {
  state = normalize({
    meta: { incomes: [{ from: "1970-01", amount: income }] },
    categories: budgets.map(function (b, i) { return { id: "c" + i, name: b[0] }; }),
    funds: budgets.map(function (b, i) {
      return { id: "f" + i, categoryId: "c" + i, name: b[0], monthlyAllotment: b[1] }; }),
    ledger: [] });
}

sec("the arithmetic");
setup(8000, [["Utilities", 578], ["Groceries", 1542], ["Travel", 1138]]);
eq("total budgeted sums every fund", totalBudgeted(), 3258);
eq("leftover is income minus budget", leftover(), 4742);
eq("per-category budget rolls up", budgetOfCat("c1"), 1542);

sec("living beyond your means");
setup(3000, [["Rent", 2000], ["Food", 900], ["Car", 600]]);
eq("budgeted exceeds income", totalBudgeted(), 3500);
ok("leftover goes negative", leftover() < 0, String(leftover()));
eq("  by the right amount", leftover(), -500);

sec("exactly balanced");
setup(3500, [["Rent", 2000], ["Food", 1500]]);
eq("nothing left, nothing over", leftover(), 0);
ok("not treated as overspending", leftover() >= 0);

sec("no income set");
setup(0, [["Rent", 2000]]);
eq("income defaults to zero", incomeAt(), 0);
eq("budget still totals", totalBudgeted(), 2000);
eq("leftover reads as negative budget, which the UI suppresses", leftover(), -2000);

sec("scheduled funds contribute their LEVEL cost, not the bill");
(function () {
  state = normalize({
    meta: { monthlyIncome: 5000 },
    categories: [{ id: "c", name: "House" }],
    funds: [{ id: "tax", categoryId: "c", name: "Property Taxes", monthlyAllotment: 472.50,
              schedule: { amount: 5670, months: [9] } }],
    ledger: [] });
  eq("the monthly figure is what counts", totalBudgeted(), 472.50);
  ok("not the $5,670 bill", totalBudgeted() < 1000);
  eq("leftover reflects that", leftover(), 4527.50);
})();

sec("archived funds drop out of the plan");
setup(8000, [["A", 1000], ["B", 2000]]);
eq("both counted", totalBudgeted(), 3000);
updateFund("f1", { archivedAt: "2026-08-25" });
eq("archived one excluded", totalBudgeted(), 1000);
eq("leftover grows", leftover(), 7000);

sec("income survives a round-trip");
(function () {
  var n = normalize({ meta: { monthlyIncome: 8250.55 }, categories: [], funds: [], ledger: [] });
  state = n;
  eq("a pre-v6 scalar migrates into the series", incomeAt(), 8250.55);
  ok("as a single dated entry", n.meta.incomes.length === 1, String(n.meta.incomes.length));
  ok("the scalar is gone", n.meta.monthlyIncome === undefined);
  state = normalize({}); ok("missing defaults to nothing", incomeAt() === 0);
  state = normalize({ meta: { monthlyIncome: "8000" } }); ok("a string coerces", incomeAt() === 8000);
  state = normalize({ meta: { monthlyIncome: "abc" } }); ok("garbage becomes 0", incomeAt() === 0);
  state = normalize({ meta: { monthlyIncome: -500 } }); ok("negative clamps to 0", incomeAt() === 0);
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));
})();

sec("shares add up");
setup(8000, [["A", 2000], ["B", 1000], ["C", 500]]);
(function () {
  var segs = cats().map(function (c) { return budgetOfCat(c.id); });
  var left = leftover();
  var denom = Math.max(incomeAt(), totalBudgeted());
  var pct = segs.concat([left]).reduce(function (s, v) { return s + v / denom * 100; }, 0);
  eq("category shares plus leftover make 100%", pct, 100);
})();
setup(3000, [["A", 2000], ["B", 1500]]);
(function () {
  var denom = Math.max(incomeAt(), totalBudgeted());
  eq("when overspending, the denominator is the budget", denom, 3500);
  var pct = cats().reduce(function (s, c) { return s + budgetOfCat(c.id) / denom * 100; }, 0);
  eq("  and the segments fill the whole bar", pct, 100);
})();


sec("spending vs holding");
(function () {
  state = normalize({
    meta: { monthlyIncome: 8000 },
    categories: [{ id: "u", name: "Utilities" }],
    funds: [
      { id: "water", categoryId: "u", name: "Water", monthlyAllotment: 200 },
      { id: "power", categoryId: "u", name: "Power", monthlyAllotment: 210 },
      { id: "trash", categoryId: "u", name: "Trash", monthlyAllotment: 33.33,
        schedule: { amount: 100, months: [3,6,9,12] } },
    ], ledger: [] });

  eq("spending is the funds without a schedule", monthlySpending(), 410);
  eq("holding is the funds with one", monthlyHolding(), 33.33);
  eq("together they are the whole plan", monthlySpending() + monthlyHolding(), totalBudgeted());
  eq("leftover is unchanged by the split", leftover(), 8000 - 443.33);

  // the split is per FUND — one category holds both kinds
  eq("category spending", catSpending("u"), 410);
  eq("category holding", catHolding("u"), 33.33);
  eq("  and they reconcile to its budget", catSpending("u") + catHolding("u"), budgetOfCat("u"));
  ok("a single category genuinely contains both", catSpending("u") > 0 && catHolding("u") > 0);
})();

sec("all one type");
(function () {
  state = normalize({ meta: { monthlyIncome: 5000 },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "a", categoryId: "c", name: "A", monthlyAllotment: 500 }], ledger: [] });
  eq("no schedules means nothing held", monthlyHolding(), 0);
  eq("it's all spending", monthlySpending(), 500);

  state = normalize({ meta: { monthlyIncome: 5000 },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "a", categoryId: "c", name: "A", monthlyAllotment: 400,
              schedule: { amount: 4800, months: [12] } }], ledger: [] });
  eq("all scheduled means no spending", monthlySpending(), 0);
  eq("it's all holding", monthlyHolding(), 400);
})();

sec("holding uses the LEVEL contribution, never the bill");
(function () {
  state = normalize({ meta: { monthlyIncome: 8000 },
    categories: [{ id: "c", name: "House" }],
    funds: [{ id: "tax", categoryId: "c", name: "Property Taxes", monthlyAllotment: 472.50,
              schedule: { amount: 5670, months: [9] } }], ledger: [] });
  eq("holding is the monthly figure", monthlyHolding(), 472.50);
  ok("not the bill", monthlyHolding() < 1000);
  eq("so the month stays affordable", leftover(), 7527.50);
})();

sec("archived funds leave both buckets");
(function () {
  state = normalize({ meta: { monthlyIncome: 8000 },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "a", categoryId: "c", name: "A", monthlyAllotment: 300 },
            { id: "b", categoryId: "c", name: "B", monthlyAllotment: 100,
              schedule: { amount: 1200, months: [1] } }], ledger: [] });
  eq("spending before", monthlySpending(), 300);
  eq("holding before", monthlyHolding(), 100);
  updateFund("a", { archivedAt: "2026-08-25" });
  updateFund("b", { archivedAt: "2026-08-25" });
  eq("spending after", monthlySpending(), 0);
  eq("holding after", monthlyHolding(), 0);
  eq("plan empties", totalBudgeted(), 0);
})();


sec("correcting a bill: $490 -> $315");
(function () {
  var NINE = [1,2,3,4,5,9,10,11,12];
  state = normalize({
    meta: { incomes: [{ from: "2026-01", amount: 8000 }] },
    categories: [{ id: "k", name: "Children" }],
    funds: [{ id: "pre", categoryId: "k", name: "Alfie Preschool", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 367.50 }],
              schedule: { amount: 490, months: NINE } }],
    ledger: [{ id: "a", fundId: "pre", amount: 490, date: "2026-08-01", kind: "allotment" }] });
  var f = fundById("pre");

  eq("before: monthly", budgetOfFund(f), 367.50);
  eq("before: annual", scheduleInfo(f).annual, 4410);
  eq("before: all of it is committed", committedOfFund(f), 490);
  eq("before: nothing free", commitmentParts(f).free, 0);

  // the correction, exactly as the dialog performs it
  updateFund("pre", { schedule: normalizeSchedule({ amount: 315, months: NINE }) });
  var info = scheduleInfo(fundById("pre"));
  setBudget(fundById("pre"), Math.round(info.monthly * 100) / 100, "2026-09");

  f = fundById("pre");
  eq("after: annual", scheduleInfo(f).annual, 2835);
  eq("after: monthly from September", budgetOfFund(f, "2026-09"), 236.25);
  eq("AUGUST KEEPS THE OLD FIGURE", budgetOfFund(f, "2026-08"), 367.50);
  eq("the balance itself is untouched", balanceOfFund("pre"), 490);
  // the fund is BELOW its steady state, so nothing is spare — every dollar is
  // needed and it still runs short later
  eq("all of it must stay", committedOfFund(f), 490);
  eq("nothing is free", commitmentParts(f).free, 0);
  // the next bill is covered, but the fund is still under its steady state —
  // this is exactly the confusion the whole-cycle view was added to resolve
  ok("the next bill is covered", projection(f).shortfall === 0);
  ok("yet the fund is flagged as running out later",
     fundStatus(f).key === "behind", fundStatus(f).key);
  eq("by the gap to its steady state", cycleOutlook(f).gap, 218.75);
  eq("which is how far below zero it would go", cycleOutlook(f).lowest, -218.75);
  eq("the plan gets cheaper from September", totalBudgeted("2026-09"), 236.25);
  eq("but August's plan is unchanged", totalBudgeted("2026-08"), 367.50);
  eq("there is no surplus to release", 0, balanceOfFund("pre") - committedOfFund(f));

  // topping up to the steady state is what actually makes it safe
  addEntry("pre", cycleOutlook(f).gap, "2026-08-26", "Catch-up");
  f = fundById("pre");
  eq("now on the line", cycleOutlook(f).gap, 0);
  eq("balance is the steady state", balanceOfFund("pre"), 708.75);
  eq("all of it is committed — it is the school year's buffer",
     commitmentParts(f).free, 0);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

/* Dated budgets and income: changing today must not rewrite the past. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function base() {
  state = normalize({
    meta: { incomes: [{ from: "2026-01", amount: 8000 }] },
    categories: [{ id: "c", name: "Home" }],
    funds: [{ id: "food", categoryId: "c", name: "Groceries", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 1500 }] }],
    ledger: [] });
  return fundById("food");
}

sec("a budget is a point in time");
var f = base();
eq("current value", budgetOfFund(f), 1500);
eq("its starting month", budgetOfFund(f, "2026-01"), 1500);
eq("before it existed, zero", budgetOfFund(f, "2025-12"), 0);
setBudget(f, 1600, "2026-09");
eq("September onward uses the new figure", budgetOfFund(f, "2026-09"), 1600);
eq("later months too", budgetOfFund(f, "2027-03"), 1600);
eq("MARCH IS UNTOUCHED", budgetOfFund(f, "2026-03"), 1500);
eq("August too", budgetOfFund(f, "2026-08"), 1500);
ok("both entries stored", f.budgets.length === 2, String(f.budgets.length));

sec("was March over budget? asked of March's budget");
f = base();
addEntry("food", 1500, "2026-03-01", "March", "allotment");
addEntry("food", -1550, "2026-03-20", "overspent");
eq("March spend", monthStats({ fund: "food" }, "2026-03").spent, 1550);
ok("over the $1,500 that applied then",
   monthStats({ fund: "food" }, "2026-03").spent > budgetOfFund(f, "2026-03"));
setBudget(f, 1600, "2026-09");
ok("raising it in September does NOT retroactively excuse March",
   monthStats({ fund: "food" }, "2026-03").spent > budgetOfFund(f, "2026-03"),
   "budget then was " + budgetOfFund(f, "2026-03"));
ok("but September's own budget is the higher one", budgetOfFund(f, "2026-09") === 1600);

sec("editing the same month corrects it");
f = base();
setBudget(f, 1600, "2026-09");
setBudget(f, 1700, "2026-09");
ok("still two entries, not three", f.budgets.length === 2, String(f.budgets.length));
eq("with the corrected figure", budgetOfFund(f, "2026-09"), 1700);

sec("a no-op change collapses");
f = base();
setBudget(f, 1500, "2026-09");
ok("re-stating the same amount adds nothing", f.budgets.length === 1, String(f.budgets.length));
eq("and the value is unchanged", budgetOfFund(f), 1500);

sec("back-dating");
f = base();
setBudget(f, 1200, "2025-06");
ok("three entries", f.budgets.length === 2, String(f.budgets.length));
eq("the earlier period gets the back-dated figure", budgetOfFund(f, "2025-08"), 1200);
eq("the original still applies from its month", budgetOfFund(f, "2026-05"), 1500);

sec("roll-ups respect the date");
state = normalize({
  meta: { incomes: [{ from: "2026-01", amount: 8000 }] },
  categories: [{ id: "c", name: "Home" }],
  funds: [
    { id: "a", categoryId: "c", name: "A", createdAt: "2026-01-01",
      budgets: [{ from: "2026-01", amount: 100 }, { from: "2026-09", amount: 300 }] },
    { id: "b", categoryId: "c", name: "B", createdAt: "2026-01-01",
      budgets: [{ from: "2026-01", amount: 50 }] },
  ], ledger: [] });
eq("category budget in March", budgetOfCat("c", "2026-03"), 150);
eq("category budget in September", budgetOfCat("c", "2026-09"), 350);
eq("total in March", totalBudgeted("2026-03"), 150);
eq("total in September", totalBudgeted("2026-09"), 350);
eq("spending split follows the date", monthlySpending("2026-03"), 150);
eq("  and updates later", monthlySpending("2026-09"), 350);

sec("income is dated the same way");
state = normalize({ meta: { incomes: [{ from: "2026-01", amount: 8000 }] },
  categories: [], funds: [], ledger: [] });
eq("current income", incomeAt(), 8000);
eq("in March", incomeAt("2026-03"), 8000);
eq("before it was set", incomeAt("2025-01"), 0);
setIncome(9000, "2026-09");
eq("September onward", incomeAt("2026-09"), 9000);
eq("MARCH IS UNTOUCHED", incomeAt("2026-03"), 8000);
ok("both kept", state.meta.incomes.length === 2, String(state.meta.incomes.length));
setIncome(9000, "2026-10");
ok("a repeat of the same figure collapses", state.meta.incomes.length === 2,
   String(state.meta.incomes.length));

sec("leftover is computed per month");
state = normalize({
  meta: { incomes: [{ from: "2026-01", amount: 8000 }, { from: "2026-09", amount: 9000 }] },
  categories: [{ id: "c", name: "C" }],
  funds: [{ id: "a", categoryId: "c", name: "A", createdAt: "2026-01-01",
            budgets: [{ from: "2026-01", amount: 1000 }, { from: "2026-09", amount: 2000 }] }],
  ledger: [] });
eq("March: 8000 - 1000", leftover("2026-03"), 7000);
eq("September: 9000 - 2000", leftover("2026-09"), 7000);
ok("the two months differ in their components",
   incomeAt("2026-03") !== incomeAt("2026-09") && totalBudgeted("2026-03") !== totalBudgeted("2026-09"));

sec("migration from the pre-v6 scalars");
(function () {
  var n = normalize({
    meta: { monthlyIncome: 8000, createdAt: "2026-02-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F", monthlyAllotment: 1500, createdAt: "2026-02-01" }],
    ledger: [] });
  state = n;
  ok("fund budget became a series", n.funds[0].budgets.length === 1);
  eq("with the old value", budgetOfFund(n.funds[0]), 1500);
  ok("dated from when the fund was created", n.funds[0].budgets[0].from === "2026-02",
     n.funds[0].budgets[0].from);
  ok("the scalar is gone", n.funds[0].monthlyAllotment === undefined);
  eq("income migrated too", incomeAt(), 8000);
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));
})();

sec("hardening");
(function () {
  var n = normalize({ categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F", createdAt: "2026-01-01",
      budgets: [{ from: "garbage", amount: 100 }, { from: "2026-05", amount: "250" },
                { from: "2026-03", amount: -5 }] }], ledger: [] });
  var bs = n.funds[0].budgets;
  ok("a bad month falls back to the epoch", bs[0].from === "1970-01", bs[0].from);
  ok("sorted by month", bs.map(function (b) { return b.from; }).join(",") === "1970-01,2026-03,2026-05");
  eq("strings coerce", bs[2].amount, 250);
  eq("negatives clamp", bs[1].amount, 0);
  state = n;
  eq("a fund with no budgets reads zero",
     budgetOfFund(normalize({ categories: [{ id: "c", name: "C" }],
       funds: [{ id: "x", categoryId: "c", name: "X" }], ledger: [] }).funds[0]), 0);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

/* Rebaselining every fund at once. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var M = thisMonth(), LAST = monthShift(M, -1);
var toast = function () {};   // no DOM in here

function world() {
  draftMonthly = {}; draftAmounts = {}; draftKind = {}; afOpen = new Set();
  state = normalize({
    meta: { planStart: "2025-01", incomes: [{ from: "2025-01", amount: 5000 }] },
    categories: [{ id: "c", name: "Home" }],
    funds: [
      { id: "gro", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
        budgets: [{ from: "2025-01", amount: 1000 }] },
      { id: "net", categoryId: "c", name: "Netflix", createdAt: "2025-01-01",
        fixed: true, budgets: [{ from: "2025-01", amount: 15 }] },
      { id: "car", categoryId: "c", name: "Car repairs", createdAt: "2025-01-01",
        buffer: true, budgets: [{ from: "2025-01", amount: 100 }] },
      // seasonal: $2,400 a year, peaking in summer
      { id: "pow", categoryId: "c", name: "Power", createdAt: "2025-01-01",
        budgets: [{ from: "2025-01", amount: 200 }],
        schedule: { amounts: [100,100,150,200,250,300,300,250,200,200,200,150] } },
    ], ledger: [] });
}

sec("the draft total moves without touching state");
world();
eq("budgeted today", totalBudgeted(), 1000 + 15 + 100 + 200);
eq("  and the draft agrees before any edit", draftTotal(), totalBudgeted());
draftMonthly.gro = 800;
eq("the draft drops by the edit", draftTotal(), totalBudgeted() - 200);
eq("  but nothing is saved yet", budgetOfFund(fundById("gro")), 1000);
eq("  and one change is pending", draftCount(), 1);
draftMonthly.gro = 1000;
eq("setting it back is not a change", draftCount(), 0);

sec("saving commits every changed row");
world();
draftMonthly.gro = 800;
draftMonthly.net = 20;
eq("two pending", draftCount(), 2);
saveAllFunds();
eq("groceries saved", budgetOfFund(fundById("gro")), 800);
eq("netflix saved", budgetOfFund(fundById("net")), 20);
eq("the buffer was untouched", budgetOfFund(fundById("car")), 100);
eq("the draft is cleared", draftCount(), 0);
eq("the new total", totalBudgeted(), 800 + 20 + 100 + 200);

sec("budgets stay dated — history is never rewritten");
world();
draftMonthly.gro = 400;
saveAllFunds();
eq("this month takes the new figure", budgetOfFund(fundById("gro"), M), 400);
eq("last month keeps the old one", budgetOfFund(fundById("gro"), LAST), 1000);

sec("a Varying fund SCALES its twelve bills, keeping their shape");
world();
var before = scheduleInfo(fundById("pow"));
eq("annual before", before.annual, 2400);
eq("monthly before", before.monthly, 200);
draftAmounts.pow = before.amounts.map(function (v) { return v / 2; });   // halve it
saveAllFunds();
var after = scheduleInfo(fundById("pow"));
eq("annual halves", after.annual, 1200);
eq("  and so does the monthly", after.monthly, 100);
eq("  the budget follows the bills", budgetOfFund(fundById("pow")), 100);
ok("  every month halved", after.amounts.every(function (v, i) {
  return Math.abs(v - before.amounts[i] / 2) < 0.02; }), JSON.stringify(after.amounts));
ok("  the seasonal shape survives — July is still the peak",
   after.amounts.indexOf(Math.max.apply(null, after.amounts))
     === before.amounts.indexOf(Math.max.apply(null, before.amounts)));
ok("  and it is still a Varying fund", !!scheduleInfo(fundById("pow")));

sec("scaling a Varying fund to zero, and back");
world();
draftAmounts.pow = Array(12).fill(0);
saveAllFunds();
ok("zeroing removes the schedule rather than leaving twelve zeros",
   !scheduleInfo(fundById("pow")), JSON.stringify(fundById("pow").schedule));
eq("  and the budget is zero", budgetOfFund(fundById("pow")), 0);

sec("undo restores the schedule, not just the number");
world();
var shape = scheduleInfo(fundById("pow")).amounts.slice();
draftAmounts.pow = afAmounts(fundById("pow")).map(function (v) { return v * 0.75; });
var snapshot = { monthly: budgetOfFund(fundById("pow")),
                 schedule: JSON.parse(JSON.stringify(fundById("pow").schedule)) };
saveAllFunds();
eq("changed", scheduleInfo(fundById("pow")).annual, 1800);
// what the toast's undo does
updateFund("pow", { schedule: normalizeSchedule(snapshot.schedule) });
setBudget(fundById("pow"), snapshot.monthly, M);
ok("the original twelve are back",
   JSON.stringify(scheduleInfo(fundById("pow")).amounts) === JSON.stringify(shape),
   JSON.stringify(scheduleInfo(fundById("pow")).amounts));
eq("  and the monthly with them", budgetOfFund(fundById("pow")), 200);

sec("nothing silly gets through");
world();
eq("an unchanged draft saves nothing", (function () {
  draftMonthly.gro = 1000; saveAllFunds(); return budgetOfFund(fundById("gro")); })(), 1000);
world();
draftMonthly.gro = 0;
saveAllFunds();
eq("zero is a legitimate budget", budgetOfFund(fundById("gro")), 0);
world();
ok("a fund with no schedule has no twelve to read", afAmounts(fundById("gro")) === null);

sec("the total is what the plan actually costs");
world();
draftMonthly.gro = 1500;
eq("draft total reflects the edit", draftTotal(), 1500 + 15 + 100 + 200);
ok("  which is over the $5,000 income? no — under", draftTotal() < incomeAt());
draftMonthly.gro = 9000;
ok("  and a big enough edit goes over", draftTotal() > incomeAt(), String(draftTotal()));


sec("editing the twelve directly, which is what a Varying fund really has");
(function () {
  world();
  var f = fundById("pow");
  ok("the draft starts from the saved twelve",
     JSON.stringify(afAmounts(f)) === JSON.stringify(scheduleInfo(f).amounts));
  eq("  and the monthly is their average", afMonthly(f), 200);
  ok("  nothing is pending yet", !afChanged(f));

  // change one month only — the average moves by a twelfth of the change
  var a = afAmounts(f).slice();
  a[6] = a[6] + 120;                       // July up $120
  draftAmounts.pow = a;
  eq("one month's change moves the average by a twelfth", afMonthly(f), 210);
  ok("  the row counts as changed", afChanged(f));
  eq("  and the total moves with it", draftTotal(), 1000 + 15 + 100 + 210);
  eq("  still nothing saved", scheduleInfo(fundById("pow")).amounts[6], 300);

  saveAllFunds();
  eq("July is saved", scheduleInfo(fundById("pow")).amounts[6], 420);
  ok("  the other eleven are untouched",
     scheduleInfo(fundById("pow")).amounts.filter(function (v, i) {
       return i !== 6 && Math.abs(v - [100,100,150,200,250,300,300,250,200,200,200,150][i]) > 0.005;
     }).length === 0);
  eq("  and the contribution follows", budgetOfFund(fundById("pow")), 210);
})();

sec("the two bulk moves inside the panel");
(function () {
  world();
  var f = fundById("pow");
  // "every month" — flatten
  draftAmounts.pow = afAmounts(f).map(function () { return 175; });
  eq("flattening gives a flat average", afMonthly(f), 175);
  saveAllFunds();
  ok("every month is the same", scheduleInfo(fundById("pow")).amounts
     .every(function (v) { return Math.abs(v - 175) < 0.005; }));

  // "scale by %" — keep the shape
  world();
  var orig = afAmounts(fundById("pow")).slice();
  draftAmounts.pow = orig.map(function (v) { return Math.round(v * 0.9 * 100) / 100; });
  eq("scaling by 90% moves the average by 90%", afMonthly(fundById("pow")), 180);
  saveAllFunds();
  var now = scheduleInfo(fundById("pow")).amounts;
  ok("the shape is preserved", now.every(function (v, i) {
    return Math.abs(v - orig[i] * 0.9) < 0.02; }), JSON.stringify(now));
  ok("  peak month unchanged",
     now.indexOf(Math.max.apply(null, now)) === orig.indexOf(Math.max.apply(null, orig)));
})();

sec("a Varying fund is never edited two ways at once");
(function () {
  world();
  // the panel wins over a stale scalar draft, so one fund can't have two answers
  draftAmounts.pow = afAmounts(fundById("pow")).map(function () { return 50; });
  eq("the twelve decide the monthly", afMonthly(fundById("pow")), 50);
  saveAllFunds();
  eq("and the twelve are what got saved", scheduleInfo(fundById("pow")).amounts[0], 50);
  eq("  with the contribution to match", budgetOfFund(fundById("pow")), 50);
})();


sec("the type is editable too, and the monthly carries across");
(function () {
  world();
  var f = fundById("gro");
  ok("starts as a Budget", savedKind(f) === "level", savedKind(f));

  afSetKind(f, "fixed");
  ok("the draft says Fixed", afKind(fundById("gro")) === "fixed");
  eq("  the monthly is unchanged, so the total does not jump", afMonthly(fundById("gro")), 1000);
  ok("  it counts as a change even though no figure moved", afChanged(fundById("gro")));
  eq("  and the total really is the same", draftTotal(), totalBudgeted());
  saveAllFunds();
  ok("saved as Fixed", isFixed(fundById("gro")));
  ok("  and it now offers Mark paid", !!fixedPaid(fundById("gro")));
  eq("  budget intact", budgetOfFund(fundById("gro")), 1000);
})();

sec("becoming Varying seeds twelve equal months");
(function () {
  world();
  afSetKind(fundById("gro"), "vary");
  var a = afAmounts(fundById("gro"));
  eq("twelve slots", a.length, 12);
  ok("  all equal to the old monthly", a.every(function (v) { return Math.abs(v - 1000) < 0.005; }),
     JSON.stringify(a));
  eq("  so the monthly is unchanged", afMonthly(fundById("gro")), 1000);
  ok("  and the row opens so you can see what it became", afOpen.has("gro"));
  saveAllFunds();
  ok("saved with a schedule", !!scheduleInfo(fundById("gro")));
  eq("  annual is twelve times the monthly", scheduleInfo(fundById("gro")).annual, 12000);
  ok("  and it is no longer Fixed or Sinking",
     !isFixed(fundById("gro")) && !isBuffer(fundById("gro")));
})();

sec("leaving Varying keeps the level contribution as a flat figure");
(function () {
  world();
  eq("Power contributes $200/mo", budgetOfFund(fundById("pow")), 200);
  afSetKind(fundById("pow"), "buffer");
  eq("the monthly carries across", afMonthly(fundById("pow")), 200);
  ok("  and the twelve are dropped from the draft", afAmounts(fundById("pow")) === null);
  saveAllFunds();
  ok("the schedule is gone", !scheduleInfo(fundById("pow")));
  ok("  it is a Sinking fund now", isBuffer(fundById("pow")));
  eq("  still $200/mo", budgetOfFund(fundById("pow")), 200);
  eq("  and the plan total is unchanged", totalBudgeted(), 1000 + 15 + 100 + 200);
})();

sec("a Sinking fund's minimum is dropped with the type, and undo restores it");
(function () {
  world();
  updateFund("car", { floor: 500 });
  eq("it has a minimum", fundById("car").floor, 500);
  var snap = { monthly: budgetOfFund(fundById("car")), schedule: null,
               buffer: true, fixed: false, floor: 500 };
  afSetKind(fundById("car"), "level");
  saveAllFunds();
  ok("no longer Sinking", !isBuffer(fundById("car")));
  eq("  and the minimum went with it", fundById("car").floor, 0);
  // what the toast's undo does
  updateFund("car", { schedule: null, buffer: snap.buffer, fixed: snap.fixed, floor: snap.floor });
  setBudget(fundById("car"), snap.monthly, M);
  ok("undo brings the type back", isBuffer(fundById("car")));
  eq("  and the minimum with it", fundById("car").floor, 500);
})();

sec("the four types are mutually exclusive however you get there");
(function () {
  ["level", "fixed", "buffer", "vary"].forEach(function (k) {
    world();
    afSetKind(fundById("gro"), k);
    saveAllFunds();
    var f = fundById("gro");
    eq("  " + k + ": exactly one type sticks",
       [!!scheduleInfo(f), isBuffer(f), isFixed(f)].filter(Boolean).length, k === "level" ? 0 : 1);
    ok("  " + k + ": and it is the one asked for", savedKind(f) === k, savedKind(f));
  });
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

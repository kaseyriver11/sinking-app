/* Fixed bills, the month view's figures, and the bill calendar. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var M = thisMonth(), LAST = monthShift(M, -1);

function world(extra) {
  var f = { id: "n", categoryId: "c", name: "Netflix", createdAt: "2025-01-01",
            fixed: true, budgets: [{ from: "2025-01", amount: 15 }] };
  for (var k in (extra || {})) f[k] = extra[k];
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "Fun" }],
    funds: [f, { id: "g", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
                 budgets: [{ from: "2025-01", amount: 400 }] }],
    ledger: [] });
  return fundById("n");
}

sec("a fixed bill knows whether it has gone out");
(function () {
  var f = world();
  ok("it is flagged", isFixed(f));
  var st = fixedPaid(f);
  eq("  the amount due is the monthly figure", st.due, 15);
  ok("  and it is unpaid", !st.paid);

  eq("marking it paid records the bill", payFixed("n"), 15);
  eq("  the balance moved", balanceOfFund("n"), -15);
  ok("  and it now reads paid", fixedPaid(fundById("n")).paid);
  eq("  clicking again does nothing", payFixed("n"), 0);
  eq("  so the balance is unchanged", balanceOfFund("n"), -15);
})();

sec("a partly paid month tops up rather than doubling");
(function () {
  world();
  addEntry("n", -5, M + "-03", "part");
  eq("only the remainder is added", payFixed("n"), 10);
  eq("  landing exactly on the bill", monthStats({ fund: "n" }, M).spent, 15);
})();

sec("the entry it writes is ordinary and undoable");
(function () {
  world();
  payFixed("n");
  var e = state.ledger[state.ledger.length - 1];
  ok("dated today", e.date === todayStr(), e.date);
  ok("  an expense, not a transfer", e.amount < 0 && !e.kind, JSON.stringify([e.amount, e.kind]));
  ok("  the note names the month and fund", /Netflix/.test(e.note) && /20\d\d/.test(e.note), e.note);
  deleteEntry(e.id);
  ok("  deleting it makes the bill outstanding again", !fixedPaid(fundById("n")).paid);
})();

sec("only a plain monthly fund can be fixed");
(function () {
  ok("a scheduled fund cannot", !isFixed(world({ schedule: { amount: 99, months: [3] } })));
  ok("  nor a buffer", !isFixed(world({ buffer: true })));
  ok("  and the flag is dropped on save, not just ignored",
     world({ buffer: true }).fixed === false);
  ok("dueDay is meaningless without the flag, so it's dropped too",
     world({ buffer: true, dueDay: 5 }).dueDay === 0);
  ok("payFixed refuses a fund with no budget",
     payFixed(normalize({ categories: [{ id: "c", name: "C" }],
       funds: [{ id: "z", categoryId: "c", name: "Z", fixed: true }], ledger: [] }).funds[0].id) === 0);
  eq("  and a non-fixed fund is untouched", payFixed("g"), 0);
})();

sec("it round-trips");
(function () {
  world();
  var again = normalize(JSON.parse(JSON.stringify(state)));
  ok("the flag survives a reload", again.funds[0].fixed === true);
  ok("re-normalizing is stable", JSON.stringify(normalize(again)) === JSON.stringify(again));
})();

sec("due day: optional, coerced, clamped to a real day of the month");
(function () {
  ok("unset by default", world().dueDay === 0);
  eq("a real day is kept", world({ dueDay: 5 }).dueDay, 5);
  eq("a string coerces", world({ dueDay: "12" }).dueDay, 12);
  eq("above 31 clamps down", world({ dueDay: 40 }).dueDay, 31);
  eq("negative clamps to unset", world({ dueDay: -3 }).dueDay, 0);
  eq("junk becomes unset", world({ dueDay: "soon" }).dueDay, 0);
  world({ dueDay: 15 });
  var again = normalize(JSON.parse(JSON.stringify(state)));
  eq("survives a reload", again.funds[0].dueDay, 15);
})();

sec("last month is judged separately from this one");
(function () {
  world();
  addEntry("n", -15, LAST + "-04", "last month");
  ok("last month reads paid", fixedPaid(fundById("n"), LAST).paid);
  ok("  this month does not", !fixedPaid(fundById("n"), M).paid);
  eq("  and paying now only covers now", payFixed("n"), 15);
  eq("  leaving last month alone", monthStats({ fund: "n" }, LAST).spent, 15);
})();

sec("the month view's over-budget list");
(function () {
  world();
  addEntry("g", -520, M + "-05", "big shop");
  var rows = allFunds().map(function (f) {
    var s2 = monthStats({ fund: f.id }, M);
    var info = scheduleInfo(f);
    var planned = info ? info.amountFor(M) : budgetOfFund(f, M);
    return { f: f, spent: s2.spent, planned: planned, over: s2.spent - planned, sched: !!info };
  });
  var overs = rows.filter(function (r) { return !r.sched && r.over > 0.005; });
  eq("one fund over plan", overs.length, 1);
  ok("  it is Groceries", overs[0].f.name === "Groceries", overs[0].f.name);
  eq("  by the right amount", overs[0].over, 120);

  // the "Budget $520" action is dated, so history is untouched
  var wasLast = budgetOfFund(fundById("g"), LAST);
  setBudget(fundById("g"), 520, M);
  eq("this month takes the new figure", budgetOfFund(fundById("g"), M), 520);
  eq("  last month keeps the old one", budgetOfFund(fundById("g"), LAST), wasLast);
})();

sec("the bill calendar includes Fixed bills, and only real bills");
(function () {
  state = normalize({ meta: { planStart: M },
    categories: [{ id: "c", name: "C" }],
    funds: [
      { id: "tax", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
        schedule: { amount: 6000, months: [9] } },
      { id: "net", categoryId: "c", name: "Netflix", createdAt: "2025-01-01",
        fixed: true, budgets: [{ from: "2025-01", amount: 15 }] },
      { id: "gro", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
        budgets: [{ from: "2025-01", amount: 400 }] },
      { id: "car", categoryId: "c", name: "Car repairs", createdAt: "2025-01-01",
        buffer: true, budgets: [{ from: "2025-01", amount: 100 }] },
    ], ledger: [] });
  var months = [], mm = horizonStart();
  for (var i = 0; i < 12; i++) { months.push(mm); mm = monthShift(mm, 1); }

  var rows = allFunds().map(function (f) {
    var b = billCells(f, months);
    return b && { name: f.name, kind: b.kind, cells: b.cells };
  }).filter(function (r) { return r && r.cells.some(function (v) { return v > 0.005; }); });

  eq("two funds bill, not four", rows.length, 2);
  ok("  the Varying one is there", rows.some(function (r) { return r.name === "Taxes"; }));
  ok("  and the Fixed one", rows.some(function (r) { return r.name === "Netflix"; }));
  ok("  a Budget is not a bill — it is a limit you spend against",
     !rows.some(function (r) { return r.name === "Groceries"; }));
  ok("  nor is a Sinking fund — nothing is scheduled",
     !rows.some(function (r) { return r.name === "Car repairs"; }));

  var net = rows.filter(function (r) { return r.name === "Netflix"; })[0];
  ok("a Fixed bill lands in every single month",
     net.cells.every(function (v) { return Math.abs(v - 15) < 0.005; }), JSON.stringify(net.cells));
  ok("  and is tagged as fixed", net.kind === "fixed", net.kind);

  var tax = rows.filter(function (r) { return r.name === "Taxes"; })[0];
  eq("a Varying bill lands only when due",
     tax.cells.filter(function (v) { return v > 0.005; }).length, 1);
  ok("  and is tagged as varying", tax.kind === "vary", tax.kind);

  var total = rows.reduce(function (a, r) {
    return a + r.cells.reduce(function (b, v) { return b + v; }, 0); }, 0);
  eq("the grand total is both kinds together", total, 6000 + 15 * 12);

  // the subtotal rows must partition the whole, not overlap it
  var fixedT = months.map(function (_, i) { return rows.filter(function (r) { return r.kind === "fixed"; })
    .reduce(function (a, r) { return a + r.cells[i]; }, 0); });
  var varyT = months.map(function (_, i) { return rows.filter(function (r) { return r.kind === "vary"; })
    .reduce(function (a, r) { return a + r.cells[i]; }, 0); });
  ok("fixed + varying equals the column total in every month",
     months.every(function (_, i) {
       var all = rows.reduce(function (a, r) { return a + r.cells[i]; }, 0);
       return Math.abs((fixedT[i] + varyT[i]) - all) < 0.005; }));
  ok("the fixed baseline never moves",
     new Set(fixedT.map(function (v) { return v.toFixed(2); })).size === 1, JSON.stringify(fixedT));
})();

sec("the bill calendar covers a whole year exactly once");
(function () {
  state = normalize({ meta: { planStart: M },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "a", categoryId: "c", name: "Taxes", createdAt: "2025-01-01",
              schedule: { amount: 6000, months: [9] } },
            { id: "b", categoryId: "c", name: "Trash", createdAt: "2025-01-01",
              schedule: { amount: 100, months: [3, 6, 9, 12] } },
            { id: "z", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
              budgets: [{ from: "2025-01", amount: 400 }] }],
    ledger: [] });
  var months = [], mm = horizonStart();
  for (var i = 0; i < 12; i++) { months.push(mm); mm = monthShift(mm, 1); }
  eq("twelve columns", months.length, 12);
  ok("no month repeats", new Set(months).size === 12);

  var sched = allFunds().filter(function (f) { return scheduleInfo(f); });
  eq("only scheduled funds have rows", sched.length, 2);
  var grand = sched.reduce(function (a, f) {
    return a + months.reduce(function (b, k) { return b + scheduleInfo(f).amountFor(k); }, 0); }, 0);
  var annual = sched.reduce(function (a, f) { return a + scheduleInfo(f).annual; }, 0);
  eq("the grid totals exactly the annual cost — every bill once", grand, annual);
  eq("  which is $6,000 + $400", grand, 6400);
})();

/* "Fund the month"'s suggested amounts: the normal contribution if a fund
 * hasn't been funded this month, a top-up if it has been funded but is still
 * short, or nothing — reopening the dialog after funding 24 of 30 funds must
 * not offer to double-credit those 24. */

function allot(fundId, amt, mk) {
  return { id: "a" + fundId, fundId: fundId, amount: amt, date: monthStart(mk || M), kind: "allotment" };
}

sec("a level fund: not yet funded suggests the budget, funded suggests nothing");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
              budgets: [{ from: "2025-01", amount: 400 }] }],
    ledger: [] });
  var f = fundById("f");
  var before = monthSuggestion(f, M);
  eq("suggests the full budget", before.amt, 400);
  ok("not marked funded", !before.funded);
  ok("never 'short' for a level fund — no curve to be behind on", !before.short);

  state.ledger.push(allot("f", 400));
  clearDerivedCache();
  var after = monthSuggestion(fundById("f"), M);
  eq("nothing left to suggest", after.amt, 0);
  ok("marked funded", after.funded);
  ok("still not 'short' — there's nowhere else for a level fund to be behind",
     !after.short);
})();

sec("a level fund funded PARTIALLY still suggests nothing more — no independent curve to chase");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Groceries", createdAt: "2025-01-01",
              budgets: [{ from: "2025-01", amount: 400 }] }],
    ledger: [allot("f", 100)] });
  eq("any allotment this month counts as funded, whatever the amount",
     monthSuggestion(fundById("f"), M).amt, 0);
})();

sec("a scheduled fund: not funded suggests the level contribution");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Property Taxes", createdAt: "2025-01-01",
              schedule: { amount: 1200, months: [9] } }],
    ledger: [] });
  var sug = monthSuggestion(fundById("f"), M);
  eq("the level contribution, not the bill itself", sug.amt, 100);
  ok("not funded", !sug.funded);
})();

sec("a scheduled fund: funded but still behind its curve suggests the gap, not the level amount again");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Property Taxes", createdAt: "2025-01-01",
              schedule: { amount: 1200, months: [9] } }],
    // funded this month, but far short of the curve — e.g. earlier months
    // were never funded at all
    ledger: [allot("f", 100)] });
  var f = fundById("f");
  var gap = cycleOutlook(f).gap;
  ok("genuinely behind", gap > 0.005, String(gap));
  var sug = monthSuggestion(f, M);
  ok("funded is true — this month's allotment exists", sug.funded);
  ok("but still flagged short", sug.short);
  eq("suggests the catch-up gap, not another $100", sug.amt, gap);
  ok("that's not just the level amount again", Math.abs(sug.amt - 100) > 0.01);
})();

sec("a scheduled fund: funded AND caught up suggests nothing — this is the reported bug");
(function () {
  // exactly the scenario reported: 24 of 30 funds already funded for the
  // month, and re-opening the dialog must not re-offer their full budget
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Property Taxes", createdAt: "2025-01-01",
              schedule: { amount: 1200, months: [9] } }],
    ledger: [] });
  var f = fundById("f");
  // fund it every month up through now so the curve is fully caught up
  var mk = "2025-01";
  while (mk <= M) {
    state.ledger.push(allot("f", 100, mk));
    mk = monthShift(mk, 1);
  }
  clearDerivedCache();
  var caught = fundById("f");
  eq("genuinely caught up", cycleOutlook(caught).gap, 0);
  var sug = monthSuggestion(caught, M);
  ok("funded", sug.funded);
  ok("not short", !sug.short);
  eq("nothing suggested — funding again would double-credit it", sug.amt, 0);
})();

sec("a buffer: not funded suggests its budget, funded-and-above-floor suggests nothing");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Health", createdAt: "2025-01-01",
              buffer: true, floor: 1000, budgets: [{ from: "2025-01", amount: 200 }] }],
    ledger: [{ id: "g", fundId: "f", amount: 1000, date: "2025-01-15" }] });
  var before = monthSuggestion(fundById("f"), M);
  eq("suggests the budget when not yet funded", before.amt, 200);

  state.ledger.push(allot("f", 200));
  clearDerivedCache();
  var after = monthSuggestion(fundById("f"), M);
  eq("at the floor already — nothing more to suggest", after.amt, 0);
  ok("funded and not short", after.funded && !after.short);
})();

sec("a buffer: funded but below its floor suggests the top-up to the floor");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Health", createdAt: "2025-01-01",
              buffer: true, floor: 1000, budgets: [{ from: "2025-01", amount: 200 }] }],
    // funded this month, but the balance is still well under the floor
    ledger: [{ id: "g", fundId: "f", amount: 400, date: "2025-01-15" }, allot("f", 200)] });
  var f = fundById("f");
  var sug = monthSuggestion(f, M);
  ok("funded", sug.funded);
  ok("still short", sug.short);
  eq("suggests exactly the gap to the floor", sug.amt, catchUpAmount(f));
  eq("  which is $400", sug.amt, 400);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

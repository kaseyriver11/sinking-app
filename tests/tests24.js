/* Buffer funds: a level contribution with unpredictable draws. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var M = thisMonth(), LAST = monthShift(M, -1), TWO = monthShift(M, -2);

function health(extra, ledger) {
  var f = { id: "h", categoryId: "c", name: "Healthcare", createdAt: "2025-01-01",
            budgets: [{ from: "2025-01", amount: 250 }], buffer: true };
  for (var k in extra) f[k] = extra[k];
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "Health" }], funds: [f], ledger: ledger || [] });
  return fundById("h");
}
// a month's worth of spending, dated mid-month so it's never in the future
var draw = function (id, mk, amt) { return { id: id, fundId: "h", amount: -amt, date: mk + "-15" }; };

sec("the whole point: a big month is not an error");
(function () {
  // $250/mo contributed all year, $1,000 drawn last month
  var f = health({}, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" },
                      draw("d1", LAST, 1000)]);
  eq("balance survives", balanceOfFund("h"), 2000);
  ok("spending is 4x the monthly figure", 1000 > budgetOfFund(f) * 3);
  ok("status is NOT over budget", fundStatus(f).key !== "overspent", fundStatus(f).key);
  ok("it reads as a buffer", fundStatus(f).key === "buffer", fundStatus(f).key);
  ok("and the tone is good", fundStatus(f).tone === "good", fundStatus(f).tone);
  ok("the meter never says 'Spent x of y'", !/Spent/.test(meterFor(f).note), meterFor(f).note);
})();

sec("the same fund WITHOUT the flag is flagged — this is the bug being fixed");
(function () {
  var f = health({ buffer: false }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" },
                                     draw("d1", M, 1000)]);
  ok("a level fund calls it over budget", fundStatus(f).key === "overspent", fundStatus(f).key);
  var g = health({ buffer: true }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" },
                                    draw("d1", M, 1000)]);
  ok("the buffer flag is what silences it", fundStatus(g).key === "buffer", fundStatus(g).key);
})();

sec("a zero month is equally fine");
(function () {
  var f = health({}, [{ id: "c1", fundId: "h", amount: 750, date: "2026-01-01" }]);
  eq("nothing spent", monthStats({ fund: "h" }, M).spent, 0);
  ok("still just a buffer", fundStatus(f).key === "buffer", fundStatus(f).key);
})();

sec("going negative is still a real problem");
(function () {
  var f = health({}, [{ id: "c1", fundId: "h", amount: 250, date: "2026-01-01" },
                      draw("d1", LAST, 900)]);
  ok("overdrawn beats everything", fundStatus(f).key === "over", fundStatus(f).key);
  ok("  and it is critical", fundStatus(f).tone === "critical", fundStatus(f).tone);
})();

sec("the reserve floor is the one monthly-ish judgement it keeps");
(function () {
  var f = health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" },
                                   draw("d1", LAST, 2500)]);
  eq("balance", balanceOfFund("h"), 500);
  ok("below the floor is flagged", fundStatus(f).key === "lowreserve", fundStatus(f).key);
  eq("and the gap is the fix amount", fundStatus(f).short, 500);
  ok("  the label names the floor", /1,000/.test(fundStatus(f).label), fundStatus(f).label);
  ok("  tone is a warning, not critical", fundStatus(f).tone === "warning", fundStatus(f).tone);

  var g = health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" },
                                   draw("d1", LAST, 1500)]);
  ok("exactly at the floor is fine", fundStatus(g).key === "buffer", fundStatus(g).key);
})();

sec("a low reserve reaches the needs-attention list; a healthy buffer does not");
(function () {
  health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" },
                           draw("d1", LAST, 2500)]);
  var is = issues();
  eq("one issue", is.length, 1);
  eq("offering the exact top-up", is[0].fix, 500);

  health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" }]);
  eq("a healthy buffer raises nothing", issues().length, 0);

  health({}, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" }, draw("d1", M, 2000)]);
  eq("and neither does a huge month with no floor", issues().length, 0);
})();

sec("months of cover, from the trailing average");
(function () {
  var f = health({}, [{ id: "c1", fundId: "h", amount: 4000, date: "2026-01-01" },
                      draw("d1", LAST, 200), draw("d2", TWO, 400)]);
  // $600 over the six-month window. The four quiet months COUNT — averaging only
  // the months that happened to have a bill would inflate the burn rate and
  // understate how long the money lasts, which is the one number this reports.
  eq("averaged over the whole window, quiet months included", recentDraw("h"), 100);
  eq("a shorter window sees a higher rate", recentDraw("h", 2), 300);
  ok("the meter quotes the annual contribution", /\(\$3,000\/yr\)$/.test(meterFor(f).note),
     meterFor(f).note);
  ok("  and leads with what is held", /^Holding /.test(meterFor(f).note), meterFor(f).note);
  ok("  never 'Spent x of y' — a buffer has no budget to be measured against",
     !/Spent/.test(meterFor(f).note), meterFor(f).note);

  // the current month is excluded: a fund read on the 2nd would otherwise look
  // like its spending had collapsed
  var before = recentDraw("h");
  addEntry("h", -900, M + "-15", "This month");
  eq("a draw in the current month does not move the average", recentDraw("h"), before);
  addEntry("h", -900, LAST + "-20", "Another last month");
  ok("one in a complete month does", recentDraw("h") > before, String(recentDraw("h")));
})();

sec("months of cover — used by the fund page, not the rail caption");
(function () {
  var f = health({}, [{ id: "c1", fundId: "h", amount: 1000, date: "2026-01-01" }]);
  eq("no draws yet, so no measured rate", recentDraw("h"), 0);
  // the fund page falls back to the monthly contribution when there's no history
  ok("$1,000 at the $250 contribution is four months",
     /4 months of cover/.test(coverLabel(1000 / (recentDraw("h") || budgetOfFund(f)))),
     coverLabel(1000 / (recentDraw("h") || budgetOfFund(f))));
  ok("under a month reads as such", /under a month/.test(coverLabel(0.4)), coverLabel(0.4));
  ok("a long runway is not spelled out in months", /year/.test(coverLabel(30)), coverLabel(30));
  ok("one month is singular", /1 month of cover/.test(coverLabel(1)), coverLabel(1));

  // the rail stays short: the annual, not the cover
  ok("the rail caption quotes the annual instead",
     /^Holding \$1,000 \(\$3,000\/yr\)$/.test(meterFor(f).note), meterFor(f).note);
})();

sec("a buffer below its floor says how far below");
(function () {
  var f = health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 400, date: "2026-01-01" }]);
  var note = meterFor(f).note;
  ok("it names the gap", /\$600 below/.test(note), note);
  ok("  and the minimum it is below", /\$1,000 minimum/.test(note), note);
  ok("  the tone warns", meterFor(f).tone === "warning", meterFor(f).tone);
  ok("  and it does NOT quote the annual — the warning matters more",
     !/\/yr/.test(note), note);

  // once topped up it goes back to the annual
  catchUpFund("h");
  var after = meterFor(fundById("h")).note;
  ok("a healthy buffer is back to the annual", /\(\$3,000\/yr\)$/.test(after), after);
  ok("  with nothing about being below", !/below/.test(after), after);
})();

sec("the bar means 'safe', consistent with the scheduled funds");
(function () {
  var f = health({}, [{ id: "c1", fundId: "h", amount: 1000, date: "2026-01-01" }]);
  eq("no floor, nothing to be short of, so it reads full", meterFor(f).pct, 100);
  var g = health({ floor: 2000 }, [{ id: "c1", fundId: "h", amount: 1000, date: "2026-01-01" }]);
  eq("with a floor it measures the reserve", meterFor(g).pct, 50);
  ok("  and warns", meterFor(g).tone === "warning", meterFor(g).tone);
  ok("  quoting the minimum, not a budget", /minimum/.test(meterFor(g).note), meterFor(g).note);
})();

sec("commitment: contingency money is not free money");
(function () {
  // The reported case: Auto Maintenance reading "$1,000 committed, $150 free".
  // The $150 isn't spare in any sense that matters — the whole balance is
  // sitting there for when something breaks.
  health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" }]);
  var p = commitmentParts(fundById("h"));
  eq("the whole balance is reserved, not just the floor", p.reserve, 3000);
  eq("  so none of it reads as free", p.free, 0);
  eq("  and it is not filed under bills", p.dueNow, 0);
  eq("no monthly budget claim — the balance IS the plan", p.dueNow, 0);
  eq("parts reconstruct the balance",
     p.dueNow + p.earmarks + p.reserve + p.free, 3000);

  health({}, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" }]);
  var q = commitmentParts(fundById("h"));
  eq("a floor isn't what makes it reserved — the fund kind is", q.reserve, 3000);
  eq("  still nothing free", q.free, 0);

  // a ceiling is how you say where the reserve stops
  health({ floor: 1000, ceiling: 2000 }, [{ id: "c1", fundId: "h", amount: 3000, date: "2026-01-01" }]);
  var r = commitmentParts(fundById("h"));
  eq("with a ceiling, the reserve stops there", r.reserve, 2000);
  eq("  and the rest really is spare", r.free, 1000);

  // contrast: a plain discretionary fund, where the money IS yours to choose about
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "t", categoryId: "c", name: "Travel", createdAt: "2025-01-01" }],
    ledger: [{ id: "x", fundId: "t", amount: 3000, date: "2026-01-01" }] });
  var t = commitmentParts(fundById("t"));
  eq("a discretionary fund is entirely free", t.free, 3000);
  eq("  with nothing reserved", t.reserve, 0);
})();

sec("a buffer counts as spending in the plan, not as holding");
(function () {
  health({}, []);
  eq("its contribution leaves the bank over time", monthlySpending(M), 250);
  eq("it is not held for a dated bill", monthlyHolding(M), 0);
})();

sec("buffer and schedule are mutually exclusive");
(function () {
  var f = health({ schedule: { amount: 600, months: [6] } }, []);
  ok("the schedule wins", f.buffer === false, String(f.buffer));
  ok("  so it is judged on its curve", !isBuffer(f));
  eq("  and the floor is cleared with it", f.floor, 0);
})();

sec("round-trip and hardening");
(function () {
  var f = health({ floor: "1500" }, []);
  eq("a string floor coerces", f.floor, 1500);
  var again = normalize(JSON.parse(JSON.stringify(state)));
  ok("the flag survives a reload", again.funds[0].buffer === true);
  eq("  as does the floor", again.funds[0].floor, 1500);
  ok("re-normalizing is stable", JSON.stringify(normalize(again)) === JSON.stringify(again));

  var g = health({ floor: -50 }, []);
  eq("a negative floor clamps to zero", g.floor, 0);
  var h = health({ buffer: false, floor: 900 }, []);
  eq("a floor without the flag is dropped", h.floor, 0);
})();


/* ── catch-up ──────────────────────────────────────────────────────────── */

sec("it adds exactly what's missing");
(function () {
  var f = health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 400, date: "2026-01-01" }]);
  eq("the gap", catchUpAmount(f), 600);
  eq("the button reports what it will add", catchUpFund("h"), 600);
  eq("balance is exactly the floor", balanceOfFund("h"), 1000);
  eq("nothing left to catch up", catchUpAmount(fundById("h")), 0);
  ok("and the fund is clear", fundStatus(fundById("h")).key === "buffer");
})();

sec("it is idempotent — the second click does nothing");
(function () {
  health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 400, date: "2026-01-01" }]);
  catchUpFund("h");
  var n = state.ledger.length;
  eq("no top-up needed", catchUpFund("h"), 0);
  eq("and no entry written", state.ledger.length, n);
  eq("balance unmoved", balanceOfFund("h"), 1000);
})();

sec("money dated ahead is not funded twice");
(function () {
  // $400 today plus $250 already recorded for next month, against a $1,000 floor
  var f = health({ floor: 1000 }, [
    { id: "c1", fundId: "h", amount: 400, date: "2026-01-01" },
    { id: "c2", fundId: "h", amount: 250, date: monthShift(M, 1) + "-01" }]);
  eq("only $350 is actually missing", catchUpAmount(f), 350);
  ok("  not the $600 today's balance alone suggests", catchUpAmount(f) !== 600);
  catchUpFund("h");
  eq("the fund lands on the floor once the dated entry arrives", balanceOfFund("h"), 1000);
  eq("  and holds $750 today", balanceToday("h"), 750);
})();

sec("the button and the badge agree on the number");
(function () {
  var f = health({ floor: 1200 }, [{ id: "c1", fundId: "h", amount: 500, date: "2026-01-01" }]);
  eq("status short and catch-up amount are the same figure",
     catchUpAmount(f), fundStatus(f).short);
  eq("  which is also what needs-attention offers", issues()[0].fix, catchUpAmount(f));
})();

sec("it does nothing on funds that have no floor to reach");
(function () {
  eq("no floor set", catchUpAmount(health({}, [])), 0);
  eq("already above the floor",
     catchUpAmount(health({ floor: 100 }, [{ id: "c1", fundId: "h", amount: 900, date: "2026-01-01" }])), 0);
  var lvl = health({ buffer: false, floor: 1000 }, []);
  eq("a level fund is never caught up this way", catchUpAmount(lvl), 0);
  state = normalize({ categories: [{ id: "c", name: "C" }],
    funds: [{ id: "s", categoryId: "c", name: "Trash", createdAt: "2025-01-01",
              budgets: [{ from: "2025-01", amount: 33 }],
              schedule: { amount: 100, months: [3, 6, 9, 12] } }], ledger: [] });
  eq("neither is a scheduled fund — it has its own catch-up",
     catchUpAmount(fundById("s")), 0);
})();

sec("an overdrawn buffer is brought all the way back");
(function () {
  var f = health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 200, date: "2026-01-01" },
                                   draw("d1", LAST, 500)]);
  eq("balance is negative", balanceOfFund("h"), -300);
  eq("catch-up spans the whole distance", catchUpAmount(f), 1300);
  catchUpFund("h");
  eq("landing on the floor, not on zero", balanceOfFund("h"), 1000);
})();

sec("the entry it writes is a normal, editable credit");
(function () {
  health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 400, date: "2026-01-01" }]);
  catchUpFund("h");
  var e = state.ledger[state.ledger.length - 1];
  ok("dated today", e.date === todayStr(), e.date);
  ok("it is a credit, not a transfer", e.kind !== "transfer", String(e.kind));
  ok("  so it shows in the credits table", creditsOf({ fund: "h" }).some(function (x) { return x.id === e.id; }));
  ok("the note names the minimum, not a schedule", /minimum/.test(e.note), e.note);
  ok("  and never says 'schedule' — a buffer hasn't got one", !/schedule/i.test(e.note), e.note);
  deleteEntry(e.id);
  eq("deleting it puts the fund back", balanceOfFund("h"), 400);
  eq("  and the catch-up is offered again", catchUpAmount(fundById("h")), 600);
})();

sec("the contribution is untouched — catch-up is a one-off");
(function () {
  var f = health({ floor: 1000 }, [{ id: "c1", fundId: "h", amount: 400, date: "2026-01-01" }]);
  var before = budgetOfFund(f);
  catchUpFund("h");
  eq("monthly figure unchanged", budgetOfFund(fundById("h")), before);
  eq("  and the plan still counts it once", monthlySpending(M), before);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

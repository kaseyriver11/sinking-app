/* Ceilings: handing surplus back, and never handing back what's needed. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var M = thisMonth();

function one(fund, ledger) {
  var f = { id: "f", categoryId: "c", name: "Cars", createdAt: "2025-01-01" };
  for (var k in fund) f[k] = fund[k];
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }], funds: [f], ledger: ledger || [] });
  return fundById("f");
}
var credit = function (amt) { return [{ id: "c1", fundId: "f", amount: amt, date: "2026-01-01" }]; };

sec("the plain case");
(function () {
  var f = one({ ceiling: 2000, budgets: [{ from: "2025-01", amount: 300 }] }, credit(2340));
  eq("the surplus above the ceiling", releasableOf(f), 340);
  ok("status notices", fundStatus(f).key === "overceiling", fundStatus(f).key);
  ok("  and names the amount", /\$340/.test(fundStatus(f).label), fundStatus(f).label);
  ok("  tone is not a warning — too much money isn't a problem",
     fundStatus(f).tone === "accent", fundStatus(f).tone);
  eq("releasing hands back exactly that", releaseFund("f"), 340);
  eq("landing on the ceiling", balanceOfFund("f"), 2000);
  eq("nothing left to release", releasableOf(fundById("f")), 0);
  ok("and the fund is ordinary again", fundStatus(fundById("f")).key === "ok",
     fundStatus(fundById("f")).key);
})();

sec("nothing happens without a ceiling, or under one");
(function () {
  eq("no ceiling set", releasableOf(one({ budgets: [{ from: "2025-01", amount: 300 }] }, credit(9000))), 0);
  eq("under the ceiling", releasableOf(one({ ceiling: 2000 }, credit(1500))), 0);
  eq("exactly on it", releasableOf(one({ ceiling: 2000 }, credit(2000))), 0);
  eq("a negative balance releases nothing", releasableOf(one({ ceiling: 100 }, credit(-50))), 0);
})();

var PRESCHOOL = { amount: 315, months: [1,2,3,4,5,9,10,11,12] };

sec("THE GUARD: a scheduled fund never releases money its bills need");
(function () {
  // preschool holding exactly the school-year buffer it is supposed to hold
  var f = one({ ceiling: 400, schedule: PRESCHOOL }, credit(708.75));
  ok("it is well over the ceiling", balanceOfFund("f") > 400);
  eq("but the whole balance is committed", commitmentParts(f).free, 0);
  eq("so nothing is releasable", releasableOf(f), 0);
  eq("and releasing is a no-op", releaseFund("f"), 0);
  eq("  the balance is untouched", balanceOfFund("f"), 708.75);
  ok("the fund does not report a ceiling problem", fundStatus(f).key !== "overceiling",
     fundStatus(f).key);
})();

sec("whichever cap binds first is the one that applies");
(function () {
  // FREE binds: the ceiling would take $500, but only $191.25 isn't committed
  var f = one({ ceiling: 400, schedule: PRESCHOOL }, credit(900));
  var free = commitmentParts(f).free;
  eq("free is the balance above the school-year buffer", free, 191.25);
  ok("  the ceiling would take more than that", balanceOfFund("f") - 400 > free);
  eq("so the free part is what's released", releasableOf(f), free);
  releaseFund("f");
  eq("leaving exactly the committed buffer", balanceOfFund("f"), 708.75);
  ok("  which never leaves the fund short", fundStatus(fundById("f")).key !== "behind",
     fundStatus(fundById("f")).key);

  // CEILING binds: plenty is free, but the ceiling only asks for the excess over it
  var g = one({ ceiling: 100, schedule: { amount: 100, months: [6] } }, credit(400));
  ok("most of it is spare", commitmentParts(g).free > 300, String(commitmentParts(g).free));
  eq("only the excess over the ceiling goes", releasableOf(g), 300);
  releaseFund(g.id);
  eq("  and the fund lands on its ceiling", balanceOfFund(g.id), 100);
})();

sec("a savings goal protects its target");
(function () {
  var f = one({ ceiling: 2000, target: 2400 }, credit(2400));
  eq("the goal is not raided to satisfy the ceiling", releasableOf(f), 0);
  ok("  it still reads as met", fundStatus(f).key === "goalmet", fundStatus(f).key);
  var g = one({ ceiling: 2000, target: 2400 }, credit(2600));
  eq("only the excess over the TARGET is spare", releasableOf(g), 200);
})();

sec("earmarks are protected too");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Travel", createdAt: "2025-01-01", ceiling: 1000 }],
    plans: [{ id: "p", fundId: "f", name: "Scotland", amount: 5000 }],
    ledger: credit(6000) });
  var f = fundById("f");
  eq("the earmark is committed", commitmentParts(f).earmarks, 5000);
  eq("only the unearmarked part is releasable", releasableOf(f), 1000);
  releaseFund("f");
  eq("leaving the earmark whole", balanceOfFund("f"), 5000);
})();

sec("a buffer's floor and ceiling both hold");
(function () {
  var f = one({ buffer: true, floor: 1000, ceiling: 3000,
                budgets: [{ from: "2025-01", amount: 250 }] }, credit(4000));
  eq("the reserve runs up to the ceiling", commitmentParts(f).committed, 3000);
  eq("but $1,000 is above the ceiling and free", releasableOf(f), 1000);
  releaseFund("f");
  eq("landing on the ceiling", balanceOfFund("f"), 3000);
  ok("  still comfortably above its floor", fundStatus(fundById("f")).key !== "lowreserve");

  // a floor above the ceiling is contradictory — the floor must win
  var g = one({ buffer: true, floor: 3000, ceiling: 1000 }, credit(2000));
  eq("nothing is released below the floor, even with a lower ceiling", releasableOf(g), 0);
  ok("  and it reports the shortfall, not a surplus",
     fundStatus(g).key === "lowreserve", fundStatus(g).key);
})();

sec("a real problem always outranks having too much");
(function () {
  var f = one({ ceiling: 50, budgets: [{ from: "2025-01", amount: 100 }] },
              credit(500).concat([{ id: "x", fundId: "f", amount: -400, date: M + "-05" }]));
  ok("over budget wins over the ceiling", fundStatus(f).key === "overspent", fundStatus(f).key);
  var g = one({ ceiling: 10 }, credit(-5));
  ok("overdrawn wins too", fundStatus(g).key === "over", fundStatus(g).key);
})();

sec("it reaches needs-attention as a release, not as a fix");
(function () {
  one({ ceiling: 2000, budgets: [{ from: "2025-01", amount: 300 }] }, credit(2340));
  var is = issues();
  eq("one item", is.length, 1);
  eq("  offering a release", is[0].release, 340);
  eq("  and NOT offering to add money", is[0].fix, 0);
  ok("  ranked below every real problem", is[0].rank === RANKS.overceiling);
  ok("  which is the least severe rank there is",
     Math.max.apply(null, Object.keys(RANKS).map(function (k) { return RANKS[k]; })) === RANKS.overceiling);
})();

sec("the release is a transfer, and it is reversible");
(function () {
  var f = one({ ceiling: 2000, budgets: [{ from: "2025-01", amount: 300 }] }, credit(2340));
  var before = balanceOf();
  releaseFund("f");
  var moved = transfersOf({ fund: "f" });
  eq("one leg recorded", moved.length, 1);
  eq("  negative, leaving the fund", moved[0].amount, -340);
  ok("  tagged as a transfer, so it is neither income nor spending",
     moved[0].kind === "transfer", String(moved[0].kind));
  eq("  it does not count as spending", monthStats({ fund: "f" }, M).spent, 0);
  eq("  nor as a credit", monthStats({ fund: "f" }, M).credited, 0);
  ok("  the note names the ceiling", /ceiling/.test(moved[0].note), moved[0].note);
  eq("total allocated drops by the released amount", balanceOf(), before - 340);
  deleteTransfer(moved[0].pairId);
  eq("undoing puts it back", balanceOfFund("f"), 2340);
  eq("  and it is offered again", releasableOf(fundById("f")), 340);
})();

sec("released money becomes unallocated, and the bank is untouched");
(function () {
  state = normalize({ meta: { planStart: "2025-01" },
    cashReadings: [{ id: "r", date: "2026-01-01", amount: 10000 }],
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Cars", createdAt: "2025-01-01", ceiling: 2000 }],
    ledger: credit(2340) });
  var cash = cashNow(), alloc = balanceOf();
  eq("unallocated before", cash - alloc, 10000 - 2340);
  releaseFund("f");
  eq("the bank is unchanged — this was only ever a label", cashNow(), cash);
  eq("allocated falls", balanceOf(), alloc - 340);
  eq("so unallocated rises by the same amount", cashNow() - balanceOf(), 10000 - 2000);
})();

sec("round-trip and hardening");
(function () {
  var f = one({ ceiling: "2500" }, []);
  eq("a string ceiling coerces", f.ceiling, 2500);
  eq("a negative ceiling clamps to zero", one({ ceiling: -10 }, []).ceiling, 0);
  eq("junk becomes no ceiling", one({ ceiling: "abc" }, []).ceiling, 0);
  one({ ceiling: 2500 }, credit(100));
  var again = normalize(JSON.parse(JSON.stringify(state)));
  eq("it survives a reload", again.funds[0].ceiling, 2500);
  ok("re-normalizing is stable", JSON.stringify(normalize(again)) === JSON.stringify(again));
  // a fund with no ceiling at all must not gain one
  eq("absent stays absent", one({}, []).ceiling, 0);
})();

/* Deallocate: the same "never hand back what's needed" guard as releasableOf,
 * but for a fund with genuinely free money and NO ceiling to trigger the
 * one-click Release. This is what the fund page's "Deallocate $X" button
 * offers, pre-filled into the Move dialog. */

sec("deallocatableOf — the everyday case, no ceiling involved");
(function () {
  var f = one({ budgets: [{ from: "2025-01", amount: 300 }] }, credit(1400));
  eq("free money above this month's budget claim", deallocatableOf(f), 1100);
  eq("matches commitmentParts' free bucket here", deallocatableOf(f), commitmentParts(f).free);
})();

sec("THE GUARD, again: a savings target is protected even with no ceiling");
(function () {
  // commitmentParts doesn't know about `target` at all — free would happily
  // include it if deallocatableOf didn't go through lockedOf instead.
  var f = one({ target: 1000, budgets: [{ from: "2025-01", amount: 0 }] }, credit(1400));
  eq("commitmentParts alone would over-offer", commitmentParts(f).free, 1400);
  eq("but the target holds firm", deallocatableOf(f), 400);
})();

sec("a buffer with no ceiling reserves its whole balance either way");
(function () {
  // commitmentParts already reserves the FULL balance for a buffer with no
  // ceiling, regardless of the floor's specific value — a stronger guarantee
  // than the floor alone, so deallocatableOf agrees at zero in both cases.
  var f = one({ buffer: true, floor: 1000 }, credit(1400));
  eq("free:0 by design", commitmentParts(f).free, 0);
  eq("deallocatableOf agrees — nothing to offer", deallocatableOf(f), 0);
  eq("same with a lower floor — no ceiling still reserves everything",
     deallocatableOf(one({ buffer: true, floor: 500 }, credit(1400))), 0);
})();

sec("nothing free means nothing deallocatable");
(function () {
  eq("fully committed", deallocatableOf(one({ budgets: [{ from: "2025-01", amount: 300 }] }, credit(300))), 0);
  eq("negative balance", deallocatableOf(one({ budgets: [{ from: "2025-01", amount: 300 }] }, credit(-50))), 0);
  eq("no fund at all", deallocatableOf(null), 0);
})();

sec("Release and Deallocate never both claim the same money");
(function () {
  // over a ceiling: Release is the one-click path, and it already caps at
  // exactly what's safe — Deallocate ignoring the ceiling would only matter
  // if it found MORE than Release does, which the UI's fallback order
  // (Release first, Deallocate only when Release has nothing) depends on.
  var f = one({ ceiling: 2000, budgets: [{ from: "2025-01", amount: 300 }] }, credit(2340));
  ok("Release has something to offer", releasableOf(f) > 0.005, String(releasableOf(f)));
  eq("Deallocate would offer at least as much", deallocatableOf(f) >= releasableOf(f) ? 1 : 0, 1);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

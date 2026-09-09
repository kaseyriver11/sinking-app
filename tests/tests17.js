/* Moving money: between funds, and releasing it back to unallocated. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function setup() {
  state = normalize({
    cashReadings: [{ id: "r", date: "2026-01-01", amount: 20000 }],
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "trav", categoryId: "c", name: "Travel", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 1000 }] },
            { id: "roof", categoryId: "c", name: "Roof", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 200 }] }],
    ledger: [{ id: "l1", fundId: "trav", amount: 8000, date: "2026-01-05", kind: "allotment" },
             { id: "l2", fundId: "roof", amount: 500, date: "2026-01-05", kind: "allotment" }] });
}

sec("thinning a ballooning fund back to unallocated");
setup();
eq("Travel before", balanceOfFund("trav"), 8000);
eq("unallocated before", unallocated(), 20000 - 8500);
moveMoney("trav", null, 3000, "2026-08-25", "Trimming Travel");
eq("Travel after", balanceOfFund("trav"), 5000);
eq("unallocated grew by the same", unallocated(), 20000 - 5500);
eq("cash in the bank is untouched", cashNow(), 20000);
eq("total allocated fell", allocated(), 5500);
ok("one leg written", transfersOf({ fund: "trav" }).length === 1);

sec("a release is neither income nor spending");
var ms = monthStats({ fund: "trav" }, "2026-08");
eq("not counted as spending", ms.spent, 0);
eq("not counted as a credit", ms.credited, 0);
eq("but visible as money moved out", ms.movedOut, 3000);
ok("it stays out of the expenses list", expensesOf({ fund: "trav" }).length === 0);
ok("and out of the credits list", creditsOf({ fund: "trav" }).length === 1);
ok("it appears in the transfers list", transfersOf({ fund: "trav" }).length === 1);

sec("moving between two funds");
setup();
moveMoney("trav", "roof", 2000, "2026-08-25", "Roof needs it more");
eq("source drops", balanceOfFund("trav"), 6000);
eq("destination rises", balanceOfFund("roof"), 2500);
eq("total allocated is unchanged", allocated(), 8500);
eq("unallocated is unchanged", unallocated(), 11500);
ok("both legs written", transfersOf({}).length === 2, String(transfersOf({}).length));
ok("they share a pair id",
   transfersOf({})[0].pairId === transfersOf({})[1].pairId);
eq("neither counts as spending", monthStats({ cat: "c" }, "2026-08").spent, 0);
eq("nor as a credit", monthStats({ cat: "c" }, "2026-08").credited, 0);

sec("allocating from unallocated into a fund");
setup();
moveMoney(null, "roof", 1500, "2026-08-25", "Putting spare cash to work");
eq("the fund grows", balanceOfFund("roof"), 2000);
eq("unallocated shrinks", unallocated(), 20000 - 10000);
eq("cash unchanged", cashNow(), 20000);
ok("only one leg", transfersOf({}).length === 1);
eq("not counted as a credit", monthStats({ fund: "roof" }, "2026-08").credited, 0);

sec("undoing a move takes both legs");
setup();
moveMoney("trav", "roof", 2000, "2026-08-25", "oops");
var pid = transfersOf({})[0].pairId;
deleteTransfer(pid);
eq("source restored", balanceOfFund("trav"), 8000);
eq("destination restored", balanceOfFund("roof"), 500);
ok("no transfers left", transfersOf({}).length === 0);
ok("both ids tombstoned", state.meta.deleted.length === 2, String(state.meta.deleted.length));
var round = normalize(JSON.parse(JSON.stringify(state)));
ok("and they stay gone after a reload", round.ledger.filter(function (e) {
  return e.kind === "transfer"; }).length === 0);

sec("guards");
setup();
var before = balanceOfFund("trav");
moveMoney("trav", "trav", 100, "2026-08-25", "silly");
eq("moving to itself does nothing", balanceOfFund("trav"), before);
moveMoney("trav", "roof", 0, "2026-08-25", "zero");
eq("a zero move does nothing", balanceOfFund("trav"), before);
moveMoney("trav", "roof", -50, "2026-08-25", "negative");
eq("a negative move does nothing", balanceOfFund("trav"), before);
ok("no entries written by any of them", transfersOf({}).length === 0);

sec("a move can overdraw, and says so through the normal status");
setup();
moveMoney("roof", null, 900, "2026-08-25", "too much");
eq("the fund goes negative", balanceOfFund("roof"), -400);
ok("status reports overdrawn", fundStatus(fundById("roof")).key === "over",
   fundStatus(fundById("roof")).key);
eq("nothing is committed from a negative balance", committedOfFund(fundById("roof")), 0);

sec("transfers do not disturb the commitment split");
setup();
var p0 = commitmentParts(fundById("trav"));
moveMoney("trav", null, 3000, "2026-08-25", "trim");
var p1 = commitmentParts(fundById("trav"));
eq("this month's claim is unchanged by the move", p1.dueNow, p0.dueNow);
eq("free absorbs the whole reduction", p0.free - p1.free, 3000);
eq("parts still reconstruct the balance", p1.dueNow + p1.earmarks + p1.reserve + p1.free,
   balanceOfFund("trav"));

sec("history survives a round-trip");
setup();
moveMoney("trav", "roof", 1000, "2026-08-25", "shift");
var again = normalize(JSON.parse(JSON.stringify(state)));
ok("kind preserved", again.ledger.filter(function (e) { return e.kind === "transfer"; }).length === 2);
ok("pairId preserved", again.ledger.filter(function (e) { return !!e.pairId; }).length === 2);
state = again;
eq("balances hold", balanceOfFund("trav"), 7000);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

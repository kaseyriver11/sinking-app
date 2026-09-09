/* Split expense: one real-world purchase recorded against several funds at once. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function setup() {
  state = normalize({
    categories: [{ id: "c", name: "Home" }],
    funds: [
      { id: "gro", categoryId: "c", name: "Groceries", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 500 }] },
      { id: "kid", categoryId: "c", name: "Kids' Stuff", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 200 }] },
      { id: "car", categoryId: "c", name: "Car Payment", createdAt: "2026-01-01",
        archivedAt: "2026-02-01" },
    ],
    ledger: [] });
}

sec("a split writes one ordinary expense per fund, linked by splitId");
setup();
var sid = addSplitExpense(
  [{ fundId: "gro", amt: 140 }, { fundId: "kid", amt: 60 }],
  "2026-08-20", "Target run");
eq("groceries drops by its share", balanceOfFund("gro"), -140);
eq("kids' stuff drops by its share", balanceOfFund("kid"), -60);
ok("two ledger rows written", state.ledger.length === 2, String(state.ledger.length));
ok("both share the same splitId", state.ledger.every(function (e) { return e.splitId === sid; }));
ok("both are ordinary expenses (kind stays null)",
   state.ledger.every(function (e) { return e.kind === null; }));
ok("both carry the shared note", state.ledger.every(function (e) { return e.note === "Target run"; }));
ok("both are dated the same day", state.ledger.every(function (e) { return e.date === "2026-08-20"; }));

sec("each part counts as normal spending — no special casing needed elsewhere");
var ms = monthStats({ fund: "gro" }, "2026-08");
eq("counted as spent", ms.spent, 140);
eq("not counted as a credit", ms.credited, 0);
ok("it appears in the fund's expenses list", expensesOf({ fund: "gro" }).length === 1);

sec("splitTip names the total and every fund involved");
var tip = splitTip(state.ledger[0]);
ok("mentions the total", tip.indexOf("$200") >= 0, tip);
ok("mentions both fund names", tip.indexOf("Groceries") >= 0 && tip.indexOf("Kids' Stuff") >= 0, tip);
ok("mentions the count", tip.indexOf("2 funds") >= 0, tip);

sec("deleteSplitGroup undoes the whole thing in one shot");
setup();
sid = addSplitExpense([{ fundId: "gro", amt: 140 }, { fundId: "kid", amt: 60 }],
  "2026-08-20", "Target run");
deleteSplitGroup(sid);
eq("groceries restored", balanceOfFund("gro"), 0);
eq("kids' stuff restored", balanceOfFund("kid"), 0);
ok("no ledger rows left", state.ledger.length === 0);
ok("both ids tombstoned", state.meta.deleted.length === 2, String(state.meta.deleted.length));
var round = normalize(JSON.parse(JSON.stringify(state)));
ok("and they stay gone after a reload", round.ledger.length === 0);

sec("deleting one part individually leaves the others untouched");
setup();
sid = addSplitExpense([{ fundId: "gro", amt: 140 }, { fundId: "kid", amt: 60 }],
  "2026-08-20", "Target run");
var groId = state.ledger.filter(function (e) { return e.fundId === "gro"; })[0].id;
deleteEntry(groId);
eq("groceries is back to zero", balanceOfFund("gro"), 0);
eq("kids' stuff still shows its share", balanceOfFund("kid"), -60);
ok("one row left, still carrying the splitId",
   state.ledger.length === 1 && state.ledger[0].splitId === sid);

sec("splitId survives a normalize() round-trip");
setup();
sid = addSplitExpense([{ fundId: "gro", amt: 140 }, { fundId: "kid", amt: 60 }],
  "2026-08-20", "Target run");
var reloaded = normalize(JSON.parse(JSON.stringify(state)));
ok("both rows keep their splitId after reload",
   reloaded.ledger.every(function (e) { return e.splitId === sid; }),
   JSON.stringify(reloaded.ledger.map(function (e) { return e.splitId; })));

sec("splitId survives a mergeStates() merge");
setup();
sid = addSplitExpense([{ fundId: "gro", amt: 140 }, { fundId: "kid", amt: 60 }],
  "2026-08-20", "Target run");
var base = JSON.parse(JSON.stringify(state));
setup();   // an older copy that never saw the split
var merged = mergeStates(normalize(state), normalize(base));
var splitRows = merged.ledger.filter(function (e) { return e.splitId === sid; });
eq("both split rows survive the merge", splitRows.length, 2);

sec("matchFundLoose: exact, prefix, substring, initials, no match, archived excluded");
setup();
ok("exact (case-insensitive)", matchFundLoose("groceries").id === "gro");
ok("prefix", matchFundLoose("Groc").id === "gro");
ok("substring", matchFundLoose("stuff").id === "kid");
ok("initials", matchFundLoose("ks").id === "kid");
ok("no match returns null", matchFundLoose("nonsense xyz") === null);
ok("blank returns null", matchFundLoose("") === null);
ok("archived funds are never matched", matchFundLoose("car payment") === null);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

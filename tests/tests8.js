/* Deleting and archiving categories and funds. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.005, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function fresh() {
  state = normalize({
    categories: [{ id: "u", name: "Utilities" }, { id: "a", name: "Auto" }],
    funds: [{ id: "energy", categoryId: "u", name: "Energy", monthlyAllotment: 180 },
            { id: "water", categoryId: "u", name: "Water", monthlyAllotment: 60 },
            { id: "ins", categoryId: "a", name: "Insurance", monthlyAllotment: 120 }],
    ledger: [
      { id: "l1", fundId: "energy", amount: 180, date: "2026-08-01" },
      { id: "l2", fundId: "energy", amount: -140, date: "2026-08-12" },
      { id: "l3", fundId: "water", amount: 60, date: "2026-08-01" },
      { id: "l4", fundId: "ins", amount: 120, date: "2026-08-01" },
    ] });
}

sec("delete a fund");
fresh();
eq("baseline total", balanceOf(), 220);
deleteFund("water");
ok("the fund is gone", !fundById("water"));
ok("its entries are gone", !state.ledger.some(function (e) { return e.fundId === "water"; }));
ok("its entries are tombstoned", state.meta.deleted.indexOf("l3") >= 0);
eq("category balance drops by that fund", balanceOfCat("u"), 40);
eq("grand total drops too", balanceOf(), 160);
ok("sibling funds untouched", !!fundById("energy") && balanceOfFund("energy") === 40);
ok("other categories untouched", !!fundById("ins"));
ok("the parent category survives", !!catById("u"));

sec("delete a category takes its funds and history");
fresh();
var im = impactOfCategory("u");
ok("impact reports 2 funds", im.funds === 2, String(im.funds));
ok("impact reports 3 entries", im.entries === 3, String(im.entries));
eq("impact reports the balance at risk", im.balance, 100);
deleteCategory("u");
ok("the category is gone", !catById("u"));
ok("both its funds are gone", !fundById("energy") && !fundById("water"));
ok("all their entries are gone",
   !state.ledger.some(function (e) { return ["energy", "water"].indexOf(e.fundId) >= 0; }));
ok("all three ids tombstoned",
   ["l1", "l2", "l3"].every(function (i) { return state.meta.deleted.indexOf(i) >= 0; }));
eq("only the other category's money remains", balanceOf(), 120);
ok("the untouched category is intact", !!catById("a") && !!fundById("ins"));
ok("its entry survives", state.ledger.some(function (e) { return e.id === "l4"; }));

sec("deleting an empty category");
fresh();
addCategory({ id: "empty", name: "Empty" });
var im2 = impactOfCategory(state.categories[state.categories.length - 1].id);
ok("impact on an empty category is zero", im2.funds === 0 && im2.entries === 0);
deleteCategory(state.categories[state.categories.length - 1].id);
ok("it just disappears", cats().length === 2, String(cats().length));
eq("nothing else moved", balanceOf(), 220);

sec("delete survives a reload (tombstones hold)");
fresh();
deleteFund("water");
var reloaded = normalize(JSON.parse(JSON.stringify(state)));
ok("the fund stays gone after normalize", !reloaded.funds.some(function (f) { return f.id === "water"; }));
ok("its entries stay gone", !reloaded.ledger.some(function (e) { return e.id === "l3"; }));
ok("tombstones persist", reloaded.meta.deleted.indexOf("l3") >= 0);

sec("archive is reversible");
fresh();
archiveCategory("u");
ok("category hidden from the rail", cats().length === 1, String(cats().length));
ok("its funds hidden too", allFunds().length === 1, String(allFunds().length));
ok("but nothing was removed", state.ledger.length === 4 && state.funds.length === 3);
eq("archived money is excluded from the total", balanceOf(), 120);
unarchiveCategory("u");
ok("category is back", cats().length === 2, String(cats().length));
ok("its funds are back", allFunds().length === 3, String(allFunds().length));
eq("and so is its money", balanceOf(), 220);

sec("archiving one fund, then restoring it");
fresh();
updateFund("water", { archivedAt: "2026-08-25" });
ok("only that fund is hidden", fundsOf("u").length === 1, String(fundsOf("u").length));
eq("its balance leaves the roll-up", balanceOfCat("u"), 40);
unarchiveFund("water");
ok("it comes back", fundsOf("u").length === 2);
eq("with its balance", balanceOfCat("u"), 100);

sec("archived items are discoverable");
fresh();
archiveCategory("u");
updateFund("ins", { archivedAt: "2026-08-25" });
var aCats = state.categories.filter(function (c) { return c.archivedAt; });
var aFunds = state.funds.filter(function (f) {
  var c = catById(f.categoryId); return f.archivedAt && !(c && c.archivedAt); });
ok("the archived category is listed", aCats.length === 1, String(aCats.length));
ok("a separately-archived fund is listed", aFunds.length === 1, String(aFunds.length));
ok("funds hidden by their parent aren't listed twice",
   !aFunds.some(function (f) { return f.categoryId === "u"; }));

sec("delete beats archive");
fresh();
archiveCategory("u");
deleteCategory("u");
ok("an archived category can still be deleted", !catById("u"));
ok("and its funds go with it", !fundById("energy") && !fundById("water"));
eq("balance settles", balanceOf(), 120);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

/* v3: categories contain funds. Migration, roll-ups, reordering, real
   edit/delete with tombstones, and merge under those semantics. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.005, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

/* ── migration ─────────────────────────────────────────────────────────── */
sec("v1 (funds/fundId) -> v3");
var V1 = { schemaVersion: 1, meta: { lastBackup: "2026-08-01" },
  funds: [{ id: "f1", name: "Car registration", target: 650, targetDate: "2027-03-01", note: "March" },
          { id: "f2", name: "Holiday gifts", target: 1200 }],
  ledger: [{ id: "a1", fundId: "f1", amount: 55, date: "2026-01-15" },
           { id: "a2", fundId: "f1", amount: 55, date: "2026-02-15" },
           { id: "a3", fundId: "f2", amount: 95, date: "2026-02-15" },
           { id: "a4", fundId: "f2", amount: -30, date: "2026-03-02" }] };
state = normalize(V1);
ok("two categories created", state.categories.length === 2, String(state.categories.length));
ok("two funds created", state.funds.length === 2, String(state.funds.length));
ok("each fund keeps its original id", state.funds.map(function (f) { return f.id; }).sort().join(",") === "f1,f2");
ok("each category wraps exactly one fund",
   state.categories.every(function (c) { return fundsOf(c.id).length === 1; }));
ok("names carried to both levels",
   state.categories[0].name === "Car registration" && state.funds[0].name === "Car registration");
ok("money settings landed on the FUND", state.funds[0].target === 650 && state.funds[0].targetDate === "2027-03-01");
ok("categories carry no money fields", state.categories[0].target === undefined);
ok("no ledger rows lost", state.ledger.length === 4, String(state.ledger.length));
ok("fundId still resolves", state.ledger.every(function (e) { return !!fundById(e.fundId); }));
eq("v1 balances preserved (f1)", balanceOfFund("f1"), 110);
eq("v1 balances preserved (f2)", balanceOfFund("f2"), 65);
eq("v1 total preserved", balanceOf(), 175);
ok("meta preserved", state.meta.lastBackup === "2026-08-01");
ok("schemaVersion is a positive integer",
   Number.isInteger(blankState().schemaVersion) && blankState().schemaVersion >= 6,
   String(blankState().schemaVersion));

sec("v2 (categories/categoryId) -> v3");
var V2 = { schemaVersion: 2, meta: { cashReserves: 5000 },
  categories: [{ id: "c1", name: "Groceries", monthlyAllotment: 300, icon: "🛒", color: "aqua" },
               { id: "c2", name: "Travel", monthlyAllotment: 150, icon: "✈️", color: "violet" }],
  ledger: [{ id: "b1", categoryId: "c1", amount: 300, date: "2026-08-01", kind: "allotment" },
           { id: "b2", categoryId: "c1", amount: -96, date: "2026-08-07" },
           { id: "b3", categoryId: "c2", amount: 150, date: "2026-08-01", kind: "allotment" }] };
state = normalize(V2);
ok("each v2 category became a category + fund", state.categories.length === 2 && state.funds.length === 2);
ok("icon survived onto the category", state.categories[0].icon === "🛒");
ok("colour survived onto the category", state.categories[0].color === "aqua");
ok("monthly budget landed on the fund as a dated series",
   budgetOfFund(state.funds[0]) === 300, String(budgetOfFund(state.funds[0])));
ok("categoryId ledger rows re-point at the fund", state.ledger.every(function (e) { return !!fundById(e.fundId); }));
eq("v2 balance preserved", balanceOfFund("c1"), 204);
eq("cash reserves preserved", state.meta.cashReserves, 5000);
ok("allotment kind preserved", state.ledger.filter(function (e) { return e.kind === "allotment"; }).length === 2);

sec("v3 round-trips unchanged");
(function () {
  var once = normalize(state);
  ok("normalize is idempotent on v3", JSON.stringify(normalize(once)) === JSON.stringify(once));
  ok("no extra categories invented", once.categories.length === state.categories.length);
})();

/* ── roll-ups ──────────────────────────────────────────────────────────── */
sec("roll-ups");
state = normalize({
  categories: [{ id: "u", name: "Utilities", icon: "💡", color: "yellow" },
               { id: "a", name: "Auto", icon: "🚗", color: "blue" }],
  funds: [{ id: "energy", categoryId: "u", name: "House Energy", monthlyAllotment: 180 },
          { id: "water", categoryId: "u", name: "Water", monthlyAllotment: 60 },
          { id: "ins", categoryId: "a", name: "Car insurance", monthlyAllotment: 120 }],
  ledger: [
    { id: "l1", fundId: "energy", amount: 180, date: "2026-08-01", kind: "allotment" },
    { id: "l2", fundId: "energy", amount: -140, date: "2026-08-12" },
    { id: "l3", fundId: "water", amount: 60, date: "2026-08-01", kind: "allotment" },
    { id: "l4", fundId: "ins", amount: 120, date: "2026-08-01", kind: "allotment" },
    { id: "l5", fundId: "ins", amount: -400, date: "2026-08-20" },
  ] });
eq("fund balance", balanceOfFund("energy"), 40);
eq("category balance is the sum of its funds", balanceOfCat("u"), 100);
eq("other category", balanceOfCat("a"), -280);
eq("grand total is the sum of categories", balanceOf(), -180);
eq("total equals the sum of every entry", balanceOf(),
   state.ledger.reduce(function (s, e) { return s + e.amount; }, 0));
eq("category monthly budget rolls up", budgetOfCat("u"), 240);
var cs = monthStats({ cat: "u" }, "2026-08");
eq("category month credited", cs.credited, 240);
eq("category month spent", cs.spent, 140);
eq("category month net", cs.net, 100);
var fs = monthStats({ fund: "energy" }, "2026-08");
eq("fund month spent", fs.spent, 140);
eq("scope-less month stats cover everything", monthStats({}, "2026-08").credited, 360);
ok("entriesFor(cat) picks up every fund in it", entriesFor({ cat: "u" }).length === 3,
   String(entriesFor({ cat: "u" }).length));
ok("series can be scoped to a category", balanceSeries({ cat: "u" }).length > 0);
eq("category series ends at the category balance",
   balanceSeries({ cat: "u" }).pop().value, balanceOfCat("u"));
eq("fund series ends at the fund balance",
   balanceSeries({ fund: "ins" }).pop().value, balanceOfFund("ins"));

sec("category status is the worst of its funds");
ok("an overdrawn fund flags its category", catStatus(catById("a")).key === "over",
   catStatus(catById("a")).key);
ok("an empty category says so",
   catStatus(normalize({ categories: [{ id: "z", name: "Z" }], funds: [], ledger: [] }).categories[0]).key === "empty");

/* ── reordering ────────────────────────────────────────────────────────── */
sec("reordering");
function names() { return cats().map(function (c) { return c.name; }).join(","); }
function fnames(cid) { return fundsOf(cid).map(function (f) { return f.name; }).join(","); }
ok("initial category order", names() === "Utilities,Auto", names());
moveCategory("a", -1);
ok("moving up swaps with the previous", names() === "Auto,Utilities", names());
moveCategory("a", -1);
ok("moving past the top is a no-op", names() === "Auto,Utilities", names());
moveCategory("a", 1);
ok("moving down swaps back", names() === "Utilities,Auto", names());
moveCategory("a", 1);
ok("moving past the bottom is a no-op", names() === "Utilities,Auto", names());

ok("initial fund order", fnames("u") === "House Energy,Water", fnames("u"));
moveFund("water", -1);
ok("fund moves up within its category", fnames("u") === "Water,House Energy", fnames("u"));
moveFund("water", -1);
ok("fund can't move above its category's first", fnames("u") === "Water,House Energy", fnames("u"));
moveFund("ins", -1);
ok("a lone fund in another category doesn't move", fnames("a") === "Car insurance", fnames("a"));
ok("reordering never moves a fund across categories",
   fundsOf("u").every(function (f) { return f.categoryId === "u"; }) &&
   fundsOf("a").every(function (f) { return f.categoryId === "a"; }));
eq("reordering doesn't touch balances", balanceOf(), -180);

/* ── permanent delete + tombstones ─────────────────────────────────────── */
sec("delete is permanent");
var before = state.ledger.length;
deleteEntry("l2");
ok("the row is gone", !state.ledger.some(function (e) { return e.id === "l2"; }));
ok("ledger shrank by one", state.ledger.length === before - 1);
eq("balance reflects the removal", balanceOfFund("energy"), 180);
ok("a tombstone was recorded", state.meta.deleted.indexOf("l2") >= 0);
deleteEntry("l2");
ok("deleting twice doesn't duplicate the tombstone",
   state.meta.deleted.filter(function (x) { return x === "l2"; }).length === 1);

sec("edit is in place");
editEntry("l1", { amount: 200, note: "revised" });
var l1 = state.ledger.filter(function (e) { return e.id === "l1"; });
ok("still exactly one row for the id", l1.length === 1, String(l1.length));
eq("amount changed", l1[0].amount, 200);
ok("note changed", l1[0].note === "revised");
ok("updatedAt was stamped", !!l1[0].updatedAt);
eq("balance follows the edit", balanceOfFund("energy"), 200);
editEntry("l1", { fundId: "water" });
eq("an edit can move an entry between funds", balanceOfFund("water"), 260);
eq("  and the old fund loses it", balanceOfFund("energy"), 0);

/* ── merge under mutable entries ───────────────────────────────────────── */
sec("merge respects deletes and newer edits");
(function () {
  var onDisk = { schemaVersion: 3, meta: { deleted: [] },
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "energy", categoryId: "u", name: "House Energy" }],
    ledger: [{ id: "x", fundId: "energy", amount: 100, date: "2026-08-01", updatedAt: "2026-08-01T00:00:00Z" },
             { id: "y", fundId: "energy", amount: 50, date: "2026-08-02", updatedAt: "2026-08-02T00:00:00Z" }] };
  var mirror = { schemaVersion: 3, meta: { deleted: ["y"] },
    categories: onDisk.categories, funds: onDisk.funds,
    ledger: [{ id: "x", fundId: "energy", amount: 999, date: "2026-08-01", updatedAt: "2026-08-09T00:00:00Z" },
             { id: "z", fundId: "energy", amount: 7, date: "2026-08-08", updatedAt: "2026-08-08T00:00:00Z" }] };
  var m = normalize(mergeStates(onDisk, mirror));
  ok("a deletion made offline is NOT resurrected", !m.ledger.some(function (e) { return e.id === "y"; }));
  ok("the tombstone is carried forward", m.meta.deleted.indexOf("y") >= 0);
  var x = m.ledger.filter(function (e) { return e.id === "x"; })[0];
  eq("the newer edit wins", x.amount, 999);
  ok("an entry only in the mirror survives", m.ledger.some(function (e) { return e.id === "z"; }));
  ok("three rows became two kept + one new", m.ledger.length === 2, String(m.ledger.length));

  // and the reverse direction: file is newer
  var m2 = normalize(mergeStates(mirror, onDisk));
  ok("merging the other way still honours the tombstone",
     !m2.ledger.some(function (e) { return e.id === "y"; }));
  eq("and still keeps the newest edit", m2.ledger.filter(function (e) { return e.id === "x"; })[0].amount, 999);
})();

sec("archiving a category hides its funds");
state = normalize({
  categories: [{ id: "u", name: "Utilities" }],
  funds: [{ id: "e1", categoryId: "u", name: "Energy" }],
  ledger: [{ id: "q", fundId: "e1", amount: 10, date: "2026-08-01" }] });
archiveCategory("u");
ok("category hidden", cats().length === 0);
ok("its funds hidden too", allFunds().length === 0);
ok("history is untouched", state.ledger.length === 1);


sec("a future-dated entry must not make the line double back");
(function () {
  var TODAY = todayStr();
  var LATER = todayStr(new Date(parseDate(TODAY).getTime() + 6 * 86400000));
  var EARLIER = todayStr(new Date(parseDate(TODAY).getTime() - 20 * 86400000));

  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Auto Maintenance" }],
    ledger: [{ id: "a", fundId: "f", amount: 1000, date: EARLIER },
             { id: "b", fundId: "f", amount: 150, date: LATER, note: "September" }] });

  var s = balanceSeries({ fund: "f" });
  // the reported bug: a trailing "today" point was appended even though today is
  // BEFORE the last entry, so the series went ... LATER, TODAY — backwards
  ok("the series is strictly chronological",
     s.every(function (p, i) { return i === 0 || s[i - 1].date <= p.date; }),
     s.map(function (p) { return p.date; }).join(" -> "));
  ok("  it ends on the last entry, not on today",
     s[s.length - 1].date === LATER, s[s.length - 1].date);
  eq("  two points, not three", s.length, 2);
  eq("  ending at the full balance", s[s.length - 1].value, 1150);
  ok("  no date appears twice",
     new Set(s.map(function (p) { return p.date; })).size === s.length);

  // the ordinary case still gets carried forward to today
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "g", categoryId: "c", name: "Groceries" }],
    ledger: [{ id: "a", fundId: "g", amount: 500, date: EARLIER }] });
  var s2 = balanceSeries({ fund: "g" });
  eq("a past-only fund gains a point at today", s2.length, 2);
  ok("  dated today", s2[1].date === TODAY, s2[1].date);
  eq("  holding the balance flat", s2[1].value, 500);

  // and an entry dated exactly today isn't duplicated
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "h", categoryId: "c", name: "Today" }],
    ledger: [{ id: "a", fundId: "h", amount: 200, date: TODAY }] });
  eq("an entry dated today gives exactly one point", balanceSeries({ fund: "h" }).length, 1);

  // every fund in a realistic file — all of them had a September credit
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f1", categoryId: "c", name: "A" }, { id: "f2", categoryId: "c", name: "B" }],
    ledger: [{ id: "x", fundId: "f1", amount: 100, date: LATER },
             { id: "y", fundId: "f2", amount: 200, date: LATER }] });
  var whole = balanceSeries({});
  ok("the all-fund series is chronological too",
     whole.every(function (p, i) { return i === 0 || whole[i - 1].date <= p.date; }),
     whole.map(function (p) { return p.date; }).join(" -> "));
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

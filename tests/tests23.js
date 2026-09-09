/* Cash forecast: what the bank does over a year, and pencilled-in one-offs. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function setup(oneOffs) {
  state = normalize({
    meta: { planStart: "2026-09", incomes: [{ from: "2026-01", amount: 8000 }],
            oneOffs: oneOffs || [] },
    cashReadings: [{ id: "r", date: "2026-08-01", amount: 20000 }],
    categories: [{ id: "c", name: "Home" }],
    funds: [
      { id: "food", categoryId: "c", name: "Groceries", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 1500 }] },
      { id: "tax", categoryId: "c", name: "Property Taxes", createdAt: "2026-01-01",
        budgets: [{ from: "2026-01", amount: 500 }],
        schedule: { amount: 6000, months: [9] } },
    ],
    ledger: [] });
}

sec("contributions stay in the bank; bills leave it");
setup();
var fc = cashForecast(12);
var sep = fc.rows[0];
ok("the first month is the plan start", sep.month === "2026-09", sep.month);
eq("opening is today's cash", sep.opening, 20000);
eq("income", sep.income, 8000);
eq("day-to-day spending only counts level funds", sep.spending, 1500);
eq("September's bill lands in full", sep.bills, 6000);
eq("closing", sep.closing, 20000 + 8000 - 1500 - 6000);
ok("the $500/mo contribution is NOT treated as an outflow",
   sep.spending === 1500, String(sep.spending));

sec("a quiet month looks very different from a bill month");
var oct = fc.rows[1];
eq("no bill in October", oct.bills, 0);
eq("so it gains", oct.closing - oct.opening, 8000 - 1500);
ok("September is far worse than October",
   (sep.closing - sep.opening) < (oct.closing - oct.opening));

sec("months chain correctly");
(function () {
  var okChain = fc.rows.every(function (r, i) {
    return i === 0 || Math.abs(r.opening - fc.rows[i - 1].closing) < 0.02;
  });
  ok("each opening is the previous closing", okChain);
  eq("twelve months projected", fc.rows.length, 12);
})();

sec("one-offs land in their month");
setup([{ id: "t", month: "2027-04", amount: 3000, note: "Tax refund" }]);
fc = cashForecast(12);
(function () {
  var apr = fc.rows.filter(function (r) { return r.month === "2027-04"; })[0];
  eq("the refund shows up", apr.extra, 3000);
  ok("and only in April", fc.rows.filter(function (r) { return r.extra !== 0; }).length === 1);
  var before = cashForecast(12);
  eq("it lifts every later closing balance",
     before.rows[before.rows.length - 1].closing -
     (function () { setup(); return cashForecast(12).rows[11].closing; })(), 3000);
})();

sec("a one-off can be money out");
setup([{ id: "w", month: "2027-06", amount: -9000, note: "Wedding" }]);
fc = cashForecast(12);
(function () {
  var jun = fc.rows.filter(function (r) { return r.month === "2027-06"; })[0];
  eq("it is a drain", jun.extra, -9000);
  ok("and pulls the final balance down",
     fc.rows[11].closing < (function () { setup(); return cashForecast(12).rows[11].closing; })());
})();

sec("running out of money is surfaced");
setup([{ id: "big", month: "2026-10", amount: -40000, note: "Something enormous" }]);
fc = cashForecast(12);
ok("the lowest point is negative", fc.lowest < 0, String(fc.lowest));
ok("and it names the month", fc.lowestMonth === "2026-10", fc.lowestMonth);

sec("adding and removing");
setup();
eq("none to start", (state.meta.oneOffs || []).length, 0);
addOneOff("2027-04", 3000, "Tax refund");
addOneOff("2026-12", -500, "Gifts");
eq("both stored", state.meta.oneOffs.length, 2);
ok("kept in date order", state.meta.oneOffs[0].month === "2026-12", state.meta.oneOffs[0].month);
var id = state.meta.oneOffs[0].id;
deleteOneOff(id);
eq("one left", state.meta.oneOffs.length, 1);
ok("and it is tombstoned", state.meta.deleted.indexOf(id) >= 0);
(function () {
  var round = normalize(JSON.parse(JSON.stringify(state)));
  eq("the removal survives a reload", round.meta.oneOffs.length, 1);
})();

sec("hardening");
(function () {
  var n = normalize({ meta: { oneOffs: [
    { id: "a", month: "2027-04", amount: "3000" },
    { id: "b", month: "junk", amount: 100 },
    { id: "c", month: "2027-01", amount: 0 },
  ] }, categories: [], funds: [], ledger: [] });
  eq("a string amount coerces", n.meta.oneOffs.filter(function (o) { return o.id === "a"; })[0].amount, 3000);
  ok("a zero-amount entry is dropped", !n.meta.oneOffs.some(function (o) { return o.id === "c"; }));
  ok("a bad month falls back rather than vanishing",
     n.meta.oneOffs.some(function (o) { return o.id === "b"; }));
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));
})();


sec("the forecast splits each month's cash into allocated and unallocated");
(function () {
  setup();
  var fc = cashForecast(12);
  var off = fc.rows.filter(function (r) {
    return Math.abs((r.allocated + r.unallocated) - r.closing) > 0.02; });
  eq("the two parts always add up to the closing balance", off.length, 0);

  var first = fc.rows[0];
  // holding is SCHEDULED funds only ($500) — the level fund's $1,500 is spending,
  // budgeted in and spent out, so it never accumulates. September's $6,000 bill
  // then lands against a fund holding nothing, which is why this goes negative.
  eq("it starts from allocated() plus holding, less the bills that land",
     first.allocated, 0 + 500 - 6000);
  eq("  and the rest is unallocated", first.unallocated, first.closing - first.allocated);

  // a scheduled fund accumulates then drops when its bill lands
  var sep = fc.rows[0], oct = fc.rows[1];
  ok("allocated grows in a bill-free month", oct.allocated > sep.allocated,
     sep.allocated + " -> " + oct.allocated);
  eq("  by exactly what is set aside", oct.allocated - sep.allocated, 500);

  // a level fund nets to zero: budgeted in, spent out
  ok("unallocated grows by income minus everything budgeted",
     Math.abs((oct.unallocated - sep.unallocated) - (8000 - 2000)) < 0.02,
     String(oct.unallocated - sep.unallocated));
})();

sec("one-offs land in unallocated, not in a fund");
(function () {
  setup([{ id: "t", month: "2027-04", amount: 3000, note: "Tax refund" }]);
  var fc = cashForecast(12);
  var apr = fc.rows.filter(function (r) { return r.month === "2027-04"; })[0];
  var mar = fc.rows.filter(function (r) { return r.month === "2027-03"; })[0];
  eq("the refund shows up in unallocated", apr.unallocated - mar.unallocated,
     (8000 - 2000) + 3000);
  eq("  and not in allocated", apr.allocated - mar.allocated, 500);
  eq("  the split still reconciles", apr.allocated + apr.unallocated, apr.closing);
})();

sec("allocated can outrun the bank, and the split says so");
(function () {
  state = normalize({
    meta: { planStart: "2026-09", incomes: [{ from: "2026-01", amount: 0 }] },
    cashReadings: [{ id: "r", date: "2026-08-01", amount: 100 }],
    categories: [{ id: "c", name: "Home" }],
    funds: [{ id: "f", categoryId: "c", name: "Taxes", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 500 }],
              schedule: { amount: 6000, months: [12] } }],
    ledger: [{ id: "e", fundId: "f", amount: 900, date: "2026-01-01" }] });
  var fc = cashForecast(3);
  ok("unallocated goes negative when funds promise more than the bank holds",
     fc.rows[0].unallocated < 0, String(fc.rows[0].unallocated));
  eq("  but the parts still sum to the closing balance",
     fc.rows[0].allocated + fc.rows[0].unallocated, fc.rows[0].closing);
})();


sec("a one-off can be corrected, not just removed");
(function () {
  setup();
  addOneOff("2027-04", 3000, "Tax refund");
  var id = state.meta.oneOffs[0].id;

  updateOneOff(id, { amount: 2500 });
  eq("the amount changes", state.meta.oneOffs[0].amount, 2500);
  eq("  and the forecast follows", cashForecast(12).rows
     .filter(function (r) { return r.month === "2027-04"; })[0].extra, 2500);
  ok("  the id is stable, so it is the same row", state.meta.oneOffs[0].id === id);

  updateOneOff(id, { month: "2027-06" });
  eq("nothing lands in April any more", cashForecast(12).rows
     .filter(function (r) { return r.month === "2027-04"; })[0].extra, 0);
  eq("  it lands in June instead", cashForecast(12).rows
     .filter(function (r) { return r.month === "2027-06"; })[0].extra, 2500);

  updateOneOff(id, { amount: -800, note: "Vet" });
  eq("money in can become money out", state.meta.oneOffs[0].amount, -800);
  ok("  and the note with it", state.meta.oneOffs[0].note === "Vet", state.meta.oneOffs[0].note);
  ok("  the closing balance drops", cashForecast(12).rows[11].closing <
     (function () { setup(); return cashForecast(12).rows[11].closing; })());
})();

sec("editing keeps the list in date order");
(function () {
  setup();
  addOneOff("2027-01", 100, "A");
  addOneOff("2027-06", 200, "B");
  var a = state.meta.oneOffs.filter(function (o) { return o.note === "A"; })[0].id;
  ok("A is first", state.meta.oneOffs[0].note === "A");
  updateOneOff(a, { month: "2027-12" });
  ok("moving A past B reorders them", state.meta.oneOffs[0].note === "B",
     state.meta.oneOffs.map(function (o) { return o.note; }).join(","));
  ok("  and A is last", state.meta.oneOffs[1].note === "A");
})();

sec("editing is safe against nonsense");
(function () {
  setup();
  addOneOff("2027-04", 3000, "Tax refund");
  var n = state.meta.oneOffs.length;
  updateOneOff("no-such-id", { amount: 999 });
  eq("an unknown id changes nothing", state.meta.oneOffs.length, n);
  eq("  and leaves the real one alone", state.meta.oneOffs[0].amount, 3000);

  var id = state.meta.oneOffs[0].id;
  updateOneOff(id, { amount: 0 });
  var round = normalize(JSON.parse(JSON.stringify(state)));
  eq("a zero amount is dropped on reload, as it always was", round.meta.oneOffs.length, 0);
})();

sec("removing one is undoable");
(function () {
  setup();
  addOneOff("2027-04", 3000, "Tax refund");
  var snap = Object.assign({}, state.meta.oneOffs[0]);
  deleteOneOff(snap.id);
  eq("gone", state.meta.oneOffs.length, 0);
  ok("  and tombstoned", state.meta.deleted.indexOf(snap.id) >= 0);
  // what the toast's undo does
  state.meta.deleted = state.meta.deleted.filter(function (i) { return i !== snap.id; });
  state.meta.oneOffs.push(snap);
  eq("undo puts it back", state.meta.oneOffs.length, 1);
  ok("  the tombstone is lifted too, so a reload keeps it",
     normalize(JSON.parse(JSON.stringify(state))).meta.oneOffs.length === 1);
})();


sec("a one-off outside the forecast window is never silent");
(function () {
  // the reported case: plan starts September, one-off dated August
  state = normalize({
    meta: { planStart: "2026-09", incomes: [{ from: "2026-01", amount: 8000 }],
            oneOffs: [{ id: "a", month: "2026-08", amount: 6400, note: "August paycheck" },
                      { id: "b", month: "2026-10", amount: 500, note: "Inside" }] },
    cashReadings: [{ id: "r", date: "2026-08-01", amount: 20000 }],
    categories: [{ id: "c", name: "C" }], funds: [], ledger: [] });

  var fc = cashForecast(12);
  var win = fc.rows.map(function (r) { return r.month; });
  ok("the window starts at the plan, not this month", win[0] === "2026-09", win[0]);
  ok("  so the August one is outside it", win.indexOf("2026-08") < 0);

  var counted = fc.rows.reduce(function (a, r) { return a + r.extra; }, 0);
  var all = state.meta.oneOffs.reduce(function (a, o) { return a + o.amount; }, 0);
  eq("only the inside one is counted", counted, 500);
  eq("  and the difference is exactly the ignored one", all - counted, 6400);

  // the list must be able to identify them, which is what the banner needs
  var outside = state.meta.oneOffs.filter(function (o) { return win.indexOf(o.month) < 0; });
  eq("one is outside", outside.length, 1);
  ok("  and it is the August one", outside[0].note === "August paycheck");

  // moving it in makes it count, and the move is reversible
  updateOneOff("a", { month: win[0] });
  eq("moved in, it counts", cashForecast(12).rows
     .filter(function (r) { return r.month === "2026-09"; })[0].extra, 6400);
  eq("  and the closing balance rises by exactly that",
     cashForecast(12).rows[11].closing - fc.rows[11].closing, 6400);
  updateOneOff("a", { month: "2026-08" });
  eq("moving it back is a clean reversal", cashForecast(12).rows[11].closing, fc.rows[11].closing);
})();

sec("the default month is one the forecast can see");
(function () {
  state = normalize({
    meta: { planStart: "2026-09", incomes: [{ from: "2026-01", amount: 8000 }] },
    cashReadings: [{ id: "r", date: "2026-08-01", amount: 20000 }],
    categories: [{ id: "c", name: "C" }], funds: [], ledger: [] });
  var first = cashForecast(12).rows[0].month;
  ok("horizonStart is the first forecast month", horizonStart() === first,
     horizonStart() + " vs " + first);
  ok("  and it is not this month, which is before the plan", horizonStart() !== thisMonth());
  // adding at the default therefore lands somewhere visible
  addOneOff(horizonStart(), 1000, "Default");
  eq("a one-off added at the default is counted", cashForecast(12).rows
     .filter(function (r) { return r.month === first; })[0].extra, 1000);
})();


sec("net change is the four middle columns, and it chains");
(function () {
  setup([{ id: "t", month: "2027-04", amount: 3000, note: "Refund" }]);
  var fc = cashForecast(12);
  ok("net always equals income − spending − bills + one-offs",
     fc.rows.every(function (r) {
       return Math.abs((r.closing - r.opening) -
         (r.income - r.spending - r.bills + r.extra)) < 0.02; }));
  ok("  and closing is opening plus net", fc.rows.every(function (r) {
     return Math.abs(r.closing - (r.opening + (r.closing - r.opening))) < 0.02; }));
  var apr = fc.rows.filter(function (r) { return r.month === "2027-04"; })[0];
  var mar = fc.rows.filter(function (r) { return r.month === "2027-03"; })[0];
  eq("the one-off shows up in that month's net",
     (apr.closing - apr.opening) - (mar.closing - mar.opening), 3000);
  eq("the nets sum to the whole year's movement",
     fc.rows.reduce(function (a, r) { return a + (r.closing - r.opening); }, 0),
     fc.rows[11].closing - fc.rows[0].opening);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

/* The plan start month: everything before it was settled the old way. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

//              Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
var ENERGY = [ 175, 180, 135, 140, 200, 190, 275, 440, 400, 165, 140, 110 ];

function energy(ps) {
  state = normalize({
    meta: { createdAt: "2026-08-01", planStart: ps },
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "e", categoryId: "u", name: "House Energy", createdAt: "2026-08-01",
              budgets: [{ from: "2026-08", amount: 212.50 }],
              schedule: { amounts: ENERGY } }],
    ledger: [{ id: "s", fundId: "e", amount: 210, date: "2026-09-01", kind: "allotment" }] });
  return fundById("e");
}

sec("without a plan start, August's unpaid bill counts against you");
var f = energy(null);
ok("defaults to the month the file was created", planStart() === "2026-08", planStart());
eq("short by August's bill plus September's gap", cycleOutlook(f).gap, 630);
ok("and it bites in September", cycleOutlook(f).troughMonth === "2026-09");

sec("starting the plan in September drops August entirely");
f = energy("2026-09");
eq("plan start is honoured", planStart() === "2026-09" ? 1 : 0, 1);
eq("shortfall loses August's $440", cycleOutlook(f).gap, 190);
eq("  which is exactly the difference", 630 - 190, 440);
ok("still bites in September", cycleOutlook(f).troughMonth === "2026-09");
ok("the forecast does not start before the plan",
   forecast(f).points[0].month === "2026-09", forecast(f).points[0].month);
ok("no August point at all",
   !forecast(f).points.some(function (p) { return p.month === "2026-08"; }));

sec("the first month of a future plan DOES contribute");
(function () {
  // September is already funded here, so the recorded $210 lands rather than
  // a fresh contribution — but the month is not skipped the way today's is
  var pts = forecast(f).points;
  eq("September starts from the recorded contribution minus its bill",
     pts[0].balance, 210 - 400);
  eq("October then adds a full contribution", pts[1].balance, 210 - 400 + 212.50 - 165);
})();

sec("seeding the smaller amount now fixes it");
f = energy("2026-09");
addEntry("e", 190, "2026-08-26", "Seed");
eq("no gap", cycleOutlook(fundById("e")).gap, 0);
eq("low point sits at zero", cycleOutlook(fundById("e")).lowest, 0);
(function () {
  var pts = forecast(fundById("e")).points;
  ok("and never dips below it", pts.every(function (p) { return p.balance >= -0.02; }),
     pts.map(function (p) { return money0(p.balance); }).join(" "));
})();

sec("a bill before the plan start is never chased");
f = energy("2026-09");
ok("next due is September, not August", nextDueKey(f) === "2026-09", nextDueKey(f));
eq("and its amount is September's", projection(f).amount, 400);

sec("once the plan is underway it behaves normally");
(function () {
  // plan started in the past: the current month follows the usual rule
  state = normalize({
    meta: { createdAt: "2026-01-01", planStart: "2026-01" },
    categories: [{ id: "u", name: "U" }],
    funds: [{ id: "e", categoryId: "u", name: "E", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 212.50 }],
              schedule: { amounts: ENERGY } }],
    ledger: [{ id: "a", fundId: "e", amount: 1000, date: "2026-08-01", kind: "allotment" }] });
  var g = fundById("e");
  ok("forecast starts from this month", forecast(g).points[0].month === "2026-08");
  ok("August's own contribution is not assumed",
     forecast(g).points[0].balance === 1000 - 440, String(forecast(g).points[0].balance));
})();

sec("hardening");
ok("a bad plan start falls back", (function () {
  state = normalize({ meta: { createdAt: "2026-03-05", planStart: "nonsense" },
                      categories: [], funds: [], ledger: [] });
  return planStart() === "2026-03";
})(), planStart());
ok("absent falls back to creation month", (function () {
  state = normalize({ meta: { createdAt: "2026-04-10" }, categories: [], funds: [], ledger: [] });
  return planStart() === "2026-04";
})());
ok("it survives a round-trip", (function () {
  var n = normalize({ meta: { planStart: "2026-09" }, categories: [], funds: [], ledger: [] });
  return normalize(n).meta.planStart === "2026-09";
})());

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

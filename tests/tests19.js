/* Seasonal bills: due every month, different amount each time. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

//            Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
var POWER = [ 100, 100, 110, 120, 180, 300, 400, 380, 240, 140, 100, 100 ];

sec("the shape");
var info = scheduleInfo({ schedule: normalizeSchedule({ amounts: POWER }) });
eq("annual total", info.annual, 2270);
eq("level contribution", info.monthly, 189.1667);
ok("due every month", info.months.length === 12, String(info.months.length));
ok("not uniform", !info.uniform);
eq("cheapest month", info.smallest, 100);
eq("dearest month", info.biggest, 400);
eq("July's bill", info.amountFor("2027-07"), 400);
eq("January's bill", info.amountFor("2027-01"), 100);

sec("the curve builds through winter and drains through summer");
eq("trough is zero", Math.min.apply(null, info.curve), 0);
ok("peak is positive", info.peak > 0, String(info.peak));
ok("balance rises Jan..May", info.curve[4] > info.curve[0], info.curve.join(","));
ok("and falls through the summer", info.curve[7] < info.curve[4]);
(function () {
  // walking the curve must equal contribution minus that month's bill
  for (var m = 1; m <= 12; m++) {
    var prev = info.curve[(m + 10) % 12], here = info.curve[m - 1];
    eq("  month " + m + " steps correctly", here - prev, info.monthly - POWER[m - 1]);
  }
})();

sec("a full simulated year returns to where it began");
(function () {
  state = normalize({
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "p", categoryId: "u", name: "Power", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 189.17 }],
              schedule: { amounts: POWER } }],
    ledger: [] });
  var seed = info.seedFor("2026-09");
  addEntry("p", seed, "2026-08-31", "Seed");
  var order = [[2026,9],[2026,10],[2026,11],[2026,12],[2027,1],[2027,2],[2027,3],[2027,4],
               [2027,5],[2027,6],[2027,7],[2027,8]];
  var lowest = Infinity;
  order.forEach(function (ym) {
    var mk = ym[0] + "-" + String(ym[1]).padStart(2, "0");
    addEntry("p", 189.1667, mk + "-01", "Monthly", "allotment");
    addEntry("p", -POWER[ym[1] - 1], mk + "-15", "Power bill");
    lowest = Math.min(lowest, balanceOfFund("p"));
  });
  ok("never went negative", lowest >= -0.05, String(lowest));
  eq("back to the seed after twelve months", balanceOfFund("p"), seed);
})();

sec("status understands the seasonal swing");
(function () {
  state = normalize({
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "p", categoryId: "u", name: "Power", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 189.17 }],
              schedule: { amounts: POWER } }],
    // realistic August: funded, and the $380 August bill already paid, leaving
    // the fund on its end-of-August steady state
    ledger: [
      { id: "a", fundId: "p", amount: info.expectedAt("2026-08") + 380, date: "2026-08-01",
        kind: "allotment" },
      { id: "b", fundId: "p", amount: -380, date: "2026-08-15", note: "August power" },
    ] });
  var f = fundById("p");
  eq("holding exactly the steady state", balanceOfFund("p"), info.expectedAt("2026-08"));
  eq("no gap across the year", cycleOutlook(f).gap, 0);
  ok("reads as fine", fundStatus(f).tone === "good", fundStatus(f).key);
  ok("paying a $380 bill from a $189 budget is NOT called overspending",
     fundStatus(f).key !== "overspent", fundStatus(f).key);
  eq("and it is not counted against the monthly budget either",
     monthStats({ fund: "p" }, "2026-08").spent, 380);

  // falling one contribution behind shows up as a shortfall later in the year
  state.ledger = state.ledger.filter(function (e) { return e.id !== "a"; });
  state.ledger.push({ id: "a2", fundId: "p", amount: info.expectedAt("2026-08") + 380 - 189.17,
                      date: "2026-08-01", kind: "allotment" });
  clearDerivedCache();
  ok("being a contribution light is caught", cycleOutlook(fundById("p")).gap > 0,
     String(cycleOutlook(fundById("p")).gap));
})();

sec("legacy fixed-amount schedules still work");
(function () {
  var legacy = scheduleInfo({ schedule: normalizeSchedule({ amount: 315, months: [1,2,3,4,5,9,10,11,12] }) });
  eq("annual", legacy.annual, 2835);
  eq("monthly", legacy.monthly, 236.25);
  ok("recognised as uniform", legacy.uniform);
  eq("its single amount is exposed", legacy.amount, 315);
  eq("and per-month lookup agrees", legacy.amountFor("2026-09"), 315);
  eq("a bill-free month costs nothing", legacy.amountFor("2026-07"), 0);
  eq("peak unchanged from before", legacy.peak, 708.75);
})();

sec("round-trip and hardening");
(function () {
  var n = normalize({ categories: [{ id: "u", name: "U" }],
    funds: [{ id: "p", categoryId: "u", name: "P", schedule: { amounts: POWER } }], ledger: [] });
  ok("amounts survive", n.funds[0].schedule.amounts.length === 12);
  eq("July kept", n.funds[0].schedule.amounts[6], 400);
  ok("re-normalizing is stable", JSON.stringify(normalize(n)) === JSON.stringify(n));

  var short = normalizeSchedule({ amounts: [50, 60] });
  ok("a short array is padded to twelve", short.amounts.length === 12);
  eq("missing months are zero", short.amounts[11], 0);
  ok("all-zero is no schedule", normalizeSchedule({ amounts: Array(12).fill(0) }) === null);
  ok("garbage coerces", normalizeSchedule({ amounts: ["50", null, "x"] }).amounts[0] === 50);
  ok("negatives clamp", normalizeSchedule({ amounts: [-5, 10] }).amounts[0] === 0);
})();

sec("describeSchedule");
ok("uniform reads as a multiple",
   /\$315 × 9 months/.test(describeSchedule(scheduleInfo({
     schedule: normalizeSchedule({ amount: 315, months: [1,2,3,4,5,9,10,11,12] }) }))),
   describeSchedule(scheduleInfo({ schedule: normalizeSchedule({ amount: 315, months: [1,2,3,4,5,9,10,11,12] }) })));
ok("varying reads as a range",
   /from \$100 to \$400/.test(describeSchedule(info)), describeSchedule(info));
ok("  and gives the total", /\$2,270/.test(describeSchedule(info)), describeSchedule(info));


sec("the real House Energy figures");
(function () {
  //             Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
  var ENERGY = [ 175, 180, 135, 140, 200, 190, 275, 440, 400, 165, 140, 110 ];
  var i = scheduleInfo({ schedule: normalizeSchedule({ amounts: ENERGY }) });

  eq("annual total", i.annual, 2550);
  eq("level contribution", i.monthly, 212.50);
  eq("contributions over a year equal the bills", i.monthly * 12, i.annual);
  eq("cheapest month is December", i.smallest, 110);
  eq("dearest month is August", i.biggest, 440);

  // the trough must land right after the expensive stretch, not arbitrarily
  eq("peak is end of June", i.curve[5], i.peak);
  eq("trough is end of September", i.curve[8], 0);
  ok("July, August and September are the expensive run",
     ENERGY[6] > i.monthly && ENERGY[7] > i.monthly && ENERGY[8] > i.monthly);
  ok("every other month contributes more than it costs",
     [0,1,2,3,4,5,9,10,11].every(function (m) { return ENERGY[m] < i.monthly; }));
  eq("the summer overspend exactly drains the June peak",
     (ENERGY[6] - i.monthly) + (ENERGY[7] - i.monthly) + (ENERGY[8] - i.monthly), i.peak);

  // a full cycle starting from the June peak returns to it
  state = normalize({
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "e", categoryId: "u", name: "House Energy", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 212.50 }],
              schedule: { amounts: ENERGY } }],
    ledger: [] });
  addEntry("e", i.peak, "2026-06-30", "Seed at the peak");
  var lowest = Infinity, order = [];
  for (var k = 0; k < 12; k++) order.push(((6 + k) % 12) + 1);   // Jul .. Jun
  var y = 2026;
  order.forEach(function (mn) {
    if (mn === 1) y++;
    var mk = y + "-" + String(mn).padStart(2, "0");
    addEntry("e", 212.50, mk + "-01", "Monthly", "allotment");
    addEntry("e", -ENERGY[mn - 1], mk + "-15", "Power bill");
    lowest = Math.min(lowest, balanceOfFund("e"));
  });
  ok("never dips below zero across the year", lowest >= -0.05, String(lowest));
  eq("and comes back to the June peak", balanceOfFund("e"), i.peak);

  // starting from nothing in late August is the worst possible moment
  state = normalize({
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "e", categoryId: "u", name: "House Energy", createdAt: "2026-08-01",
              budgets: [{ from: "2026-08", amount: 212.50 }],
              schedule: { amounts: ENERGY } }],
    ledger: [{ id: "s", fundId: "e", amount: 210, date: "2026-09-01", kind: "allotment",
               note: "September 2026" }] });
  var f = fundById("e");
  eq("nothing in the fund today", balanceToday("e"), 0);
  eq("only a September contribution dated ahead", pendingOf("e"), 210);
  var out = cycleOutlook(f);
  eq("short by the whole summer", out.gap, 630);
  ok("and it bites in September", out.troughMonth === "2026-09", out.troughMonth);
  ok("status says so", fundStatus(f).key === "short" || fundStatus(f).key === "behind",
     fundStatus(f).key);

  // seeding that amount fixes it exactly
  addEntry("e", 630, "2026-08-26", "Seed");
  eq("no gap left", cycleOutlook(fundById("e")).gap, 0);
  eq("and the low point is exactly zero", cycleOutlook(fundById("e")).lowest, 0);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

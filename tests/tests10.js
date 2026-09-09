/* Irregular expenses: $200 x 8 months of preschool, and friends. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.01, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

var PRESCHOOL = { amount: 200, months: [9, 10, 11, 12, 1, 2, 3, 4] };

sec("the maths");
var info = scheduleInfo({ schedule: normalizeSchedule(PRESCHOOL) });
eq("annual cost", info.annual, 1600);
eq("level monthly contribution", info.monthly, 133.3333);
eq("peak buffer", info.peak, 533.33);
ok("trough is exactly zero", Math.min.apply(null, info.curve) < 0.005);
eq("curve peaks at the end of August", info.curve[7], 533.33);
eq("curve bottoms out at the end of April", info.curve[3], 0);
eq("seed needed to start in September", info.seedFor("2026-09"), 533.33);
eq("seed needed to start in May", info.seedFor("2026-05"), 0);
ok("next due from August is September", info.nextDue("2026-08") === 9, String(info.nextDue("2026-08")));
ok("next due from October is October", info.nextDue("2026-10") === 10);
ok("next due from June wraps to September", info.nextDue("2026-06") === 9, String(info.nextDue("2026-06")));
ok("September is a due month", info.isDue("2026-09"));
ok("July is not", !info.isDue("2026-07"));

sec("the curve is self-consistent");
(function () {
  // walking the curve month to month must equal contribution minus any payment
  for (var m = 1; m <= 12; m++) {
    var prev = info.curve[(m + 10) % 12];
    var here = info.curve[m - 1];
    var payment = info.months.indexOf(m) >= 0 ? 200 : 0;
    eq("  month " + m + " steps by contribution - payment", here - prev, info.monthly - payment);
  }
})();

sec("a full simulated year lands back at zero");
(function () {
  state = normalize({
    categories: [{ id: "k", name: "Kids" }],
    funds: [{ id: "pre", categoryId: "k", name: "Preschool",
              schedule: PRESCHOOL, monthlyAllotment: 133.33 }],
    ledger: [] });
  // seed, then contribute every month and pay in the due months, Sep -> Aug
  addEntry("pre", 533.33, "2026-08-31", "Seed");
  var order = [[2026,9],[2026,10],[2026,11],[2026,12],[2027,1],[2027,2],[2027,3],[2027,4],
               [2027,5],[2027,6],[2027,7],[2027,8]];
  var lowest = Infinity;
  order.forEach(function (ym, i) {
    var mk = ym[0] + "-" + String(ym[1]).padStart(2, "0");
    addEntry("pre", 133.33, mk + "-01", "Monthly");
    if (PRESCHOOL.months.indexOf(ym[1]) >= 0) addEntry("pre", -200, mk + "-05", "Preschool");
    var bal = balanceOfFund("pre");
    lowest = Math.min(lowest, bal);
  });
  ok("never went negative across the year", lowest >= -0.05, String(lowest));
  eq("back to the seed after a full cycle", balanceOfFund("pre"), 533.29);
})();

/* scheduled-fund status is judged on the next payment now; see tests11 */

sec("other shapes");
(function () {
  var q = scheduleInfo({ schedule: normalizeSchedule({ amount: 90, months: [1, 4, 7, 10] }) });
  eq("quarterly water: annual", q.annual, 360);
  eq("quarterly water: monthly", q.monthly, 30);
  eq("quarterly water: peak", q.peak, 60);

  var a = scheduleInfo({ schedule: normalizeSchedule({ amount: 1800, months: [8] }) });
  eq("annual insurance: monthly", a.monthly, 150);
  eq("annual insurance: peak", a.peak, 1650);
  ok("annual insurance bottoms at zero", Math.min.apply(null, a.curve) < 0.005);

  var every = scheduleInfo({ schedule: normalizeSchedule({ amount: 100, months: [1,2,3,4,5,6,7,8,9,10,11,12] }) });
  eq("a monthly bill needs no buffer", every.peak, 0);
  eq("  and contributes exactly its cost", every.monthly, 100);
})();

sec("hardening");
ok("no schedule -> null", scheduleInfo({}) === null && scheduleInfo({ schedule: null }) === null);
ok("zero amount is rejected", normalizeSchedule({ amount: 0, months: [1] }) === null);
ok("no months is rejected", normalizeSchedule({ amount: 100, months: [] }) === null);
// months are now a derived view: the canonical shape is a 12-slot amounts array
var mOf = function (sc) { return scheduleInfo({ schedule: normalizeSchedule(sc) }).months.join(","); };
ok("out-of-range months are dropped", mOf({ amount: 10, months: [0, 5, 13, 99] }) === "5",
   mOf({ amount: 10, months: [0, 5, 13, 99] }));
ok("duplicate months collapse", mOf({ amount: 10, months: [3, 3, 1] }) === "1,3");
ok("string months coerce", mOf({ amount: 10, months: ["2", "4"] }) === "2,4");
ok("the canonical shape is twelve amounts",
   normalizeSchedule({ amount: 10, months: [5] }).amounts.length === 12);
ok("garbage amount rejected", normalizeSchedule({ amount: "abc", months: [1] }) === null);
(function () {
  var round = normalize({ categories: [{ id: "k", name: "K" }],
    funds: [{ id: "p", categoryId: "k", name: "P", schedule: PRESCHOOL }], ledger: [] });
  ok("a schedule survives normalize", !!round.funds[0].schedule);
  eq("  with its amount", scheduleInfo(round.funds[0]).amount, 200);
  ok("  and its months", scheduleInfo(round.funds[0]).months.join(",") === "1,2,3,4,9,10,11,12",
     scheduleInfo(round.funds[0]).months.join(","));
  ok("re-normalizing is stable", JSON.stringify(normalize(round)) === JSON.stringify(round));
})();


sec("level funds: no nagging about being uncredited");
(function () {
  state = normalize({
    categories: [{ id: "h", name: "Home" }],
    funds: [{ id: "g", categoryId: "h", name: "Groceries", monthlyAllotment: 300 }],
    ledger: [] });
  var f = fundById("g"), mk = thisMonth();

  // the case that used to shout on the 1st of every month
  var st = fundStatus(f);
  ok("a brand-new uncredited fund is not warned about", st.tone !== "warning", st.key + "/" + st.tone);
  ok("  and reads as on track", st.key === "ok", st.key);

  // rolled-over balance, nothing credited yet this month, a little spending
  addEntry("g", 500, "2026-07-01", "Last month");
  addEntry("g", -40, mk + "-03", "Shop");
  st = fundStatus(f);
  ok("spending from a rolled-over balance is fine", st.key === "ok", st.key);
  ok("  even though nothing was credited this month",
     monthStats({ fund: "g" }, mk).credited === 0);

  // now genuinely over the monthly budget
  addEntry("g", -400, mk + "-04", "Big shop");
  st = fundStatus(f);
  ok("spending past the BUDGET is flagged", st.key === "overspent", st.key);
  ok("  as a warning", st.tone === "warning");

  // credited a lot, spent less than budget -> fine
  state.ledger = [];
  addEntry("g", 300, mk + "-01", "Monthly");
  addEntry("g", -100, mk + "-05", "Shop");
  ok("credited and under budget is on track", fundStatus(f).key === "ok", fundStatus(f).key);

  // spending more than was credited this month, but under budget and with a
  // healthy rolled-over balance, is exactly the case that used to nag
  state.ledger = [];
  addEntry("g", 500, "2026-07-01", "Rolled over");
  addEntry("g", 50, mk + "-01", "Partial credit");
  addEntry("g", -120, mk + "-05", "Shop");
  ok("balance stays positive in this fixture", balanceOfFund("g") === 430, String(balanceOfFund("g")));
  ok("spent (120) exceeds this month's credit (50)",
     monthStats({ fund: "g" }, mk).spent > monthStats({ fund: "g" }, mk).credited);
  ok("but under the 300 budget, so it is not flagged",
     fundStatus(f).key === "ok", fundStatus(f).key);

  // a negative balance still wins over everything
  state.ledger = [];
  addEntry("g", -10, mk + "-05", "Overdraw");
  ok("overdrawn still reports critical", fundStatus(f).key === "over", fundStatus(f).key);
})();

sec("no status anywhere says 'not funded'");
(function () {
  var seen = [];
  [{ id: "a", monthlyAllotment: 300 }, { id: "b", target: 500 }, { id: "c" },
   { id: "d", schedule: { amount: 200, months: [9] } }].forEach(function (spec, i) {
    state = normalize({ categories: [{ id: "k", name: "K" }],
      funds: [Object.assign({ categoryId: "k", name: "F" + i }, spec)], ledger: [] });
    seen.push(fundStatus(fundById(spec.id)));
  });
  ok("no status carries the retired key", !seen.some(function (s) { return s.key === "unfunded"; }),
     JSON.stringify(seen.map(function (s) { return s.key; })));
  ok("no label mentions being unfunded",
     !seen.some(function (s) { return /not funded/i.test(s.label); }),
     JSON.stringify(seen.map(function (s) { return s.label; })));
})();


sec("one Varying type: how a schedule was TYPED must not change what it means");
(function () {
  function fund(sched) {
    state = normalize({ meta: { planStart: "2025-01" },
      categories: [{ id: "c", name: "C" }],
      funds: [{ id: "f", categoryId: "c", name: "Water", createdAt: "2025-01-01",
                schedule: sched }],
      ledger: [{ id: "e", fundId: "f", amount: 250, date: "2026-01-01" }] });
    return fundById("f");
  }
  // the same quarterly bill, authored the two ways the editor used to offer
  var byMonths = fund({ amount: 100, months: [3, 6, 9, 12] });
  var A = scheduleInfo(byMonths), aStat = fundStatus(byMonths), aMeter = meterFor(byMonths);
  var byGrid = fund({ amounts: [0, 0, 100, 0, 0, 100, 0, 0, 100, 0, 0, 100] });
  var B = scheduleInfo(byGrid), bStat = fundStatus(byGrid), bMeter = meterFor(byGrid);

  ok("identical amounts", JSON.stringify(A.amounts) === JSON.stringify(B.amounts),
     JSON.stringify(A.amounts) + " vs " + JSON.stringify(B.amounts));
  eq("identical monthly contribution", A.monthly, B.monthly);
  eq("identical annual cost", A.annual, B.annual);
  eq("identical peak", A.peak, B.peak);
  ok("identical curve", JSON.stringify(A.curve) === JSON.stringify(B.curve));
  ok("identical status", aStat.key === bStat.key, aStat.key + " vs " + bStat.key);
  ok("identical caption", aMeter.note === bMeter.note, aMeter.note + " vs " + bMeter.note);
  ok("both read as uniform, so both describe the same way",
     A.uniform && B.uniform && describeSchedule(A) === describeSchedule(B), describeSchedule(B));
  ok("  naming the four months", /× 4 months a year/.test(describeSchedule(B)), describeSchedule(B));

  // a genuinely seasonal one is the same TYPE, just not uniform
  var season = fund({ amounts: [100, 100, 120, 150, 200, 300, 400, 380, 250, 150, 100, 100] });
  var S = scheduleInfo(season);
  ok("a seasonal schedule is not uniform", !S.uniform);
  ok("  but is still a schedule", !!S);
  ok("  and describes itself by range", /from \$100 to \$400/.test(describeSchedule(S)),
     describeSchedule(S));
  eq("  totalling its twelve slots", S.annual, 2350);

  // a month with no bill is simply zero — that is the whole merge
  eq("an off month costs nothing", S.amountFor("2026-01"), 100);
  eq("  and a quarterly fund's off month is 0", B.amountFor("2026-01"), 0);
  eq("  while its due month is the bill", B.amountFor("2026-03"), 100);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

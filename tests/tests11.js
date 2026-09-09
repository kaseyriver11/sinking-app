/* The next-payment projection — the question "will there be enough?" */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function trash(ledger) {
  state = normalize({
    categories: [{ id: "u", name: "Utilities" }],
    funds: [{ id: "t", categoryId: "u", name: "Trash", monthlyAllotment: 33.33,
              schedule: { amount: 100, months: [3, 6, 9, 12] } }],
    ledger: ledger });
  return fundById("t");
}

sec("the reported bug, exactly as it stood");
(function () {
  // today is 2026-08-25; the September credit is dated ahead
  var f = trash([
    { id: "a", fundId: "t", amount: 33.3366666666667, date: "2026-08-25", note: "Catch-up to schedule" },
    { id: "b", fundId: "t", amount: 33.33, date: "2026-09-01", note: "September 2026", kind: "allotment" },
  ]);
  eq("balance is what was reported", balanceOfFund("t"), 66.67);
  var pr = projection(f);
  ok("next payment is September", pr.dueKey === "2026-09", pr.dueKey);
  eq("amount due", pr.amount, 100);
  eq("nothing further is owed in — both months already credited", pr.toCome, 0);
  eq("projected available", pr.projected, 66.67);
  eq("shortfall is the missing contribution", pr.shortfall, 33.33);
  ok("status says short, not on track", fundStatus(f).key === "short", fundStatus(f).key);
  ok("  and names the month", /Sep/.test(fundStatus(f).label), fundStatus(f).label);
  ok("the meter names the shortfall", /short of/.test(meterFor(f).note), meterFor(f).note);
  ok("  no due badge — the bill is September, today is August",
     meterFor(f).due === null, String(meterFor(f).due));
  ok("  caption names the bill month", /due Sep$/.test(meterFor(f).note), meterFor(f).note);
})();

sec("what the catch-up SHOULD have done");
(function () {
  var f = trash([{ id: "b", fundId: "t", amount: 33.33, date: "2026-09-01", note: "September 2026", kind: "allotment" }]);
  var pr = projection(f);
  eq("September already funded, so nothing more is coming", pr.toCome, 0);
  eq("before any top-up, short by the two months never banked", pr.shortfall, 66.67);
  addEntry("t", pr.shortfall, "2026-08-25", "Top-up");
  var after = projection(f);
  eq("after the top-up the bill is exactly covered", after.projected, 100);
  eq("no shortfall left", after.shortfall, 0);
  ok("the whole amount is now banked", balanceOfFund("t") >= 100, String(balanceOfFund("t")));
  ok("so status is Ready, not merely on track", fundStatus(f).key === "funded", fundStatus(f).key);
  // the meter quotes money actually in the fund, so September's $33.33 — dated
  // ahead — is excluded, leaving the $66.67 top-up. The bill is still covered.
  ok("meter shows what is held today, not what is merely recorded",
     /^Holding \$67 \(\$400\/yr\)$/.test(meterFor(f).note), meterFor(f).note);
})();

sec("a pre-funded month is never counted twice");
(function () {
  // September credited, August not — only August's contribution is still to come
  var f = trash([{ id: "b", fundId: "t", amount: 33.33, date: "2026-09-01", note: "Sep", kind: "allotment" }]);
  var pr = projection(f);
  eq("September is funded, so nothing outstanding", pr.toCome, 0);
  ok("nothing pending", pr.pending.length === 0, pr.pending.join(","));
  eq("projected counts September's credit once, not twice", pr.projected, 33.33);
})();

sec("a healthy fund mid-cycle");
(function () {
  // contributed every month since January, next payment September
  var rows = [], m = 1;
  for (; m <= 9; m++) rows.push({ id: "c" + m, fundId: "t", amount: 33.33,
    date: "2026-" + String(m).padStart(2, "0") + "-01", note: "m", kind: "allotment" });
  // and the March and June bills were paid
  rows.push({ id: "p3", fundId: "t", amount: -100, date: "2026-03-15", note: "bill" });
  rows.push({ id: "p6", fundId: "t", amount: -100, date: "2026-06-15", note: "bill" });
  var f = trash(rows);
  eq("balance after two bills", balanceOfFund("t"), 99.97);
  var pr = projection(f);
  ok("next payment September", pr.dueKey === "2026-09");
  eq("September already funded, nothing more to come", pr.toCome, 0);
  eq("projected", pr.projected, 99.97);
  ok("effectively covered (rounding aside)", pr.shortfall < 0.05, String(pr.shortfall));
})();

sec("a paid month rolls the target forward");
(function () {
  var f = trash([
    { id: "c", fundId: "t", amount: 100, date: "2026-09-01", note: "credit", kind: "allotment" },
    { id: "p", fundId: "t", amount: -100, date: "2026-09-10", note: "paid the bill" },
  ]);
  var pr = projection(f);
  ok("September is done, so the target is December", pr.dueKey === "2026-12", pr.dueKey);
  eq("three contributions to come (Oct, Nov, Dec)", pr.toCome, 99.99);
  eq("balance is back to zero", pr.balance, 0);
  ok("covered for December (rounding aside)", pr.shortfall < 0.05, String(pr.shortfall));
})();

sec("a due month partially paid still counts as due");
(function () {
  var f = trash([
    { id: "c", fundId: "t", amount: 100, date: "2026-09-01", note: "credit" },
    { id: "p", fundId: "t", amount: -40, date: "2026-09-10", note: "part payment" },
  ]);
  ok("still targeting September", projection(f).dueKey === "2026-09", projection(f).dueKey);
})();

sec("annual and monthly shapes");
(function () {
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "ins", categoryId: "c", name: "Insurance", monthlyAllotment: 150,
              schedule: { amount: 1800, months: [12] } }],
    ledger: [] });
  var pr = projection(fundById("ins"));
  ok("annual bill targets December", pr.dueKey === "2026-12", pr.dueKey);
  eq("four contributions Sep-Dec", pr.toCome, 600);
  eq("short by the rest", pr.shortfall, 1200);

  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "n", categoryId: "c", name: "Netflix", monthlyAllotment: 16,
              schedule: { amount: 16, months: [1,2,3,4,5,6,7,8,9,10,11,12] } }],
    ledger: [] });
  var p2 = projection(fundById("n"));
  ok("a monthly bill targets this month", p2.dueKey === thisMonth(), p2.dueKey);
  eq("this month isn't funded yet, so nothing is coming before it", p2.toCome, 0);
  eq("which means it reads short until you fund it", p2.shortfall, 16);
})();

sec("no schedule, no projection");
(function () {
  state = normalize({ categories: [{ id: "c", name: "C" }],
    funds: [{ id: "g", categoryId: "c", name: "Groceries", monthlyAllotment: 300 }], ledger: [] });
  ok("projection is null", projection(fundById("g")) === null);
  ok("nextDueKey is null", nextDueKey(fundById("g")) === null);
  ok("status falls through to the level-fund rules", fundStatus(fundById("g")).key === "ok");
})();


sec("banked vs projected — the wording must not overclaim");
(function () {
  // covered only because September's contribution is still to come
  var f = trash([{ id: "s", fundId: "t", amount: 66.67, date: "2026-08-01", note: "Seed" }]);
  var pr = projection(f);
  eq("projected covers it", pr.projected, 100);
  eq("no shortfall", pr.shortfall, 0);
  ok("but the money is NOT all there yet", pr.balance < pr.amount, String(pr.balance));
  ok("status says on track, not ready", fundStatus(f).key === "ontrack", fundStatus(f).key);
  ok("  and names the month", /On track for Sep/.test(fundStatus(f).label), fundStatus(f).label);
  ok("meter states what is held and what the fund costs a year",
     /^Holding \$67 \(\$400\/yr\)$/.test(meterFor(f).note), meterFor(f).note);


  // now genuinely fully banked, before September's contribution arrives
  addEntry("t", 33.33, "2026-08-02", "Extra seed");
  ok("balance now covers the bill outright", balanceOfFund("t") >= 100, String(balanceOfFund("t")));
  ok("status upgrades to ready", fundStatus(f).key === "funded", fundStatus(f).key);
  ok("  and says so", /Ready for Sep/.test(fundStatus(f).label), fundStatus(f).label);
  // the meter quotes money actually in the fund, so a future-dated
  // contribution is excluded until its month arrives
  ok("meter shows what is held today", /^Holding \$100 \(/.test(meterFor(f).note), meterFor(f).note);
})();

sec("a short fund never claims either");
(function () {
  var f = trash([{ id: "b", fundId: "t", amount: 33.33, date: "2026-09-01", note: "Sep", kind: "allotment" }]);
  ok("still short", fundStatus(f).key === "short", fundStatus(f).key);
  ok("no 'ready' claim in the caption", !/ready/i.test(meterFor(f).note), meterFor(f).note);
})();


sec("the two meters are told apart by their verb");
(function () {
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [
      { id: "lvl", categoryId: "c", name: "Water & Sewer", monthlyAllotment: 200 },
      { id: "sch", categoryId: "c", name: "Car Insurance", monthlyAllotment: 120.83,
        schedule: { amount: 1450, months: [1] } },
      { id: "goal", categoryId: "c", name: "New laptop", target: 2400 },
      { id: "bare", categoryId: "c", name: "Nothing set" },
    ],
    ledger: [{ id: "x", fundId: "lvl", amount: 200, date: "2026-08-01", kind: "allotment" }] });

  var lvl = meterFor(fundById("lvl"));
  ok("a level fund SPENDS", lvl.kind === "spend", lvl.kind);
  ok("  and says so, with the annual cost alongside",
     /^Spent \$0 of \$200 \(\$2,400\/yr\)$/.test(lvl.note), lvl.note);
  ok("  with an empty bar when nothing is spent", lvl.pct === 0, String(lvl.pct));
  ok("  and no due badge", lvl.due === null);
  ok("  the annual is the only figure the others don't already give you",
     /\$2,400\/yr/.test(lvl.note), lvl.note);

  var sch = meterFor(fundById("sch"));
  ok("a scheduled fund SAVES", sch.kind === "save", sch.kind);
  ok("  and says so", /short of|Holding/.test(sch.note), sch.note);
  ok("  with no due badge, because nothing is due this month", sch.due === null, String(sch.due));

  var goal = meterFor(fundById("goal"));
  ok("a goal fund also SAVES", goal.kind === "save", goal.kind);
  ok("  and says so", /^Saved \$0 of \$2,400 goal$/.test(goal.note), goal.note);

  ok("a fund with nothing configured has no meter", meterFor(fundById("bare")) === null);
})();

sec("due-this-month badge");
(function () {
  // Trash is due in September; today is August, so no badge yet
  var f = trash([{ id: "s", fundId: "t", amount: 100, date: "2026-08-01", note: "Seed" }]);
  ok("no badge when the bill is a future month", meterFor(f).due === null, String(meterFor(f).due));
  ok("caption reports what is held", /Holding/.test(meterFor(f).note), meterFor(f).note);

  // a fund due THIS month, fully saved
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "n", categoryId: "c", name: "Rates", monthlyAllotment: 50,
              schedule: { amount: 50, months: [8] } }],
    ledger: [{ id: "a", fundId: "n", amount: 50, date: "2026-08-01", kind: "allotment" }] });
  var m = meterFor(fundById("n"));
  ok("badge appears", m.due === "Due now", String(m.due));
  ok("  in the good tone", m.dueTone === "good", m.dueTone);
  ok("caption reports holding", /Holding/.test(m.note), m.note);

  // due this month but short
  state.ledger = []; clearDerivedCache();
  var m2 = meterFor(fundById("n"));
  ok("short badge when it won't cover", m2.due === "Due now · short", String(m2.due));
  ok("  in the warning tone", m2.dueTone === "warning", m2.dueTone);
})();


sec("the whole cycle, not just the next bill");
(function () {
  // preschool: $315 in 9 months a year, so the fund must peak at $708.75
  var NINE = [1,2,3,4,5,9,10,11,12];
  function pre(ledger) {
    state = normalize({
      categories: [{ id: "k", name: "Children" }],
      funds: [{ id: "p", categoryId: "k", name: "Preschool", createdAt: "2026-01-01",
                budgets: [{ from: "2026-01", amount: 236.25 }],
                schedule: { amount: 315, months: NINE } }],
      ledger: ledger });
    return fundById("p");
  }

  var f = pre([{ id: "a", fundId: "p", amount: 490, date: "2026-08-01", kind: "allotment" }]);
  var out = cycleOutlook(f);
  eq("the steady state for August", out.expected, 708.75);
  eq("the peak", out.peak, 708.75);
  eq("the gap on $490 held", out.gap, 218.75);
  ok("the trough is May", out.troughMonth === "2027-05", out.troughMonth);
  eq("the gap IS how far below zero it goes", out.lowest, -218.75);

  // the next bill is fine, so next-payment alone would have said "ready"
  eq("next bill is covered", projection(f).shortfall, 0);
  ok("but the status refuses to call that fine",
     fundStatus(f).key === "behind", fundStatus(f).key);
  ok("and names when it runs out", /May/.test(fundStatus(f).label), fundStatus(f).label);
  ok("the meter reports the gap", /219 short by/.test(meterFor(f).note), meterFor(f).note);
  ok("  and names when it bites", /May/.test(meterFor(f).note), meterFor(f).note);

  // topping up to the curve makes it genuinely safe
  addEntry("p", 218.75, "2026-08-26", "Catch-up");
  f = fundById("p");
  eq("now on the line", cycleOutlook(f).gap, 0);
  eq("lowest point is zero, never negative", cycleOutlook(f).lowest, 0);
  ok("status clears", ["ontrack", "funded"].indexOf(fundStatus(f).key) >= 0, fundStatus(f).key);
  ok("no longer warning", fundStatus(f).tone === "good");

  // and being above the line is fine too
  addEntry("p", 500, "2026-08-26", "Extra");
  ok("above the line still reads well", fundStatus(fundById("p")).tone === "good");
  eq("gap stays at zero once safe", cycleOutlook(fundById("p")).gap, 0);
  ok("and the excess shows as spare", cycleOutlook(fundById("p")).spare > 0,
     String(cycleOutlook(fundById("p")).spare));
})();

sec("an imminent shortfall outranks a later one");
(function () {
  state = normalize({
    categories: [{ id: "k", name: "K" }],
    funds: [{ id: "p", categoryId: "k", name: "Trash", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 33.33 }],
              schedule: { amount: 100, months: [3,6,9,12] } }],
    ledger: [] });
  var f = fundById("p");
  ok("empty fund, bill imminent -> short, not behind",
     fundStatus(f).key === "short", fundStatus(f).key);
  ok("and it names the bill month", /Sep/.test(fundStatus(f).label), fundStatus(f).label);
})();

sec("a monthly bill has no buffer to be behind on");
(function () {
  state = normalize({
    categories: [{ id: "k", name: "K" }],
    funds: [{ id: "n", categoryId: "k", name: "Netflix", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 16 }],
              schedule: { amount: 16, months: [1,2,3,4,5,6,7,8,9,10,11,12] } }],
    ledger: [{ id: "a", fundId: "n", amount: 16, date: "2026-08-01", kind: "allotment" }] });
  var f = fundById("n");
  eq("steady state is zero for a monthly bill", cycleOutlook(f).expected, 0);
  eq("peak is zero too", cycleOutlook(f).peak, 0);
  ok("holding the bill amount is fine", fundStatus(f).tone === "good", fundStatus(f).key);
})();


sec("future-dated entries must not inflate the forecast");
(function () {
  // funding September while it is still August: the money is recorded but not
  // yet in the fund. Counting it twice is what let one panel say short and
  // another say fine at the same time.
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Ford", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 16.67 }],
              schedule: { amount: 200, months: [4] } }],
    ledger: [
      { id: "past", fundId: "f", amount: 50, date: "2026-08-26", note: "catch-up" },
      { id: "ahead", fundId: "f", amount: 16.67, date: "2026-09-01", kind: "allotment", note: "Sep" },
    ] });
  var f = fundById("f");
  eq("the headline balance counts everything recorded", balanceOfFund("f"), 66.67);
  eq("but only this much is actually there today", balanceToday("f"), 50);
  eq("and this much is dated ahead", pendingOf("f"), 16.67);

  var fc = forecast(f);
  eq("the forecast starts from today's money", fc.points[0].balance, 50);
  eq("September's recorded entry lands in September", fc.points[1].balance, 66.67);
  ok("it is not counted again as an expected contribution",
     Math.abs(fc.points[2].balance - 83.34) < 0.02, String(fc.points[2].balance));

  var pr = projection(f), out = cycleOutlook(f);
  ok("both horizons now agree the fund is short",
     (pr.shortfall > 0.01) === (out.gap > 0.005),
     "next " + pr.shortfall + " / year " + out.gap);
  eq("by the same amount", Math.round(pr.shortfall * 100) / 100, Math.round(out.gap * 100) / 100);
})();

sec("a fully pre-funded month is still not double counted");
(function () {
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "t", categoryId: "c", name: "Trash", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 33.33 }],
              schedule: { amount: 100, months: [3,6,9,12] } }],
    ledger: [
      { id: "a", fundId: "t", amount: 66.67, date: "2026-08-01", kind: "allotment" },
      { id: "b", fundId: "t", amount: 33.33, date: "2026-09-01", kind: "allotment" },
    ] });
  var f = fundById("t");
  eq("recorded total", balanceOfFund("t"), 100);
  eq("in the fund today", balanceToday("t"), 66.67);
  var fc = forecast(f);
  eq("September adds its recorded entry then pays the bill", fc.points[1].balance, 0);
  ok("never negative", fc.lowest >= -0.02, String(fc.lowest));
  eq("so nothing is short", cycleOutlook(f).gap, 0);
})();


sec("the rail meter counts money actually in the fund");
(function () {
  // DVC: $964.84 here, $137.83 dated ahead. The rail said "holding $1,103 of
  // $965 needed" — more than enough — while the fund card said the opposite.
  state = normalize({
    categories: [{ id: "c", name: "Travel" }],
    funds: [{ id: "d", categoryId: "c", name: "DVC Dues", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 137.83 }],
              schedule: { amount: 1654, months: [1] } }],
    ledger: [
      { id: "a", fundId: "d", amount: 964.84, date: "2026-08-01", kind: "allotment" },
      { id: "b", fundId: "d", amount: 137.83, date: "2026-09-01", kind: "allotment" },
    ] });
  var f = fundById("d");
  eq("recorded total", balanceOfFund("d"), 1102.67);
  eq("actually here today", balanceToday("d"), 964.84);
  var note = meterFor(f).note;
  ok("the meter quotes today's figure, not the recorded total",
     /Holding \$965/.test(note), note);
  ok("it does not claim $1,103", !/1,103/.test(note), note);
})();


sec("a safe fund never reads like a short one");
(function () {
  // below the ideal curve, but a large recorded contribution keeps it solvent
  state = normalize({
    categories: [{ id: "k", name: "Children" }],
    funds: [{ id: "p", categoryId: "k", name: "Preschool", createdAt: "2026-01-01",
              budgets: [{ from: "2026-01", amount: 236.25 }],
              schedule: { amount: 315, months: [1,2,3,4,5,9,10,11,12] } }],
    ledger: [
      { id: "a", fundId: "p", amount: 578, date: "2026-08-01", kind: "allotment" },
      { id: "b", fundId: "p", amount: 367.50, date: "2026-09-01", kind: "allotment" },
    ] });
  var f = fundById("p");
  ok("it is below the ideal curve", balanceToday("p") < cycleOutlook(f).expected,
     balanceToday("p") + " vs " + cycleOutlook(f).expected);
  eq("but the year still clears", cycleOutlook(f).gap, 0);
  ok("status is good", fundStatus(f).tone === "good", fundStatus(f).key);
  var note = meterFor(f).note;
  ok("the caption does NOT imply a shortfall", !/needed now|short/.test(note), note);
  // a safe fund says nothing about being short; it quotes the annual cost instead,
  // which is the same caption shape the level funds use
  ok("it quotes the annual cost", /\(\$2,835\/yr\)$/.test(note), note);
  ok("  and leads with what is held", /^Holding \$578 /.test(note), note);
  eq("and the bar is full", meterFor(f).pct, 100);
})();


sec("the annual figure on a level fund");
(function () {
  var mk = function (amt, spent) {
    state = normalize({
      categories: [{ id: "c", name: "C" }],
      funds: [{ id: "g", categoryId: "c", name: "Groceries", monthlyAllotment: amt }],
      ledger: spent ? [{ id: "s", fundId: "g", amount: -spent, date: thisMonth() + "-05" }] : [] });
    return meterFor(fundById("g"));
  };
  ok("a round budget multiplies out cleanly",
     /^Spent \$0 of \$200 \(\$2,400\/yr\)$/.test(mk(200).note), mk(200).note);
  ok("spending shows against both figures",
     /^Spent \$5 of \$17 \(\$204\/yr\)$/.test(mk(17, 5).note), mk(17, 5).note);

  // The annual is the TRUE cost, not the rounded monthly x 12. $16.67 displays as
  // "$17" but is really $200.04 a year, and $200 is the number worth knowing.
  var odd = mk(16.67);
  ok("a fractional budget rounds the month for display", /of \$17 /.test(odd.note), odd.note);
  ok("  but annualises the real figure, not the rounded one",
     /\(\$200\/yr\)/.test(odd.note), odd.note);
  ok("  so it deliberately does NOT read $204", !/\$204/.test(odd.note), odd.note);

  // the other kinds keep their own captions — they already speak about the year
  state = normalize({
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "s", categoryId: "c", name: "Insurance",
              schedule: { amount: 1200, months: [1] } },
            { id: "b", categoryId: "c", name: "Healthcare", monthlyAllotment: 250, buffer: true }],
    ledger: [] });
  ok("a scheduled fund is untouched", !/\/yr/.test(meterFor(fundById("s")).note),
     meterFor(fundById("s")).note);
  // a buffer quotes its annual too — same rule, same caption shape
  ok("a buffer quotes its annual", /\(\$3,000\/yr\)$/.test(meterFor(fundById("b")).note),
     meterFor(fundById("b")).note);
  ok("  and leads with what is held", /^Holding /.test(meterFor(fundById("b")).note),
     meterFor(fundById("b")).note);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

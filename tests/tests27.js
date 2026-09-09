/* Invariant fuzz: build many random states, assert what must always hold. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function sec(n) { console.log("=== " + n + " ==="); }

/* deterministic PRNG — a failing seed must be reproducible */
var seed = 1;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function money_(lo, hi) { return Math.round((lo + rnd() * (hi - lo)) * 100) / 100; }

var M = thisMonth();
function shift(n) { return monthShift(M, n); }

function build(i) {
  var cats = [], funds = [], plans = [], ledger = [];
  var nc = 1 + Math.floor(rnd() * 3);
  for (var c = 0; c < nc; c++) cats.push({ id: "c" + c, name: "Cat" + c });
  var nf = 1 + Math.floor(rnd() * 6);
  for (var k = 0; k < nf; k++) {
    var f = { id: "f" + k, categoryId: pick(cats).id, name: "Fund" + k,
              createdAt: "2025-01-01" };
    var kind = pick(["level", "level", "sched", "vary", "buffer", "goal", "bare"]);
    if (kind === "level") f.budgets = [{ from: "2025-01", amount: money_(0, 900) }];
    if (kind === "sched") {
      var months = [];
      for (var m = 1; m <= 12; m++) if (rnd() < 0.35) months.push(m);
      if (!months.length) months = [pick([1, 4, 7, 12])];
      f.schedule = { amount: money_(20, 2000), months: months };
    }
    if (kind === "vary") {
      var amounts = [];
      for (var v = 0; v < 12; v++) amounts.push(rnd() < 0.5 ? 0 : money_(0, 600));
      f.schedule = { amounts: amounts };
    }
    if (kind === "buffer") {
      f.buffer = true;
      f.budgets = [{ from: "2025-01", amount: money_(0, 400) }];
      if (rnd() < 0.7) f.floor = money_(0, 2500);
    }
    if (kind === "goal") f.target = money_(100, 5000);
    if (rnd() < 0.35) f.ceiling = money_(0, 4000);
    if (rnd() < 0.15) f.archivedAt = "2026-01-01";
    funds.push(f);
  }
  var ne = Math.floor(rnd() * 14);
  for (var e = 0; e < ne; e++) {
    ledger.push({ id: "e" + e, fundId: pick(funds).id,
      amount: rnd() < 0.35 ? -money_(0, 800) : money_(0, 1200),
      date: shift(Math.floor(rnd() * 9) - 6) + "-" + (rnd() < 0.5 ? "05" : "20"),
      kind: rnd() < 0.2 ? "transfer" : null });
  }
  var np = Math.floor(rnd() * 3);
  for (var q = 0; q < np; q++) plans.push({ id: "p" + q, fundId: pick(funds).id,
    name: "Plan" + q, amount: money_(50, 4000),
    month: rnd() < 0.7 ? shift(Math.floor(rnd() * 18)) : "" });
  var oneOffs = [];
  var no = Math.floor(rnd() * 3);
  for (var o = 0; o < no; o++) oneOffs.push({ id: "o" + o, month: shift(Math.floor(rnd() * 12)),
    amount: (rnd() < 0.5 ? -1 : 1) * money_(100, 6000), note: "X" });

  return { meta: { planStart: rnd() < 0.5 ? M : shift(1),
                   incomes: [{ from: "2025-01", amount: money_(0, 12000) }],
                   oneOffs: oneOffs },
           cashReadings: [{ id: "r", date: "2026-01-01", amount: money_(-2000, 120000) }],
           categories: cats, funds: funds, plans: plans, ledger: ledger };
}

var N = 400;
var finite = function (x) { return typeof x === "number" && isFinite(x); };
var bad = { parts: 0, neg: 0, nan: 0, obl: 0, fcast: 0, rel: 0, meter: 0, status: 0 };
var firstBad = {};
function note(key, s) { bad[key]++; if (!firstBad[key]) firstBad[key] = "seed " + s; }

for (var i = 0; i < N; i++) {
  seed = i + 1;
  var st = build(i);
  state = normalize(st);

  allFunds().forEach(function (f) {
    var p = commitmentParts(f);
    var bal = balanceOfFund(f.id);
    // the split must always reconstruct the balance, and never invent money
    if (Math.abs((p.dueNow + p.earmarks + p.reserve + p.free) - Math.max(0, bal)) > 0.02)
      note("parts", i + 1);
    if ([p.dueNow, p.earmarks, p.reserve, p.free].some(function (v) { return v < -0.005; }))
      note("neg", i + 1);
    if ([p.dueNow, p.earmarks, p.reserve, p.free, p.committed].some(function (v) { return !finite(v); }))
      note("nan", i + 1);

    // a release can never exceed what is free, nor drive the fund below its floor
    var r = releasableOf(f);
    if (!finite(r) || r < 0 || r > p.free + 0.02) note("rel", i + 1);
    if (r > 0 && f.floor > 0 && bal - r + 0.02 < f.floor) note("rel", i + 1);

    // status and meter must always produce something renderable
    var s2 = fundStatus(f);
    if (!s2 || !s2.key || !s2.label || !s2.tone) note("status", i + 1);
    var mt = meterFor(f);
    if (mt && (!finite(mt.pct) || mt.pct < -0.01 || mt.pct > 100.01 || typeof mt.note !== "string"))
      note("meter", i + 1);
  });

  // obligations must reconcile with the rolled-up committed figure
  var sum = obligations().reduce(function (a, r) { return a + r.amount; }, 0);
  if (Math.abs(sum - partsTotal().committed) > 0.05) note("obl", i + 1);

  // every forecast row must split cleanly and stay finite
  cashForecast(12).forEach ? null : null;
  var fc = cashForecast(12);
  fc.rows.forEach(function (row) {
    if (!finite(row.closing) || !finite(row.allocated) || !finite(row.unallocated)) note("fcast", i + 1);
    if (Math.abs((row.allocated + row.unallocated) - row.closing) > 0.02) note("fcast", i + 1);
  });
}

sec(N + " random states");
ok("the commitment split always reconstructs the balance", bad.parts === 0,
   bad.parts + " states, first at " + firstBad.parts);
ok("no bucket is ever negative", bad.neg === 0, bad.neg + " states, first at " + firstBad.neg);
ok("no bucket is ever NaN or Infinity", bad.nan === 0, bad.nan + " states, first at " + firstBad.nan);
ok("obligations always reconcile with committed", bad.obl === 0,
   bad.obl + " states, first at " + firstBad.obl);
ok("a release never exceeds free, nor breaches the floor", bad.rel === 0,
   bad.rel + " states, first at " + firstBad.rel);
ok("every fund always has a renderable status", bad.status === 0,
   bad.status + " states, first at " + firstBad.status);
ok("every meter has a real percentage and caption", bad.meter === 0,
   bad.meter + " states, first at " + firstBad.meter);
ok("the forecast always splits cleanly", bad.fcast === 0,
   bad.fcast + " states, first at " + firstBad.fcast);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

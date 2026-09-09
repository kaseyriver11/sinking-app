/* Quick expense: one typed line into an entry. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function world() {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "Home" }, { id: "d", name: "Cars" }],
    funds: [
      { id: "g", categoryId: "c", name: "Groceries + Toiletries", createdAt: "2025-01-01" },
      { id: "ci", categoryId: "d", name: "Car Insurance", createdAt: "2025-01-01" },
      { id: "cp", categoryId: "d", name: "Car Payment", createdAt: "2025-01-01" },
      { id: "h", categoryId: "c", name: "HOA Dues", createdAt: "2025-01-01" },
      { id: "og", categoryId: "d", name: "Oil / Gas", createdAt: "2025-01-01" },
    ], ledger: [] });
}
world();
var P = parseQuickAdd;

sec("the common case");
(function () {
  var r = P("45 groceries lunch with sam");
  ok("no error", !r.error, r.error);
  eq("  amount is negative — expenses are the default", r.amount, -45);
  ok("  matched the fund", r.fundId === "g", r.fundId);
  ok("  the rest is the note", r.note === "lunch with sam", r.note);
})();

sec("amount forms");
(function () {
  eq("plain", P("45 groceries").amount, -45);
  eq("decimal", P("12.50 groceries").amount, -12.5);
  eq("dollar sign", P("$45 groceries").amount, -45);
  eq("comma", P("1,250 groceries").amount, -1250);
  eq("leading minus", P("-45 groceries").amount, -45);
  eq("leading plus makes it a credit", P("+200 groceries").amount, 200);
  eq("spaces around the sign", P("+ 200 groceries").amount, 200);
  eq("bare decimal", P(".5 groceries").amount, -0.5);
})();

sec("fund matching");
(function () {
  ok("exact name", P("10 Car Insurance").fundId === "ci");
  ok("case-insensitive", P("10 car insurance").fundId === "ci");
  ok("prefix", P("10 grocer").fundId === "g", P("10 grocer").fundId);
  ok("substring", P("10 toiletries").fundId === "g", P("10 toiletries").fundId);
  ok("initials", P("10 hoa").fundId === "h", P("10 hoa").fundId);
  ok("  and initials with two words", P("10 cp").fundId === "cp", P("10 cp").fundId);
  ok("punctuation in the name is fine", P("10 oil").fundId === "og", P("10 oil").fundId);
})();

sec("longest match wins, so the note doesn't swallow the fund");
(function () {
  var r = P("120 car insurance renewal");
  ok("two-word fund beats the one-word one", r.fundId === "ci", r.fundId);
  ok("  and the note starts after it", r.note === "renewal", r.note);
  var q = P("500 car payment march");
  ok("the other two-word fund also resolves", q.fundId === "cp", q.fundId);
  ok("  with its own note", q.note === "march", q.note);
})();

sec("ambiguity is reported, not guessed");
(function () {
  var r = P("10 car");
  ok("two funds start with 'car'", !!r.error, JSON.stringify(r));
  ok("  and it says which", r.options && r.options.length === 2, JSON.stringify(r.options));
  ok("  naming them", /Car Insurance/.test(r.options.join(",")), String(r.options));
})();

sec("errors are specific and never throw");
(function () {
  ok("empty", !!P("").error);
  ok("only a note", !!P("groceries").error);
  ok("amount with no fund", !!P("45").error, JSON.stringify(P("45")));
  ok("zero", !!P("0 groceries").error);
  ok("unknown fund", !!P("45 zzzz").error);
  ok("  the message names what failed", /zzzz/.test(P("45 zzzz").error), P("45 zzzz").error);
  ok("null and undefined are safe", !!P(null).error && !!P(undefined).error);
  ok("junk is safe", !!P("!!!").error);
})();

sec("archived funds are not matchable");
(function () {
  state.funds.filter(function (f) { return f.id === "g"; })[0].archivedAt = "2026-01-01";
  clearDerivedCache();
  ok("an archived fund no longer matches", !!P("45 groceries").error, JSON.stringify(P("45 groceries")));
  state.funds.filter(function (f) { return f.id === "g"; })[0].archivedAt = null;
  clearDerivedCache();
})();

sec("it records exactly what the preview promised");
(function () {
  world();
  var r = P("45 groceries lunch");
  addEntry(r.fundId, r.amount, todayStr(), r.note);
  eq("the balance moved by the parsed amount", balanceOfFund("g"), -45);
  var e = state.ledger[state.ledger.length - 1];
  ok("  the note is the parsed note", e.note === "lunch", e.note);
  ok("  dated today", e.date === todayStr(), e.date);
  ok("  and it is an ordinary entry, not a transfer", !e.kind, String(e.kind));
})();


/* ── interest, funding nudge, duplicates, pace, annual, CSV ──────────────── */

sec("the month-funded nudge");
(function () {
  var M = thisMonth();
  var base = { meta: { planStart: M },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "a", categoryId: "c", name: "A", budgets: [{ from: "2025-01", amount: 100 }] },
            { id: "b", categoryId: "c", name: "B", budgets: [{ from: "2025-01", amount: 200 }] },
            { id: "z", categoryId: "c", name: "Z", createdAt: "2025-01-01" }] };

  state = normalize(Object.assign({ ledger: [] }, base));
  var mf = monthFunding();
  eq("both budgeted funds are outstanding", mf.missing.length, 2);
  eq("  worth their budgets", mf.amount, 300);
  eq("  a fund with no budget isn't counted", mf.want, 2);

  state = normalize(Object.assign({ ledger: [
    { id: "e", fundId: "a", amount: 100, date: M + "-01", kind: "allotment" }] }, base));
  mf = monthFunding();
  eq("a half-funded month is caught", mf.missing.length, 1);
  eq("  and reports what is done", mf.funded, 1);
  eq("  and what is left", mf.amount, 200);

  state = normalize(Object.assign({ ledger: [
    { id: "e", fundId: "a", amount: 100, date: M + "-01", kind: "allotment" },
    { id: "f", fundId: "b", amount: 200, date: M + "-02", kind: "allotment" }] }, base));
  eq("a fully funded month raises nothing", monthFunding().missing.length, 0);

  // an ordinary credit is not the monthly funding
  state = normalize(Object.assign({ ledger: [
    { id: "e", fundId: "a", amount: 100, date: M + "-01" }] }, base));
  eq("only allotment entries count", monthFunding().missing.length, 2);

  // before the plan starts it is not our business
  state = normalize(Object.assign({ meta: { planStart: monthShift(M, 3) },
    categories: base.categories, funds: base.funds, ledger: [] }));
  ok("nothing is nagged before the plan begins", monthFunding() === null);
})();

sec("duplicate detection");
(function () {
  var T = todayStr();
  state = normalize({ categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "F" }, { id: "g", categoryId: "c", name: "G" }],
    ledger: [{ id: "e1", fundId: "f", amount: -45, date: T, note: "coffee" }] });
  eq("the same amount on the same day in the same fund", looksDuplicate("f", -45, T).length, 1);
  eq("  a different amount is not", looksDuplicate("f", -46, T).length, 0);
  eq("  a different fund is not", looksDuplicate("g", -45, T).length, 0);
  eq("  a different day is not", looksDuplicate("f", -45, "2026-01-01").length, 0);
  eq("  a credit of the same size is not an expense", looksDuplicate("f", 45, T).length, 0);
  eq("editing an entry doesn't flag itself", looksDuplicate("f", -45, T, "e1").length, 0);
  eq("pennies apart is not a duplicate", looksDuplicate("f", -45.01, T).length, 0);
})();

sec("spend pace");
(function () {
  var M = thisMonth();
  // spendPace reads the real wall-clock date via todayStr(), and a ±0.3
  // margin around "how far through the month" clamps away near either edge —
  // day 28 of a 31-day month pushes "ahead" to elapsed+0.3 > 1 and it gets
  // capped right back down to the threshold. Pin today to the 15th so this
  // test means the same thing no matter which real day the suite runs on.
  var realToday = todayStr;
  todayStr = function () { return M + "-15"; };
  try {
  state = normalize({ meta: { planStart: "2025-01" },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Groceries", budgets: [{ from: "2025-01", amount: 1000 }] },
            { id: "s", categoryId: "c", name: "Taxes", schedule: { amount: 1200, months: [9] } },
            { id: "b", categoryId: "c", name: "Health", buffer: true,
              budgets: [{ from: "2025-01", amount: 100 }] }],
    ledger: [] });
  var days = new Date(Number(M.slice(0, 4)), Number(M.slice(5, 7)), 0).getDate();
  var elapsed = Number(todayStr().slice(8, 10)) / days;
  addEntry("f", -Math.round(1000 * Math.min(1, elapsed + 0.3)), M + "-02", "big");
  var pace = spendPace(fundById("f"));
  ok("a level fund has a pace", !!pace);
  ok("  spending well ahead of the month is flagged", pace.ahead, JSON.stringify(pace));
  ok("  and not behind", !pace.behind);

  state.ledger = []; clearDerivedCache();
  addEntry("f", -Math.round(1000 * Math.max(0, elapsed - 0.3)), M + "-02", "small");
  var slow = spendPace(fundById("f"));
  ok("  spending well under it is flagged the other way", slow.behind, JSON.stringify(slow));
  ok("  and not ahead", !slow.ahead);

  state.ledger = []; clearDerivedCache();
  addEntry("f", -Math.round(1000 * elapsed), M + "-02", "even");
  var even = spendPace(fundById("f"));
  ok("  spending exactly in step is neither", !even.ahead && !even.behind, JSON.stringify(even));
  ok("a scheduled fund has none — lumps are the design", spendPace(fundById("s")) === null);
  ok("nor does a buffer", spendPace(fundById("b")) === null);
  ok("nor a fund with no budget",
     spendPace(normalize({ categories: [{ id: "c", name: "C" }],
       funds: [{ id: "x", categoryId: "c", name: "X" }], ledger: [] }).funds[0]) === null);

  // an empty month before the plan starts is not restraint, it is a month that
  // hasn't happened yet
  state = normalize({ meta: { planStart: monthShift(M, 1) },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Groceries",
              budgets: [{ from: "2025-01", amount: 1000 }] }], ledger: [] });
  ok("no pace before the plan begins", spendPace(fundById("f")) === null);

  state = normalize({ meta: { planStart: M },
    categories: [{ id: "c", name: "C" }],
    funds: [{ id: "f", categoryId: "c", name: "Groceries",
              budgets: [{ from: "2025-01", amount: 1000 }] }], ledger: [] });
  ok("  but there is one once it has", spendPace(fundById("f")) !== null);
  } finally { todayStr = realToday; }
})();

sec("annual cost of the whole plan");
(function () {
  state = normalize({ categories: [{ id: "c", name: "C" }],
    funds: [{ id: "a", categoryId: "c", name: "A", budgets: [{ from: "2025-01", amount: 100 }] },
            { id: "b", categoryId: "c", name: "B", schedule: { amount: 1200, months: [6] } },
            { id: "d", categoryId: "c", name: "D", schedule: { amount: 50, months: [1,4,7,10] } }],
    ledger: [] });
  eq("level funds annualise, scheduled ones use their real total",
     annualCost(), 100 * 12 + 1200 + 200);
  eq("archived funds are excluded",
     (function () { state.funds[0].archivedAt = "2026-01-01"; clearDerivedCache();
                    return annualCost(); })(), 1200 + 200);
})();

sec("CSV export");
(function () {
  state = normalize({ categories: [{ id: "c", name: "Home, Sweet" }],
    funds: [{ id: "f", categoryId: "c", name: 'The "Big" Fund' }],
    ledger: [{ id: "e", fundId: "f", amount: -12.5, date: "2026-08-01", note: "a, b\nc" }] });
  var csv = ledgerCSV(), lines = csv.split("\n");
  ok("there is a header", /^Date,Category,Fund,Amount,Kind,Note$/.test(lines[0]), lines[0]);
  ok("commas in a value are quoted", /"Home, Sweet"/.test(csv), csv);
  ok("quotes are doubled", /"The ""Big"" Fund"/.test(csv), csv);
  ok("a newline in a note is quoted, not raw", /"a, b\nc"/.test(csv), JSON.stringify(csv));
  ok("amounts keep two decimals", /-12\.50/.test(csv), csv);
  ok("the fund and category are resolved, not ids", !/\bid\b/.test(csv));
  eq("one row per entry plus the header", lines.length, 1 + 1 + 1); // note's newline adds one
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

/* Model-independent primitives: month maths, ticks, formatting, cash reserves,
   and the identity palette. The v2-era model suites were retired when the data
   model became two-level — tests7 covers v3. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.005, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

function fresh() {
  state = normalize({
    meta: { cashReserves: 100000 },
    categories: [{ id: "c1", name: "Home" }, { id: "c2", name: "Travel" }],
    funds: [{ id: "f1", categoryId: "c1", name: "Groceries", monthlyAllotment: 300 },
            { id: "f2", categoryId: "c2", name: "Flights", monthlyAllotment: 150 }],
    ledger: [
      { id: "e1", fundId: "f1", amount: 300, date: "2026-08-01" },
      { id: "e2", fundId: "f1", amount: -96, date: "2026-08-07" },
      { id: "e3", fundId: "f2", amount: 150, date: "2026-08-01" },
    ],
  });
}

sec("month arithmetic");
ok("monthKey slices the date", monthKey("2026-09-15") === "2026-09");
ok("monthShift forward within a year", monthShift("2026-03", 1) === "2026-04");
ok("monthShift over the new year", monthShift("2026-12", 1) === "2027-01", monthShift("2026-12", 1));
ok("monthShift back over the new year", monthShift("2026-01", -1) === "2025-12", monthShift("2026-01", -1));
ok("monthShift back 13 months", monthShift("2026-01", -13) === "2024-12", monthShift("2026-01", -13));
ok("monthShift forward 24 months", monthShift("2026-05", 24) === "2028-05", monthShift("2026-05", 24));
ok("monthShift zero is identity", monthShift("2026-05", 0) === "2026-05");
ok("month keys sort as strings", ["2026-10", "2026-09", "2027-01"].sort().join(",") === "2026-09,2026-10,2027-01");
ok("monthStart builds a valid date", monthStart("2026-09") === "2026-09-01");
ok("monthName is the full month", monthName("2026-09") === "September", monthName("2026-09"));


sec("niceTicks");
[[0,0],[0,1],[0,7],[0,650],[0,4321],[0,987654],[-670,1890],[-5000,-100],[-1,1],[-300,0],[300,300]]
.forEach(function (mm) {
  var t = niceTicks(mm[0], mm[1]);
  ok("  ascend " + mm, t.every(function (v,i){ return i===0 || v>t[i-1]; }), JSON.stringify(t));
  ok("  covers max " + mm, t[t.length-1] >= mm[1], JSON.stringify(t));
  ok("  covers min " + mm, t[0] <= Math.min(0, mm[0]), JSON.stringify(t));
  ok("  includes zero " + mm, t.some(function(v){ return Math.abs(v) < 1e-9; }), JSON.stringify(t));
  ok("  count 2-9 " + mm, t.length >= 2 && t.length <= 9, String(t.length));
  ok("  whole dollars " + mm, t.every(function(v){ return Math.abs(v-Math.round(v)) < 1e-9; }), JSON.stringify(t));
});


sec("formatting");
ok("money(0)", money(0) === "$0.00", money(0));
ok("money negative sign leads", money(-42.5) === "-$42.50", money(-42.5));
ok("signed0 positive gets a plus", signed0(300) === "+$300", signed0(300));
ok("signed0 negative gets a minus", signed0(-300) === "-$300", signed0(-300));
ok("signed0 zero is unsigned", signed0(0) === "$0", signed0(0));
ok("moneyCompact small", moneyCompact(650) === "$650", moneyCompact(650));
ok("moneyCompact under 10k stays exact", moneyCompact(9999) === "$9,999", moneyCompact(9999));
ok("moneyCompact 10k+", moneyCompact(12500) === "$13k", moneyCompact(12500));
ok("moneyCompact 1M+", moneyCompact(1250000) === "$1.3M", moneyCompact(1250000));


/* cash reserves now live in their own suite (tests15) - dated readings */

sec("extended identity palette");
ok("a generous set of hues is offered", HUE_ORDER.length >= 16, String(HUE_ORDER.length));
ok("no duplicate hue names", new Set(HUE_ORDER).size === HUE_ORDER.length,
   String(HUE_ORDER.length - new Set(HUE_ORDER).size) + " duplicates");
ok("auto-assignment uses only the validated eight", HUE_AUTO.length === 8, String(HUE_AUTO.length));
ok("the auto set is the documented prefix",
   HUE_AUTO.join(",") === "blue,orange,aqua,yellow,magenta,green,violet,red", HUE_AUTO.join(","));
ok("every hue resolves to a css var", HUE_ORDER.every(function (h) { return hueVar(h) === "var(--hue-" + h + ")"; }));
ok("an extended hue is accepted by normalize",
   normalize({ categories: [{ id: "z", name: "Z", color: "crimson" }], ledger: [] }).categories[0].color === "crimson");
ok("an unknown hue still falls back",
   HUE_ORDER.indexOf(normalize({ categories: [{ id: "z", name: "Z", color: "chartreuse" }], ledger: [] })
     .categories[0].color) >= 0);
(function () {
  var many = { categories: [], ledger: [] };
  for (var i = 0; i < 20; i++) many.categories.push({ id: "k" + i, name: "C" + i });
  var n = normalize(many);
  ok("20 categories all get a valid hue",
     n.categories.every(function (c) { return HUE_ORDER.indexOf(c.color) >= 0; }));
})();
ok("low-contrast light hues are flagged", HUE_LOW_LIGHT.has("yellow") && HUE_LOW_LIGHT.has("aqua"));
ok("blue is not flagged", !HUE_LOW_LIGHT.has("blue"));

sec("icon set");
ok("350+ icons offered", EMOJI.length >= 350, String(EMOJI.length));
ok("grouped for browsing", EMOJI_GROUPS.length >= 10, String(EMOJI_GROUPS.length));
ok("every group has a name and items", EMOJI_GROUPS.every(function (g) {
  return typeof g[0] === "string" && g[0].length && Array.isArray(g[1]) && g[1].length; }));
ok("every entry has search keywords", EMOJI_GROUPS.every(function (g) {
  return g[1].every(function (e) { return e.split(" ").length >= 2; }); }));
ok("flattened list matches the groups",
   EMOJI.length === EMOJI_GROUPS.reduce(function (n, g) { return n + g[1].length; }, 0));
(function () {
  function search(q) {
    return EMOJI_GROUPS.flatMap(function (g) { return g[1]; })
      .filter(function (e) { return e.toLowerCase().indexOf(q) >= 0; });
  }
  ok("search finds car", search("car").length > 0, String(search("car").length));
  ok("search finds coffee", search("coffee").length > 0);
  ok("search finds gift", search("gift").length > 0);
  ok("search finds groceries", search("groceries").length > 0);
  ok("search finds rent", search("rent").length > 0);
  ok("nonsense finds nothing", search("zzzzq").length === 0);
})();
ok("no duplicate icons", new Set(EMOJI).size === EMOJI.length,
   String(EMOJI.length - new Set(EMOJI).size) + " duplicates");
ok("all are non-empty strings", EMOJI.every(function (e) { return typeof e === "string" && e.length > 0; }));



sec("grey");
ok("grey is offered", HUE_ORDER.indexOf("grey") >= 0);
ok("17 hues total", HUE_ORDER.length === 17, String(HUE_ORDER.length));
ok("grey is never auto-assigned", HUE_AUTO.indexOf("grey") < 0);
ok("auto-assignment is still the validated eight", HUE_AUTO.length === 8);
ok("grey resolves to its css var", hueVar("grey") === "var(--hue-grey)");
ok("grey survives normalize",
   normalize({ categories: [{ id: "m", name: "Misc", color: "grey" }], funds: [], ledger: [] })
     .categories[0].color === "grey");
ok("grey is barred from chart lines", chartHue("grey") === "var(--series-1)");
ok("a normal hue still gets its own colour", chartHue("blue") === "var(--hue-blue)");
ok("the low-light rule still applies", chartHue("yellow") === "var(--series-1)");
(function () {
  // 17 categories: grey should be reached only after the other sixteen
  var many = { categories: [], funds: [], ledger: [] };
  for (var i = 0; i < 17; i++) many.categories.push({ id: "k" + i, name: "C" + i });
  var n = normalize(many);
  var colours = n.categories.map(function (c) { return c.color; });
  ok("all 17 distinct", new Set(colours).size === 17, String(new Set(colours).size));
  ok("grey lands last", colours[16] === "grey", colours[16]);
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

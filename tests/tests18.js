/* Activity search — the "where did that $40 go" view. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function sec(n) { console.log("=== " + n + " ==="); }

state = normalize({
  categories: [{ id: "u", name: "Utilities", icon: "*" }, { id: "k", name: "Children", icon: "*" }],
  funds: [{ id: "water", categoryId: "u", name: "Water & Sewer" },
          { id: "pre", categoryId: "k", name: "Alfie Preschool" }],
  ledger: [
    { id: "e1", fundId: "water", amount: 200, date: "2026-08-01", note: "August 2026", kind: "allotment" },
    { id: "e2", fundId: "water", amount: -64.20, date: "2026-08-14", note: "Quarterly bill" },
    { id: "e3", fundId: "pre", amount: 490, date: "2026-08-01", note: "August 2026", kind: "allotment" },
    { id: "e4", fundId: "pre", amount: -490, date: "2026-08-20", note: "September fees" },
    { id: "e5", fundId: "water", amount: -40, date: "2026-07-02", note: "Meter repair" },
  ] });

/* mirrors the filter renderActivity() builds */
function search(q) {
  q = (q || "").trim().toLowerCase();
  var rows = state.ledger.map(function (e) {
    var f = fundById(e.fundId), c = f && catById(f.categoryId);
    return { e: e, hay: [e.note, f && f.name, c && c.name, money(Math.abs(e.amount)), fmtDay(e.date)]
      .filter(Boolean).join(" ").toLowerCase() };
  });
  if (q) rows = rows.filter(function (r) { return r.hay.indexOf(q) >= 0; });
  rows.sort(function (a, b) { return (b.e.date + b.e.id).localeCompare(a.e.date + a.e.id); });
  return rows.map(function (r) { return r.e.id; });
}

sec("unfiltered");
ok("every entry appears", search("").length === 5, String(search("").length));
ok("newest first", search("")[0] === "e4", search("").join(","));
ok("oldest last", search("").slice(-1)[0] === "e5");

sec("finding things you half-remember");
ok("by note", search("meter").join(",") === "e5", search("meter").join(","));
ok("by fund name", search("water").join(",") === "e2,e1,e5", search("water").join(","));
ok("by category name", search("children").join(",") === "e4,e3", search("children").join(","));
ok("by amount", search("40").length > 0, search("40").join(","));
ok("  and finds the right one", search("$40.00").join(",") === "e5", search("$40.00").join(","));
ok("by month name in the date", search("jul").join(",") === "e5", search("jul").join(","));
ok("case-insensitive", search("PRESCHOOL").length === 2, String(search("PRESCHOOL").length));
ok("partial words work", search("quart").join(",") === "e2");

sec("no matches");
ok("nonsense finds nothing", search("zzzz").length === 0);
ok("and doesn't throw", Array.isArray(search("~!@#$")));

sec("spanning funds and categories");
ok("a search can cross categories", search("august").length === 2, search("august").join(","));
ok("  from different categories",
   search("august").indexOf("e1") >= 0 && search("august").indexOf("e3") >= 0);

sec("entries with no note still searchable by fund");
state.ledger.push({ id: "e6", fundId: "water", amount: -10, date: "2026-08-25", note: "" });
clearDerivedCache();
ok("found via its fund", search("sewer").indexOf("e6") >= 0, search("sewer").join(","));

sec("transfers appear too");
moveMoney("water", "pre", 25, "2026-08-26", "Shifting a bit");
clearDerivedCache();
ok("both legs are searchable", search("shifting").length === 2, String(search("shifting").length));
ok("they show under both funds",
   search("shifting").length === 2 && search("preschool").length >= 3);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

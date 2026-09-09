/* Accordion rail: one category open at a time, with shift-click to keep more. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }
function sec(n) { console.log("=== " + n + " ==="); }

state = normalize({
  categories: [{ id: "u", name: "Utilities" }, { id: "a", name: "Auto" }, { id: "h", name: "Home" }],
  funds: [{ id: "energy", categoryId: "u", name: "Energy" },
          { id: "water", categoryId: "u", name: "Water" },
          { id: "ins", categoryId: "a", name: "Insurance" },
          { id: "roof", categoryId: "h", name: "Roof" }],
  ledger: [],
});
function reset() {
  expanded = null; reordering = false; route = { name: "overview", id: null };
  try { localStorage.removeItem(EXPAND_KEY); } catch (_) {}
}
function openIds() { return cats().filter(function (c) { return !isCollapsed(c.id); })
  .map(function (c) { return c.id; }).join(","); }

sec("default");
reset();
ok("first run opens the first category only", openIds() === "u", openIds());
reset();
route = { name: "fund", id: "ins" };
ok("but opens the one you're looking at if you arrive on it", openIds() === "a", openIds());

sec("one at a time");
reset();
toggleCollapse("a");
ok("opening Auto closes Utilities", openIds() === "a", openIds());
toggleCollapse("h");
ok("opening Home closes Auto", openIds() === "h", openIds());
ok("exactly one open", openIds().split(",").filter(Boolean).length === 1);

sec("clicking the open one closes everything");
reset();
toggleCollapse("u");            // u was already the only one open
ok("all closed", openIds() === "", openIds());
toggleCollapse("u");
ok("clicking again reopens it", openIds() === "u", openIds());

sec("shift-click keeps others open");
reset();
toggleCollapse("a");
toggleCollapse("h", true);
ok("both open", openIds() === "a,h", openIds());
toggleCollapse("u", true);
ok("all three open", openIds() === "u,a,h", openIds());
toggleCollapse("a", true);
ok("shift-click on an open one closes just that one", openIds() === "u,h", openIds());
toggleCollapse("a");
ok("a plain click collapses back to one", openIds() === "a", openIds());

sec("viewing a category does not pin it open");
reset();
toggleCollapse("a");
ok("Utilities is closed", isCollapsed("u"));
route = { name: "category", id: "u" };
ok("merely being on it does NOT force it open", isCollapsed("u"));
focusCategory("u");
ok("navigating to it opens it", !isCollapsed("u"));
ok("  and closes Auto", isCollapsed("a"));
toggleCollapse("h");
ok("opening a third closes the one you are viewing", isCollapsed("u"), openIds());
ok("exactly one open, even while viewing another", openIds() === "h", openIds());

sec("navigation focuses the category");
reset();
toggleCollapse("u");
focusCategory("h");
ok("focus opens Home", !isCollapsed("h"));
ok("  and closes the rest", openIds() === "h", openIds());
focusCategory(null);
ok("focusing nothing changes nothing", openIds() === "h", openIds());

sec("reorder mode respects the accordion");
reset();
toggleCollapse("a");
reordering = true;
ok("reordering does not fling everything open", openIds() === "a", openIds());
ok("closed categories stay closed", isCollapsed("u") && isCollapsed("h"));
reordering = false;
ok("unchanged afterwards", openIds() === "a", openIds());

sec("persistence");
reset();
toggleCollapse("h");
toggleCollapse("u", true);
ok("written to storage", JSON.parse(localStorage.getItem(EXPAND_KEY)).sort().join(",") === "h,u",
   localStorage.getItem(EXPAND_KEY));
expanded = loadExpanded();
ok("reload restores both", openIds() === "u,h", openIds());

sec("hardening");
reset();
localStorage.setItem(EXPAND_KEY, "not json{{");
expanded = loadExpanded();
ok("corrupt storage falls back to the default", openIds() === "u", openIds());
reset();
localStorage.setItem(EXPAND_KEY, "[]");
expanded = loadExpanded();
ok("an explicitly empty set is honoured, not overridden", openIds() === "", openIds());
reset();
toggleCollapse("ghost");
ok("opening an id that doesn't exist harms nothing", openIds() === "", openIds());
ok("  and real ones stay closed", isCollapsed("u") && isCollapsed("a"));

sec("no category at all");
(function () {
  var saved = state;
  state = blankState();
  expanded = null;
  route = { name: "overview", id: null };
  ok("default on an empty rail is empty", defaultExpanded().size === 0);
  state = saved;
})();

sec("collapse never touches the data");
reset();
var snapshot = JSON.stringify(state);
toggleCollapse("a"); toggleCollapse("h", true); toggleCollapse("u");
ok("state is byte-identical", JSON.stringify(state) === snapshot);

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

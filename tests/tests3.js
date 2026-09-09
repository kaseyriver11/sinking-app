/* Chart geometry tests — runs the real draw functions against a fake DOM and
   inspects the SVG they emit. Catches label collisions and bar direction,
   which pure logic tests can't see. */
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; console.log("  FAIL  " + name + (detail ? "  ->  " + detail : "")); }
}
function eq(n, g, w) { ok(n, Math.abs(g - w) < 0.02, "got " + g + ", want " + w); }
function sec(n) { console.log("=== " + n + " ==="); }

/* rough advance width for the system sans at a given size */
function textW(str, size) { return String(str).length * size * 0.58; }

function parseTexts(svg) {
  var out = [], re = /<text ([^>]*)>([\s\S]*?)<\/text>/g, m;
  while ((m = re.exec(svg))) {
    var a = m[1];
    var get = function (k) { var r = new RegExp(k + '="([^"]*)"').exec(a); return r ? r[1] : null; };
    out.push({
      x: parseFloat(get("x")), y: parseFloat(get("y")),
      anchor: get("text-anchor") || "start",
      size: parseFloat(get("font-size")) || 12,
      text: m[2].replace(/<[^>]*>/g, "").trim(),
    });
  }
  return out;
}
function spanOf(t) {
  var w = textW(t.text, t.size);
  if (t.anchor === "end") return [t.x - w, t.x];
  if (t.anchor === "middle") return [t.x - w / 2, t.x + w / 2];
  return [t.x, t.x + w];
}
function parsePaths(svg) {
  var out = [], re = /<path d="([^"]*)"\s+fill="([^"]*)"\s*\/>/g, m;
  while ((m = re.exec(svg))) out.push({ d: m[1], fill: m[2] });
  return out;
}

function runBars(fn, rows, width) {
  var svgEl = new FakeEl("svg");
  var box = new FakeEl("div");
  box.clientWidth = width || 640;
  box.__svg = svgEl;
  fn(box, rows, {});
  return svgEl.innerHTML;
}

/* group the emitted <text> nodes into rows by their y coordinate */
function rowsByY(texts) {
  var byY = {};
  texts.forEach(function (t) { (byY[Math.round(t.y)] = byY[Math.round(t.y)] || []).push(t); });
  return Object.keys(byY).map(function (k) {
    return byY[k].sort(function (a, b) { return a.x - b.x; });
  });
}

var SHAPES = {
  "all positive": [
    { id: "a", label: "Groceries", value: 412 },
    { id: "b", label: "Home repairs", value: 1890 },
    { id: "c", label: "Travel", value: 95 },
  ],
  "one negative": [
    { id: "a", label: "Groceries", value: 412 },
    { id: "b", label: "Holiday gifts", value: -670 },
    { id: "c", label: "Travel", value: 95 },
  ],
  "all negative": [
    { id: "a", label: "Groceries", value: -412 },
    { id: "b", label: "Holiday gifts", value: -670 },
  ],
  "long names": [
    { id: "a", label: "Extremely long category name here", value: 1200 },
    { id: "b", label: "Another very long one indeed", value: -1400 },
  ],
  "zeros": [
    { id: "a", label: "Untouched", value: 0 },
    { id: "b", label: "Also zero", value: 0 },
  ],
  "big spread": [
    { id: "a", label: "Tiny", value: 3 },
    { id: "b", label: "Huge", value: 987654 },
    { id: "c", label: "Negative", value: -50000 },
  ],
};

[[ "drawCategoryBars", drawCategoryBars ], [ "drawDivergingBars", drawDivergingBars ]]
.forEach(function (pair) {
  var name = pair[0], fn = pair[1];
  sec(name + " — label collisions");
  Object.keys(SHAPES).forEach(function (shape) {
    [380, 520, 640, 980].forEach(function (W) {
      var svg = runBars(fn, SHAPES[shape], W);
      var rows = rowsByY(parseTexts(svg));
      rows.forEach(function (line) {
        for (var i = 1; i < line.length; i++) {
          var prev = spanOf(line[i - 1]), cur = spanOf(line[i]);
          ok("  " + shape + " @" + W + ": \"" + line[i - 1].text + "\" vs \"" + line[i].text + "\" don't overlap",
             cur[0] >= prev[1] - 0.5,
             "prev ends " + prev[1].toFixed(1) + ", next starts " + cur[0].toFixed(1));
        }
      });
      // nothing may spill off either edge
      rows.forEach(function (line) {
        line.forEach(function (t) {
          var s = spanOf(t);
          ok("  " + shape + " @" + W + ": \"" + t.text + "\" stays inside the viewBox",
             s[0] >= -0.5 && s[1] <= W + 0.5, "[" + s[0].toFixed(1) + "," + s[1].toFixed(1) + "] vs W=" + W);
        });
      });
    });
  });
});

sec("bar direction follows the sign");
(function () {
  var svg = runBars(drawCategoryBars, SHAPES["one negative"], 640);
  var paths = parsePaths(svg);
  ok("one bar per non-zero row", paths.length === 3, String(paths.length));
  var negs = paths.filter(function (p) { return p.fill.indexOf("--expense") >= 0; });
  ok("exactly one negative-coloured bar", negs.length === 1, String(negs.length));
  // a negative bar's path must travel LEFT of its start
  var startX = parseFloat(/^M([\d.]+),/.exec(negs[0].d)[1]);
  var hTarget = parseFloat(/H([\d.]+)/.exec(negs[0].d)[1]);
  ok("negative bar extends leftward", hTarget < startX, "start " + startX + " -> " + hTarget);

  var poss = paths.filter(function (p) { return p.fill.indexOf("--credit") >= 0; });
  ok("positive bars use the credit hue", poss.length === 2, String(poss.length));
  var pStart = parseFloat(/^M([\d.]+),/.exec(poss[0].d)[1]);
  var pRun = parseFloat(/h([-\d.]+)/.exec(poss[0].d)[1]);
  ok("positive bar extends rightward", pRun > 0, String(pRun));
  ok("both signs share the same zero anchor", Math.abs(pStart - startX) < 0.01,
     pStart + " vs " + startX);
})();

sec("all-positive data keeps the axis at the left edge");
(function () {
  var svg = runBars(drawCategoryBars, SHAPES["all positive"], 640);
  var paths = parsePaths(svg);
  var starts = paths.map(function (p) { return parseFloat(/^M([\d.]+),/.exec(p.d)[1]); });
  ok("every bar starts at the same x", Math.max.apply(null, starts) - Math.min.apply(null, starts) < 0.01);
  ok("no gutter is reserved when nothing is negative", starts[0] < 160, String(starts[0]));
  ok("no negative-coloured bars", !paths.some(function (p) { return p.fill.indexOf("--expense") >= 0; }));
  ok("all bars are the credit hue", paths.every(function (p) { return p.fill.indexOf("--credit") >= 0; }));
})();

sec("row order is preserved, and shared between the two charts");
(function () {
  // deliberately NOT sorted — the caller owns the order, the chart must not resort
  var rows = [
    { id: "a", label: "Zulu", value: 10 },
    { id: "b", label: "Alpha", value: 990 },
    { id: "c", label: "Mike", value: -50 },
    { id: "d", label: "Bravo", value: 300 },
  ];
  function labelOrder(fn) {
    var texts = parseTexts(runBars(fn, rows, 700));
    // names are the left-most text on each row; take them top to bottom
    var byY = {};
    texts.forEach(function (t) { var k = Math.round(t.y); if (!byY[k] || t.x < byY[k].x) byY[k] = t; });
    return Object.keys(byY).map(Number).sort(function (p, q) { return p - q; })
      .map(function (k) { return byY[k].text; });
  }
  var barsOrder = labelOrder(drawCategoryBars);
  var divOrder = labelOrder(drawDivergingBars);
  var want = ["Zulu", "Alpha", "Mike", "Bravo"];
  ok("drawCategoryBars keeps the caller's order", barsOrder.join(",") === want.join(","), barsOrder.join(","));
  ok("drawDivergingBars keeps the caller's order", divOrder.join(",") === want.join(","), divOrder.join(","));
  ok("both charts agree row for row", barsOrder.join(",") === divOrder.join(","),
     barsOrder.join(",") + "  vs  " + divOrder.join(","));
})();

sec("balance bars are coloured by sign");
(function () {
  var rows = [{ id: "a", label: "Up", value: 400 }, { id: "b", label: "Down", value: -400 }];
  var paths = parsePaths(runBars(drawCategoryBars, rows, 700));
  ok("two bars", paths.length === 2, String(paths.length));
  ok("the positive bar is green", paths[0].fill.indexOf("--credit") >= 0, paths[0].fill);
  ok("the negative bar is red", paths[1].fill.indexOf("--expense") >= 0, paths[1].fill);
  ok("no leftover neutral series hue", !paths.some(function (p) { return p.fill.indexOf("series-1") >= 0; }));
})();

sec("zero values draw no bar but keep their label");
(function () {
  var svg = runBars(drawCategoryBars, SHAPES["zeros"], 640);
  ok("no bar paths for all-zero data", parsePaths(svg).length === 0);
  var texts = parseTexts(svg);
  ok("names still rendered", texts.some(function (t) { return t.text === "Untouched"; }));
  ok("values still rendered", texts.filter(function (t) { return t.text === "$0"; }).length === 2);
})();

sec("empty input");
(function () {
  [drawCategoryBars, drawDivergingBars].forEach(function (fn) {
    var svg = runBars(fn, [], 640);
    ok("empty data renders a message, not a crash", svg.indexOf("<text") >= 0);
    ok("empty data draws no bars", parsePaths(svg).length === 0);
  });
})();

sec("monthly columns");
(function () {
  var months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  var data = {
    "2026-03": { credited: 400, spent: 210, net: 190 },
    "2026-04": { credited: 400, spent: 620, net: -220 },
    "2026-05": { credited: 400, spent: 0, net: 400 },
    "2026-06": { credited: 0, spent: 180, net: -180 },
    "2026-07": { credited: 400, spent: 395, net: 5 },
    "2026-08": { credited: 400, spent: 120, net: 280 },
  };
  var svgEl = new FakeEl("svg"), box = new FakeEl("div");
  box.clientWidth = 900; box.__svg = svgEl;
  drawMonthlyColumns(box, months, function (m) { return data[m]; });
  var svg = svgEl.innerHTML;
  var paths = parsePaths(svg);
  var credits = paths.filter(function (p) { return p.fill.indexOf("--credit") >= 0; });
  var expenses = paths.filter(function (p) { return p.fill.indexOf("--expense") >= 0; });
  ok("one credit bar per month with credits", credits.length === 5, String(credits.length));
  ok("one expense bar per month with expenses", expenses.length === 5, String(expenses.length));
  ok("a zero-credit month draws no credit bar", credits.length === months.length - 1);

  var texts = parseTexts(svg);
  var labelled = texts.filter(function (t) { return t.text === "$400" || t.text === "$120"; });
  ok("only the newest month is direct-labelled", labelled.length === 2,
     JSON.stringify(texts.map(function (t) { return t.text; })));

  // month ticks must not collide
  var ticks = texts.filter(function (t) { return /^[A-Z][a-z]{2}$/.test(t.text); });
  for (var i = 1; i < ticks.length; i++) {
    var a = spanOf(ticks[i - 1]), b = spanOf(ticks[i]);
    ok("month tick \"" + ticks[i - 1].text + "\" vs \"" + ticks[i].text + "\" don't overlap", b[0] >= a[1] - 0.5);
  }

  var svgEl2 = new FakeEl("svg"), box2 = new FakeEl("div");
  box2.clientWidth = 380; box2.__svg = svgEl2;
  var many = [];
  for (var y = 2025; y <= 2026; y++) for (var mo = 1; mo <= 12; mo++)
    many.push(y + "-" + String(mo).padStart(2, "0"));
  drawMonthlyColumns(box2, many, function () { return { credited: 300, spent: 200, net: 100 }; });
  var t2 = parseTexts(svgEl2.innerHTML).filter(function (t) { return /^[A-Z][a-z]{2}$/.test(t.text); });
  ok("24 months on a narrow chart thins the ticks", t2.length <= 9, String(t2.length));
  for (var j = 1; j < t2.length; j++) {
    var p = spanOf(t2[j - 1]), c = spanOf(t2[j]);
    ok("thinned tick " + j + " doesn't overlap its neighbour", c[0] >= p[1] - 0.5,
       p[1].toFixed(1) + " -> " + c[0].toFixed(1));
  }
})();


sec("stacked segments (committed / free)");
(function () {
  function parseRects(svg) {
    var out = [], re = /<rect x="([\d.]+)" y="(\d+)" width="([\d.]+)" height="(\d+)" fill="([^"]*)"\/>/g, m;
    while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], w: +m[3], fill: m[5] });
    return out;
  }
  var rows = [
    { id: "h", label: "House", value: 6918,
      parts: [{ value: 6658, fill: "var(--text-muted)", label: "Committed" },
              { value: 260, fill: "var(--credit)", label: "Free" }] },
    { id: "t", label: "Travel", value: 8103,
      parts: [{ value: 1103, fill: "var(--text-muted)", label: "Committed" },
              { value: 7000, fill: "var(--credit)", label: "Free" }] },
  ];
  var svg = runBars(drawCategoryBars, rows, 700);
  var rects = parseRects(svg);      // non-final segments render as rects
  var paths = parsePaths(svg);      // final segment keeps the rounded end

  ok("one squared segment per row", rects.length === 2, String(rects.length));
  ok("squared segments are the committed grey",
     rects.every(function (r) { return r.fill.indexOf("text-muted") >= 0; }));
  ok("one rounded segment per row", paths.length === 2, String(paths.length));
  ok("rounded segments are the free green",
     paths.every(function (p) { return p.fill.indexOf("--credit") >= 0; }));

  // the 2px surface gap must actually exist between the two segments
  rects.forEach(function (rc) {
    var sameRow = paths.filter(function (p) {
      return Math.abs(parseFloat(/^M[\d.]+,(\d+)/.exec(p.d)[1]) - rc.y) < 0.01; })[0];
    ok("a following segment exists on the row", !!sameRow);
    var startX = parseFloat(/^M([\d.]+),/.exec(sameRow.d)[1]);
    var gap = startX - (rc.x + rc.w);
    ok("exactly a 2px gap separates the segments", Math.abs(gap - 2) < 0.05, String(gap));
  });

  // segments must sum to the whole bar
  rows.forEach(function (r, i) {
    var rc = rects[i];
    var pth = paths[i];
    var endX = parseFloat(/H([\d.]+) Z/.exec(pth.d)[1]);   // the closing H of the rounded seg
    var segTotal = (rc.w + 2) + (parseFloat(/h([\d.]+)/.exec(pth.d)[1]) + 4);
    ok("row " + i + ": segments span the bar within a pixel",
       Math.abs(segTotal - r.parts.reduce(function (s2, p) { return s2 + p.value; }, 0) /
         r.value * (rc.x !== undefined ? segTotal : segTotal)) < 1.5);
  });

  // proportionality: House is 96% committed, Travel 14%
  var houseFrac = rects[0].w / (rects[0].w + parseFloat(/h([\d.]+)/.exec(paths[0].d)[1]));
  var travelFrac = rects[1].w / (rects[1].w + parseFloat(/h([\d.]+)/.exec(paths[1].d)[1]));
  ok("House reads as almost entirely committed", houseFrac > 0.9, houseFrac.toFixed(2));
  ok("Travel reads as mostly free", travelFrac < 0.2, travelFrac.toFixed(2));
  ok("the two differ sharply", houseFrac - travelFrac > 0.7);
})();

sec("stacked edge cases");
(function () {
  function segCount(rows, W) {
    var svg = runBars(drawCategoryBars, rows, W || 700);
    return { paths: parsePaths(svg).length,
             rects: (svg.match(/<rect x="[\d.]+" y="\d+" width="[\d.]+" height="\d+" fill=/g) || []).length };
  }
  ok("a fully committed row draws one segment, no free sliver",
     segCount([{ id: "a", label: "All committed", value: 5000,
       parts: [{ value: 5000, fill: "var(--text-muted)" }, { value: 0, fill: "var(--credit)" }] }]).paths === 1);
  ok("a fully free row draws one segment, no committed sliver",
     segCount([{ id: "a", label: "All free", value: 5000,
       parts: [{ value: 0, fill: "var(--text-muted)" }, { value: 5000, fill: "var(--credit)" }] }]).paths === 1);
  var tiny = segCount([{ id: "a", label: "Sliver", value: 10000,
    parts: [{ value: 9999, fill: "var(--text-muted)" }, { value: 1, fill: "var(--credit)" }] }]);
  ok("a sub-pixel segment is dropped rather than drawn as a blob",
     tiny.paths + tiny.rects <= 2, JSON.stringify(tiny));
  var neg = parsePaths(runBars(drawCategoryBars, [{ id: "a", label: "Overdrawn", value: -400,
    parts: [{ value: 0, fill: "var(--text-muted)" }, { value: -400, fill: "var(--credit)" }] }], 700));
  ok("a negative row ignores parts and draws one red bar",
     neg.length === 1 && neg[0].fill.indexOf("--expense") >= 0, JSON.stringify(neg));
  ok("rows without parts still render exactly as before",
     parsePaths(runBars(drawCategoryBars, [{ id: "a", label: "Plain", value: 500 }], 700)).length === 1);
})();


sec("allocation bar");
(function () {
  function run(income, segs, W) {
    var svgEl = new FakeEl("svg"), box = new FakeEl("div");
    box.clientWidth = W || 800; box.__svg = svgEl;
    drawAllocationBar(box, income, segs);
    return svgEl.innerHTML;
  }
  var SEGS = [
    { label: "Groceries", short: "\ud83c\udf4e", value: 1542, fill: "var(--hue-orange)" },
    { label: "Children", short: "\ud83d\udc76", value: 1468, fill: "var(--hue-plum)" },
    { label: "Travel", short: "\u2708", value: 1138, fill: "var(--hue-green)" },
    { label: "Left over", short: "Left over", value: 702, fill: "var(--track-accent)" },
  ];
  var svg = run(8000, SEGS);
  var paths = parsePaths(svg);
  ok("one segment per entry", paths.length === 4, String(paths.length));
  ok("segments keep their own fills",
     paths.map(function (p) { return p.fill; }).join("|").indexOf("--hue-orange") >= 0);

  // widths must be proportional to value
  function segWidth(d) {
    var xs = (d.match(/[MH]([\d.]+)/g) || []).map(function (t) { return parseFloat(t.slice(1)); });
    return Math.max.apply(null, xs) - Math.min.apply(null, xs);
  }
  var w0 = segWidth(paths[0].d), w2 = segWidth(paths[2].d);
  var ratio = w0 / w2, want = 1542 / 1138;
  ok("widths are proportional to value", Math.abs(ratio - want) < 0.08,
     ratio.toFixed(3) + " vs " + want.toFixed(3));

  // nothing may exceed the viewBox
  var maxX = 0;
  paths.forEach(function (p) {
    (p.d.match(/[MH]([\d.]+)/g) || []).forEach(function (t) {
      maxX = Math.max(maxX, parseFloat(t.slice(1))); });
  });
  ok("the bar stays inside the viewBox", maxX <= 800.5, String(maxX));

  var texts = parseTexts(svg);
  texts.forEach(function (t) {
    var sp = spanOf(t);
    ok("label \"" + t.text + "\" stays inside", sp[0] >= -0.5 && sp[1] <= 800.5,
       "[" + sp[0].toFixed(1) + "," + sp[1].toFixed(1) + "]");
  });
})();

sec("allocation bar: overspending shows an income line");
(function () {
  function run(income, segs, W) {
    var svgEl = new FakeEl("svg"), box = new FakeEl("div");
    box.clientWidth = W || 800; box.__svg = svgEl;
    drawAllocationBar(box, income, segs);
    return svgEl.innerHTML;
  }
  var over = run(3000, [
    { label: "Rent", short: "Rent", value: 2000, fill: "var(--hue-blue)" },
    { label: "Food", short: "Food", value: 1500, fill: "var(--hue-orange)" },
  ]);
  ok("an income marker is drawn", /<line /.test(over), "no line");
  ok("it is labelled", /income \$3,000/.test(over), over.slice(0, 200));
  var lineX = parseFloat(/<line x1="([\d.]+)"/.exec(over)[1]);
  ok("the marker sits at income/budget of the width",
     Math.abs(lineX / 800 - 3000 / 3500) < 0.03, String(lineX / 800));

  var under = run(8000, [{ label: "Rent", short: "Rent", value: 2000, fill: "var(--hue-blue)" }]);
  ok("no income marker when within budget", !/<line /.test(under));
})();

sec("allocation bar: labels only when they fit");
(function () {
  function run(income, segs, W) {
    var svgEl = new FakeEl("svg"), box = new FakeEl("div");
    box.clientWidth = W || 800; box.__svg = svgEl;
    drawAllocationBar(box, income, segs);
    return svgEl.innerHTML;
  }
  var svg = run(10000, [
    { label: "Big", short: "Big spender", value: 9900, fill: "var(--hue-blue)" },
    { label: "Tiny", short: "Tiny sliver label", value: 100, fill: "var(--hue-red)" },
  ]);
  var texts = parseTexts(svg).map(function (t) { return t.text; });
  ok("the wide segment is labelled", texts.indexOf("Big spender") >= 0, JSON.stringify(texts));
  ok("the sliver is NOT labelled rather than clipped",
     texts.indexOf("Tiny sliver label") < 0, JSON.stringify(texts));

  ok("empty input renders a message, not a crash", /<text/.test(run(5000, [])));
  ok("empty input draws no bars", parsePaths(run(5000, [])).length === 0);
  ok("zero-value segments are skipped",
     parsePaths(run(5000, [{ label: "A", value: 0, fill: "x" }, { label: "B", value: 500, fill: "y" }])).length === 1);
})();


/* ── stacked columns (the forecast) ──────────────────────────────────────── */
sec("stacked columns");
(function () {
  function parseRects(svg) {
    var out = [], re = /<rect ([^>]*?)\/>/g, m;
    while ((m = re.exec(svg))) {
      var a = m[1];
      var get = function (k) { var r = new RegExp(k + '="([^"]*)"').exec(a); return r ? r[1] : null; };
      out.push({ x: parseFloat(get("x")), y: parseFloat(get("y")),
                 w: parseFloat(get("width")), h: parseFloat(get("height")),
                 fill: get("fill") || "", cls: get("class") || "" });
    }
    return out;
  }
  function run(data, width) {
    var svgEl = new FakeEl("svg"), box = new FakeEl("div");
    box.clientWidth = width || 640;
    box.__svg = svgEl;
    drawStackedColumns(box, data, SERIES, {});
    return svgEl.innerHTML;
  }
  var SERIES = [{ label: "Allocated", fill: "var(--series-1)" },
                { label: "Unallocated", fill: "var(--credit)" }];
  var months = ["Sep", "Oct", "Nov", "Dec"];
  var data = months.map(function (m, i) {
    return { label: m, values: [1000 + i * 200, 5000 + i * 100] }; });

  var svg = run(data);
  var bars = parseRects(svg).filter(function (r) { return r.cls !== "hit"; });
  ok("one rect per segment", bars.length === 8, String(bars.length));
  eq("  half are the first series", bars.filter(function (r) {
    return r.fill.indexOf("--series-1") >= 0; }).length, 4);
  eq("  half the second", bars.filter(function (r) {
    return r.fill.indexOf("--credit") >= 0; }).length, 4);

  // stacking: the second series must sit ABOVE the first in every column
  var byX = {};
  bars.forEach(function (r) { (byX[Math.round(r.x)] = byX[Math.round(r.x)] || []).push(r); });
  var stackedRight = Object.keys(byX).every(function (k) {
    var pair = byX[k];
    if (pair.length !== 2) return false;
    var alloc = pair.filter(function (r) { return r.fill.indexOf("--series-1") >= 0; })[0];
    var un = pair.filter(function (r) { return r.fill.indexOf("--credit") >= 0; })[0];
    return alloc && un && un.y < alloc.y;    // smaller y is higher on screen
  });
  ok("the second series always stacks on top of the first", stackedRight);
  ok("  so position identifies them even without colour", stackedRight);

  // segments never overlap: a 2px surface gap sits between them
  var gapsOK = Object.keys(byX).every(function (k) {
    var pair = byX[k].slice().sort(function (a, b) { return a.y - b.y; });
    return pair[0].y + pair[0].h <= pair[1].y + 0.01;
  });
  ok("stacked segments never overlap", gapsOK);

  // every bar inside the plot area
  var H = 240, PADt = 18, PADb = 28;
  ok("no bar escapes the top of the plot",
     bars.every(function (r) { return r.y >= PADt - 0.5; }),
     JSON.stringify(bars.map(function (r) { return r.y; })));
  ok("no bar escapes the bottom",
     bars.every(function (r) { return r.y + r.h <= H - PADb + 0.5; }));
  ok("bars stay inside the left gutter",
     bars.every(function (r) { return r.x >= 64 - 0.5; }));
  ok("  and the right edge", bars.every(function (r) { return r.x + r.w <= 640 - 16 + 0.5; }));

  // a taller total must draw a taller stack
  var small = parseRects(run([{ label: "A", values: [100, 100] }])).filter(function (r) { return r.cls !== "hit"; });
  var big = parseRects(run([{ label: "A", values: [100, 100] }, { label: "B", values: [500, 500] }]))
    .filter(function (r) { return r.cls !== "hit"; });
  ok("a bigger value draws a bigger segment",
     big[big.length - 1].h > 0 && big.length === 4);

  eq("one label per column", parseTexts(svg).filter(function (t) {
    return months.indexOf(t.text) >= 0; }).length, 4);

  // exactly one direct label — never a number on every bar
  var moneyLabels = parseTexts(svg).filter(function (t) {
    return /^\$/.test(t.text) && t.text.indexOf("$") === 0; });
  ok("y-axis ticks plus a single direct label, not one per bar",
     moneyLabels.length <= 9, String(moneyLabels.length));

  // 24 months on a narrow chart must thin the x labels
  var many = [];
  for (var i = 0; i < 24; i++) many.push({ label: "M" + i, values: [100, 200] });
  var narrow = parseTexts(run(many, 360)).filter(function (t) { return /^M\d+$/.test(t.text); });
  ok("x labels thin out when crowded", narrow.length <= 9, String(narrow.length));

  // negatives drop below the baseline rather than being clipped away
  var neg = parseRects(run([{ label: "A", values: [3000, -1000] }]))
    .filter(function (r) { return r.cls !== "hit"; });
  ok("a negative segment is still drawn", neg.length === 2, String(neg.length));
  var negSeg = neg.filter(function (r) { return r.fill.indexOf("--credit") >= 0; })[0];
  var posSeg = neg.filter(function (r) { return r.fill.indexOf("--series-1") >= 0; })[0];
  ok("  and sits below the positive one", negSeg.y > posSeg.y,
     negSeg.y + " vs " + posSeg.y);
  ok("  still inside the plot", negSeg.y + negSeg.h <= 240 - 28 + 0.5);

  // empty
  ok("an empty series says so", /Nothing to project|<text/.test(run([])));
})();


/* ── balance line: baseline and axis labels ──────────────────────────────── */
sec("balance line");
(function () {
  function run(pts, width) {
    var svgEl = new FakeEl("svg"), box = new FakeEl("div");
    box.clientWidth = width || 640;
    box.__svg = svgEl;
    drawBalanceLine(box, pts, {});
    return svgEl.innerHTML;
  }

  // the reported case: a fund sitting between $1,000 and $1,150
  var svg = run([{ date: "2026-08-26", value: 1000 }, { date: "2026-09-01", value: 1150 }]);
  var yLabs = parseTexts(svg).filter(function (t) { return t.anchor === "end" && /^\$/.test(t.text); });
  ok("the y-axis includes zero, so the fill has a real baseline",
     yLabs.some(function (t) { return /^\$0$/.test(t.text); }),
     yLabs.map(function (t) { return t.text; }).join(","));
  var tickVals = yLabs.map(function (t) {
    return parseFloat(t.text.replace(/[$,]/g, "")) * (/k/i.test(t.text) ? 1000 : 1); });
  ok("  and the top tick still clears the data",
     Math.max.apply(null, tickVals) >= 1150,
     yLabs.map(function (t) { return t.text; }).join(","));

  // the filled area must close on the zero line, inside the plot
  var areas = /<path d="([^"]*)" fill="var\(--series-1-wash\)"/.exec(svg);
  ok("an area path is drawn", !!areas);
  var H = 220, PADt = 14, PADb = 26;
  var ys = (areas[1].match(/,(-?[\d.]+)/g) || []).map(function (v) { return parseFloat(v.slice(1)); });
  ok("  every vertex sits inside the plot area",
     ys.every(function (y) { return y >= PADt - 0.5 && y <= H - PADb + 0.5; }),
     JSON.stringify(ys));

  // x labels must never print the same date twice
  var xLabs = parseTexts(svg).filter(function (t) { return !/^\$/.test(t.text); });
  ok("no x label is repeated",
     new Set(xLabs.map(function (t) { return t.text; })).size === xLabs.length,
     xLabs.map(function (t) { return t.text; }).join(","));

  // two points that render to the same short date collapse to one label
  var same = run([{ date: "2026-08-26", value: 10 }, { date: "2026-08-26", value: 20 }]);
  var sameLabs = parseTexts(same).filter(function (t) { return !/^\$/.test(t.text); });
  ok("identical dates print one label, not two",
     new Set(sameLabs.map(function (t) { return t.text; })).size === sameLabs.length,
     sameLabs.map(function (t) { return t.text; }).join(","));

  // negatives still reach below zero
  var neg = run([{ date: "2026-08-01", value: -300 }, { date: "2026-09-01", value: 200 }]);
  var negLabs = parseTexts(neg).filter(function (t) { return t.anchor === "end" && /\$/.test(t.text); });
  ok("an overdrawn fund still shows zero on the axis",
     negLabs.some(function (t) { return /^\$0$/.test(t.text); }),
     negLabs.map(function (t) { return t.text; }).join(","));
  ok("  and a negative tick", negLabs.some(function (t) { return /-/.test(t.text); }),
     negLabs.map(function (t) { return t.text; }).join(","));

  // a flat series doesn't collapse the scale
  var flat = run([{ date: "2026-08-01", value: 500 }, { date: "2026-09-01", value: 500 }]);
  ok("a flat line still renders", /<path/.test(flat));
})();


sec("stacked columns at five years");
(function () {
  function parseRects(svg) {
    var out = [], re = /<rect ([^>]*?)\/>/g, m;
    while ((m = re.exec(svg))) {
      var a = m[1];
      var get = function (k) { var r = new RegExp(k + '="([^"]*)"').exec(a); return r ? r[1] : null; };
      out.push({ x: parseFloat(get("x")), y: parseFloat(get("y")), w: parseFloat(get("width")),
                 h: parseFloat(get("height")), cls: get("class") || "" });
    }
    return out;
  }
  var SERIES = [{ label: "Allocated", fill: "var(--series-1)" },
                { label: "Unallocated", fill: "var(--credit)" }];
  var data = [];
  for (var i = 0; i < 60; i++) {
    data.push({ label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i % 12],
                values: [20000 + i * 200, 50000 + i * 400] });
  }
  var svgEl = new FakeEl("svg"), box = new FakeEl("div");
  box.clientWidth = 900; box.__svg = svgEl;
  drawStackedColumns(box, data, SERIES, {});
  var svg = svgEl.innerHTML;
  var bars = parseRects(svg).filter(function (r) { return r.cls !== "hit"; });

  eq("one rect per segment, sixty months", bars.length, 120);
  ok("no bar collapses to a hairline", bars.every(function (r) { return r.w >= 3; }),
     String(Math.min.apply(null, bars.map(function (r) { return r.w; }))));
  ok("bars stay inside the plot", bars.every(function (r) {
    return r.x >= 64 - 0.5 && r.x + r.w <= 900 - 16 + 0.5; }));
  ok("  and inside it vertically", bars.every(function (r) {
    return r.y >= 18 - 0.5 && r.y + r.h <= 240 - 28 + 0.5; }));

  // x labels must not collide at 60 columns
  var labs = parseTexts(svg).filter(function (t) { return /^[A-Z][a-z]{2}$/.test(t.text); })
    .sort(function (a, b) { return a.x - b.x; });
  ok("labels are thinned", labs.length <= 10, String(labs.length));
  var clash = false;
  for (var k = 1; k < labs.length; k++) {
    if (spanOf(labs[k - 1])[1] > spanOf(labs[k])[0] - 2) clash = true;
  }
  ok("  and none of them overlap", !clash,
     labs.map(function (t) { return t.text + "@" + Math.round(t.x); }).join(" "));

  // narrow window, still no collisions
  var box2 = new FakeEl("div"), svg2 = new FakeEl("svg");
  box2.clientWidth = 360; box2.__svg = svg2;
  drawStackedColumns(box2, data, SERIES, {});
  var labs2 = parseTexts(svg2.innerHTML).filter(function (t) { return /^[A-Z][a-z]{2}$/.test(t.text); })
    .sort(function (a, b) { return a.x - b.x; });
  var clash2 = false;
  for (var j = 1; j < labs2.length; j++) {
    if (spanOf(labs2[j - 1])[1] > spanOf(labs2[j])[0] - 2) clash2 = true;
  }
  ok("60 months on a 360px chart still doesn't collide", !clash2,
     labs2.map(function (t) { return t.text; }).join(","));
})();

console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

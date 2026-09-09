/* Static check: every function called must exist.
   Twice a block replacement silently deleted a function that was still wired
   to a button, leaving a control that throws on click. Syntax checks pass
   happily; only this catches it. */
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  ->  " + d : "")); } }

var raw = __SRC__;

/* Comments and string literals are full of ordinary words followed by "(",
   so strip them before looking for call sites. */
/* Template literals are left intact: they hold real ${...} call sites we want
   to check, and their nesting defeats any regex that tries to strip them. */
var src = raw
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
  .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
  .replace(/'(?:\\.|[^'\\\n])*'/g, "''");

var defined = {};
function collect(re, group) {
  var m; while ((m = re.exec(src))) defined[m[group || 1]] = true;
}
collect(/function\s+([A-Za-z_$][\w$]*)\s*\(/g);                               // declarations
collect(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g);                       // any const/let/var
collect(/(?:^|[{,]\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g, 1); // object methods
// parameters of arrow functions and function expressions
var pm, pre = /(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>/g;
while ((pm = pre.exec(src))) {
  (pm[1] || pm[2] || "").split(",").forEach(function (p) {
    var n = p.trim().replace(/[=:].*$/, "").replace(/^\.\.\./, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) defined[n] = true;
  });
}
// parameters of BOTH anonymous and named declarations — a callback passed in and
// then invoked (toast(msg, undo) calling undo()) is otherwise reported missing
[/function\s*\(([^()]*)\)/g, /function\s+[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g].forEach(function (re) {
  var mm; while ((mm = re.exec(src))) {
    (mm[1] || "").split(",").forEach(function (prm) {
      var n = prm.trim().replace(/[=:].*$/, "").replace(/^\.\.\./, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) defined[n] = true;
    });
  }
});

var builtin = {};
("Object Array String Number Boolean Math JSON Date Map Set Promise RegExp Error parseInt " +
 "parseFloat isNaN isFinite setTimeout clearTimeout setInterval clearInterval alert confirm " +
 "prompt fetch indexedDB localStorage console document window navigator Intl Symbol URL Blob " +
 "structuredClone requestAnimationFrame ResizeObserver encodeURIComponent decodeURIComponent " +
 "if for while switch catch return typeof instanceof new delete void function class super this " +
 "async await var let const else do try finally throw yield of in")
  .split(" ").forEach(function (k) { builtin[k] = true; });

/* No space before the paren — real calls never have one, but template prose
   like "Archived (3)" does. Exclude a leading hyphen too, or CSS color-mix()
   reads as a call to mix(). */
var calls = {}, m2, re2 = /(^|[^-.\w$])([A-Za-z_$][\w$]*)\(/g;
while ((m2 = re2.exec(src))) calls[m2[2]] = true;

var missing = [];
Object.keys(calls).forEach(function (n) { if (!defined[n] && !builtin[n]) missing.push(n); });
missing.sort();

ok("every function that is called is also defined", missing.length === 0,
   missing.length ? "undefined: " + missing.join(", ") : "");
ok("a healthy number of functions are defined", Object.keys(defined).length > 80,
   String(Object.keys(defined).length));

/* The mirror-image failure: a block replacement PASTES a function that already
   exists further up. Both parse, the later one silently wins, and editing the
   earlier one does nothing at all. moveMoney and deleteTransfer were each
   defined twice this way. */
(function () {
  var seen = {}, dupes = [], m, r = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((m = r.exec(src))) {
    if (seen[m[1]]) { if (dupes.indexOf(m[1]) < 0) dupes.push(m[1]); }
    seen[m[1]] = true;
  }
  ok("no function is declared twice", dupes.length === 0,
     dupes.length ? "duplicated: " + dupes.join(", ") : "");

  // and prove THAT check bites too
  var doubled = src + "\nfunction normalize(s) { return s; }\n";
  var s2 = {}, d2 = [], m2, r2 = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((m2 = r2.exec(doubled))) {
    if (s2[m2[1]]) { if (d2.indexOf(m2[1]) < 0) d2.push(m2[1]); }
    s2[m2[1]] = true;
  }
  ok("  the duplicate check would notice a second normalize()", d2.indexOf("normalize") >= 0);
})();

/* Two elements sharing an id is a live collision: $("#x") returns whichever
   comes first in the document, so one caller silently gets the other's element.
   #alloc-box was used by the monthly-plan bar AND by the allocation dialog —
   both rendered, both present at once — so the dialog's bar was drawn into the
   overview's chart and vanished.

   Ids repeated across mutually exclusive VIEWS are fine, since only one view is
   in #view at a time. Those are listed explicitly rather than inferred: a short
   allowlist that must be justified beats a clever rule that misses real clashes. */
(function () {
  var OK_REPEATED = { backBtn: "the ← Overview crumb, one per view, never two at once" };

  var counts = {}, m, r = /\bid="([A-Za-z][\w-]*)"/g;
  while ((m = r.exec(__DOC__))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  var dupes = Object.keys(counts).filter(function (k) {
    return counts[k] > 1 && !OK_REPEATED[k];
  });
  ok("no id is used twice outside the allowlist", dupes.length === 0,
     dupes.length ? "duplicated: " + dupes.map(function (k) {
       return k + " x" + counts[k]; }).join(", ") : "");

  ok("  the allowlist itself is still accurate",
     Object.keys(OK_REPEATED).every(function (k) { return counts[k] > 1; }),
     "an allowlisted id is no longer duplicated — drop it from the list");

  // prove it bites: reintroduce exactly the collision that caused the bug
  var c2 = {}, m2, r2 = /\bid="([A-Za-z][\w-]*)"/g;
  var broken = __DOC__.replace('id="allocSplitBox"', 'id="alloc-box"');
  while ((m2 = r2.exec(broken))) c2[m2[1]] = (c2[m2[1]] || 0) + 1;
  ok("  it would catch the allocation dialog reusing #alloc-box",
     c2["alloc-box"] > 1, "count " + c2["alloc-box"]);
})();

/* A top-level $("#id").addEventListener on an element that isn't in the markup
   throws during load — and takes every listener registered AFTER it with it.
   The symptom is bizarre: unrelated features stop responding, with no visible
   error unless the console is open. */
(function () {
  var ids = {}, m, r = /\bid="([A-Za-z][\w-]*)"/g;
  while ((m = r.exec(__DOC__))) ids[m[1]] = true;

  var missing = [], m2;
  // only statements at column 0 — those run at load, before any guard can help
  // `raw`, not `src`: the stripper blanks string literals, so $("#x") reads $("")
  var r2 = /^\$\("#([A-Za-z][\w-]*)"\)/gm;
  while ((m2 = r2.exec(raw))) if (!ids[m2[1]]) missing.push(m2[1]);
  ok("every element wired at load actually exists in the markup",
     missing.length === 0, missing.length ? "absent: " + missing.join(", ") : "");

  var seen = {}, m3, r3 = /^\$\("#([A-Za-z][\w-]*)"\)/gm;
  while ((m3 = r3.exec(raw))) seen[m3[1]] = true;
  ok("  and there are some to check", Object.keys(seen).length > 8,
     String(Object.keys(seen).length));
  ok("  the check would notice a typo'd id",
     !ids["mCSVV"], "control");
})();

/* A top-level function must close at column 0 before the next one begins.
   Deleting a block that happened to include a function's final `}` leaves the
   file BALANCED — every later function is simply swallowed into its body — so
   the parser is happy and the page renders blank. That is exactly how
   viewOverview once ate legendFor and everything after it. */
(function () {
  var lines = raw.split("\n");
  var starts = [];
  lines.forEach(function (l, i) {
    if (/^function [A-Za-z_$][\w$]*\s*\(/.test(l)) starts.push(i);
  });
  var unclosed = [];
  starts.forEach(function (a, k) {
    var b = k + 1 < starts.length ? starts[k + 1] : lines.length;
    // a one-liner closes on its own line
    if (/\}\s*$/.test(lines[a])) return;
    var closes = false;
    for (var i = a; i < b; i++) if (lines[i] === "}") { closes = true; break; }
    if (!closes) unclosed.push(/^function ([\w$]+)/.exec(lines[a])[1]);
  });
  ok("every top-level function closes before the next one starts",
     unclosed.length === 0, unclosed.length ? "runs on: " + unclosed.join(", ") : "");
  ok("  and there are plenty to check", starts.length > 60, String(starts.length));

  // prove it bites: swallow one function's closing brace
  var broken = lines.slice();
  for (var j = starts[3]; j < broken.length; j++) {
    if (broken[j] === "}") { broken[j] = "  /* eaten */"; break; }
  }
  var still = [];
  var s2 = [];
  broken.forEach(function (l, i) { if (/^function [A-Za-z_$][\w$]*\s*\(/.test(l)) s2.push(i); });
  s2.forEach(function (a, k) {
    var b = k + 1 < s2.length ? s2[k + 1] : broken.length;
    if (/\}\s*$/.test(broken[a])) return;
    var closes = false;
    for (var i = a; i < b; i++) if (broken[i] === "}") { closes = true; break; }
    if (!closes) still.push(a);
  });
  ok("  a swallowed brace is caught", still.length > 0, "control");
})();

/* prove the check actually bites: pretend a wired function was deleted */
(function () {
  var broken = src.replace(/function\s+openMove\s*\(/, "function __gone__(");
  var d2 = {}; var m; var r = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = r.exec(broken))) d2[m[1]] = true;
  ok("the check would notice openMove going missing", !d2.openMove);
})();

console.log("\n  " + Object.keys(defined).length + " names in scope, " +
            Object.keys(calls).length + " call targets checked");
console.log("\n" + (fail ? "FAILED" : "ALL PASS") + " — " + pass + " passed, " + fail + " failed\n");

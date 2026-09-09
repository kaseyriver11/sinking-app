"""Regenerate every test harness from the CURRENT index.html.

Paths are derived from this file's own location, so the project can live
anywhere (and on any OS) without editing this script. Generated harnesses
land in tests/.gen/, run by run.sh via Node — see that file for how.
"""
import re, json, sys, pathlib

TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
GEN = TESTS / ".gen"
GEN.mkdir(exist_ok=True)

def read(p): return p.read_text(encoding="utf-8")
def write_text(p, s): pathlib.Path(p).write_text(s, encoding="utf-8")

APP = ROOT / "index.html"
src = read(APP)
body = re.search(r'<script>\n"use strict";(.*?)</script>', src, re.S).group(1)
write_text(GEN / "app_body.js", body)
write_text(GEN / "parsecheck.js", "var f=function(){\n" + body + "\n};console.log('PARSE OK')")

sec1 = body[body.index("const SCHEMA_VERSION"):body.index("   2. Persistence")].rsplit("/* ═", 1)[0]
sec1 = (sec1.replace("const $ = (sel, root = document) => root.querySelector(sel);", "")
            .replace("const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];", ""))

# Harnesses are generated once but may run on any real calendar date, and a
# lot of fixtures assume "today" sits in a specific month relative to their
# data (e.g. "the bill is due September, today is August"). Left alone, every
# one of those silently breaks the moment the real calendar crosses whatever
# month boundary the fixture assumed — which is exactly what happened when
# the suite was first run in September: seven suites, ~60 assertions, none
# of it a real regression. Pinning todayStr's no-argument case ("what is
# today") to a fixed date makes every suite deterministic regardless of when
# ./run.sh actually runs. Explicit arguments — todayStr is also used to
# format some OTHER date, not "today" — still work normally either way.
sec1 += ('\nvar __realTodayStr = todayStr;\n'
         'todayStr = function (d) { return arguments.length ? __realTodayStr(d) : "2026-08-31"; };\n')

def fn(name):
    m = re.search(r'\nfunction ' + name + r'\(.*?\n\}', body, re.S)
    if not m: raise SystemExit("missing function: " + name)
    return m.group(0)

def const(pattern):
    m = re.search(pattern, body, re.S)
    if not m: raise SystemExit("missing const: " + pattern[:40])
    return m.group(0)

NORM  = fn("normalize") if "return out;\n}" not in body else re.search(
    r'function normalize\(s\) \{.*?\n  return out;\n\}', body, re.S).group(0)
NORMB = fn("normalizeBudgets")
MERGE = re.search(r'function mergeStates\(base, newer\) \{.*?\n\}\n', body, re.S).group(0)
ICONS = const(r'const ICONS = \{[\s\S]*?\n\};')

DOM = ("var document={createElement:function(){return {append:function(){}};},documentElement:{dataset:{}}};\n"
       "var window={matchMedia:function(){return {matches:false};}};\nvar save=function(){};\n")
LS = ('var _ls={};var localStorage={getItem:function(k){return _ls.hasOwnProperty(k)?_ls[k]:null;},'
      'setItem:function(k,v){_ls[k]=String(v);},removeItem:function(k){delete _ls[k];}};\n')

def base(extra=""):
    return DOM + sec1 + "\n" + NORMB + "\n" + NORM + "\n" + extra + "\n"

def write(out, head, tests):
    write_text(out, head + read(pathlib.Path(tests)))

MUT = "".join(fn(n) for n in [
    "nextHue","addCategory","updateCategory","addFund","updateFund","moveCategory","moveFund",
    "addEntry","editEntry","deleteEntry","archiveCategory","unarchiveCategory","purgeEntriesOf",
    "deleteFund","deleteCategory","impactOfCategory","impactOfFund","addPlan","updatePlan",
    "deletePlan","settlePlan","moveMoney","deleteTransfer"]) + const(r'const unarchiveFund = [^\n]*\n')

write(GEN / "run_prim.js",    base(fn("niceTicks")), TESTS / "tests_prim.js")
write(GEN / "run_tests7.js",  base(MERGE + MUT), TESTS / "tests7.js")
write(GEN / "run_tests8.js",  base(MUT), TESTS / "tests8.js")
write(GEN / "run_tests10.js", base(MUT + "".join(fn(n) for n in ["meterFor", "recentDraw", "coverLabel", "baseStatus", "releasableOf", "lockedOf"])), TESTS / "tests10.js")
write(GEN / "run_tests11.js", base(ICONS + MUT + fn("meterFor")), TESTS / "tests11.js")
write(GEN / "run_tests12.js", base(MUT), TESTS / "tests12.js")
write(GEN / "run_tests13.js", base(MERGE + MUT), TESTS / "tests13.js")
write(GEN / "run_tests14.js", base(MUT), TESTS / "tests14.js")
write(GEN / "run_tests15.js", base(MERGE + MUT + fn("setCashReading") + fn("setCardReading")), TESTS / "tests15.js")
write(GEN / "run_tests16.js", base(MERGE + MUT + fn("setBudget") + fn("setIncome")), TESTS / "tests16.js")
write(GEN / "run_tests17.js", base(MERGE + MUT), TESTS / "tests17.js")
write(GEN / "run_tests18.js", base(MUT), TESTS / "tests18.js")
write(GEN / "run_tests19.js", base(MUT + fn("describeSchedule")), TESTS / "tests19.js")
write(GEN / "run_tests20.js", base(MUT), TESTS / "tests20.js")

# accordion needs localStorage + the collapse block
i, j = body.index("let reordering = false;"), body.index("function renderRail()")
write_text(GEN / "run_tests9.js",
    LS + DOM + "var renderRail=function(){};\n" + sec1 + "\n" + NORMB + "\n" + NORM + "\n"
    + body[i:j] + "\n" + read(TESTS / "tests9.js"))

# geometry harness
sub = lambda t: t.replace("$$(", "SELALL(").replace("$(", "SEL(")
chunks = (const(r'const svgEmpty = [\s\S]*?;\n') + const(r'const approxW = [\s\S]*?\n\}')
          + fn("niceTicks") + fn("tipFor") + fn("drawAllocationBar")
          + fn("drawCategoryBars") + fn("drawDivergingBars") + fn("drawMonthlyColumns")
          + fn("drawStackedColumns") + fn("drawBalanceLine"))
GS = '''
function FakeEl(tag){ this.tag=tag; this.attrs={}; this.innerHTML=""; this.style={};
  this.clientWidth=640; this.children=[]; }
FakeEl.prototype.setAttribute=function(k,v){ this.attrs[k]=v; };
FakeEl.prototype.getAttribute=function(k){ return this.attrs[k]; };
FakeEl.prototype.append=function(c){ this.children.push(c); };
FakeEl.prototype.addEventListener=function(){};
var document={createElement:function(t){return new FakeEl(t);},documentElement:{dataset:{}}};
var window={matchMedia:function(){return {matches:false};}};
var go=function(){};
var SEL=function(sel,root){
  if(sel==="svg") return root.__svg;
  if(sel===".tip") return root.__tip||null;
  /* marks inside the emitted SVG are not modelled — hand back a stub so the
     hover wiring can attach without a real DOM */
  return new FakeEl(sel);
};
var SELALL=function(){ return []; };
'''
write_text(GEN / "run_tests3.js", GS + sub(sec1) + "\n" + sub(NORMB) + "\n" + sub(chunks) + "\n"
                                     + read(TESTS / "tests3.js"))

# tests21 is a static check over the source text itself
import json as _json
_t21 = read(TESTS / "tests21.js")
_t21 = _t21.replace("__SRC__", _json.dumps(body)).replace("__DOC__", _json.dumps(src))
write_text(GEN / "run_tests21.js", _t21)

_iss = (re.search(r"const RANKS = [^\n]*\n", body).group(0)
        + re.search(r"function issues\(\) \{.*?\n\}", body, re.S).group(0))
write(GEN / "run_tests22.js", base(MUT + _iss + "\nvar dismissed = {};\n"), TESTS / "tests22.js")

_fc = "".join(fn(n) for n in ["cashForecast", "addOneOff", "updateOneOff", "deleteOneOff"])
write(GEN / "run_tests23.js", base(MUT + _fc), TESTS / "tests23.js")

_bf = (const(r'const RANKS = [^\n]*\n')
       + "".join(fn(n) for n in ["recentDraw", "coverLabel", "issues", "meterFor", "catchUpAmount", "catchUpFund"]))
write(GEN / "run_tests24.js", base(MUT + _bf), TESTS / "tests24.js")

_cl = (const(r'const RANKS = [^\n]*\n')
       + "".join(fn(n) for n in ["lockedOf", "releasableOf", "deallocatableOf", "releaseFund", "issues", "baseStatus"]))
write(GEN / "run_tests25.js", base(MUT + _cl), TESTS / "tests25.js")

_ob = "".join(fn(n) for n in ["obligations", "baseStatus", "releasableOf"])
write(GEN / "run_tests26.js", base(MUT + _ob), TESTS / "tests26.js")

_fz = (const(r'const RANKS = [^\n]*\n')
       + "".join(fn(n) for n in ["lockedOf", "releasableOf", "obligations", "baseStatus",
                                 "meterFor", "recentDraw", "coverLabel", "cashForecast",
                                 "catchUpAmount"]))
write(GEN / "run_tests27.js", base(MUT + _fz), TESTS / "tests27.js")

write(GEN / "run_tests28.js", base(MUT + "".join(fn(n) for n in [
        "parseQuickAdd", "cashForecast", "monthFunding", "looksDuplicate",
        "spendPace", "annualCost", "ledgerCSV", "obligations", "baseStatus",
        "releasableOf", "lockedOf"])), TESTS / "tests28.js")

write(GEN / "run_tests29.js", base(MUT + "".join(fn(n) for n in [
        "fixedPaid", "payFixed", "monthFunding", "billCells",
        "cycleOutlook", "catchUpAmount", "monthSuggestion"])), TESTS / "tests29.js")

_af = ("".join(fn(n) for n in ["afAmounts", "afMonthly", "afSetKind", "saveAllFunds"])
       + "\n" + const(r'let draftMonthly = [^\n]*\n')
       + const(r'let draftAmounts = [^\n]*\n')
       + const(r'let draftKind = [^\n]*\n')
       + "var afOpen = new Set();\n"
       + const(r'const savedKind = [\s\S]*?;\n')
       + const(r'const afKind = [^\n]*\n')
       + const(r'const afChanged = [\s\S]*?;\n')
       + const(r'const draftTotal = [\s\S]*?;\n')
       + const(r'const draftCount = [\s\S]*?;\n'))
write(GEN / "run_tests30.js", base(MUT + _af), TESTS / "tests30.js")

_sp = "".join(fn(n) for n in ["addSplitExpense", "deleteSplitGroup", "splitTip", "matchFundLoose"])
write(GEN / "run_tests31.js", base(MUT + MERGE + _sp), TESTS / "tests31.js")

print("harnesses rebuilt from current source ->", GEN)

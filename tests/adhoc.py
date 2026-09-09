"""Build a throwaway harness from the CURRENT source: python3 adhoc.py <script.js> [--live]

Run the result with: node .gen/run_adhoc.js
"""
import re, sys, pathlib
TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
GEN = TESTS / ".gen"
GEN.mkdir(exist_ok=True)

src = (ROOT / "index.html").read_text(encoding="utf-8")
body = re.search(r'<script>\n"use strict";(.*?)</script>', src, re.S).group(1)
sec1 = body[body.index("const SCHEMA_VERSION"):body.index("   2. Persistence")].rsplit("/* ═", 1)[0]
sec1 = (sec1.replace("const $ = (sel, root = document) => root.querySelector(sel);", "")
            .replace("const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];", ""))
grab = lambda n: re.search(r'\nfunction ' + n + r'\(.*?\n\}', body, re.S).group(0)
head = ("var document={createElement:function(){return {append:function(){}};},documentElement:{dataset:{}}};\n"
        "var window={matchMedia:function(){return {matches:false};}};\nvar save=function(){};\n"
        + sec1 + "\n" + grab("normalizeBudgets") + "\n"
        + re.search(r'function normalize\(s\) \{.*?\n  return out;\n\}', body, re.S).group(0) + "\n"
        + re.search(r'const ICONS = \{[\s\S]*?\n\};', body).group(0) + "\n"
        + re.search(r'const RANKS = [^\n]*\n', body).group(0)
        + re.search(r'let draftMonthly = [^\n]*\n', body).group(0)
        + re.search(r'let draftAmounts = [^\n]*\n', body).group(0)
        + re.search(r'let draftKind = [^\n]*\n', body).group(0)
        + re.search(r'const savedKind = [\s\S]*?;\n', body).group(0)
        + re.search(r'const afKind = [^\n]*\n', body).group(0)
        + re.search(r'const afChanged = [\s\S]*?;\n', body).group(0)
        + re.search(r'const draftTotal = [\s\S]*?;\n', body).group(0)
        + re.search(r'const draftCount = [\s\S]*?;\n', body).group(0)
        + "".join(grab(n) for n in ["addEntry", "updateFund", "setBudget", "meterFor", "cashForecast", "addOneOff", "deleteOneOff",
     "lockedOf", "releasableOf", "obligations", "baseStatus", "recentDraw", "coverLabel",
     "catchUpAmount", "issues", "annualCost", "monthFunding", "looksDuplicate",
     "afAmounts", "afMonthly", "billCells", "fixedPaid",
     "spendPace", "ledgerCSV", "parseQuickAdd"]) + "\n")
test = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
if "--live" in sys.argv:
    test = test.replace("LIVE", (ROOT / "data" / "funds.json").read_text(encoding="utf-8"))
out = GEN / "run_adhoc.js"
out.write_text(head + test, encoding="utf-8")
print("wrote", out, "- run with: node", out.relative_to(TESTS))

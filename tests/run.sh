#!/bin/bash
# Regenerate every harness from the current index.html and run the lot.
# Harnesses are plain JS (no OS-specific globals), run under Node.
cd "$(dirname "$0")" || exit 1
python3 rebuild.py || exit 1
fail=0
for s in parsecheck run_prim run_tests3 run_tests7 run_tests8 run_tests9 run_tests10 \
         run_tests11 run_tests12 run_tests13 run_tests14 run_tests15 run_tests16 \
         run_tests17 run_tests18 run_tests19 run_tests20 run_tests21 run_tests22 run_tests23 run_tests24 run_tests25 run_tests26 run_tests27 run_tests28 run_tests29 run_tests30 run_tests31; do
  line=$(node ".gen/$s.js" 2>&1 | grep -E "PARSE OK|ALL PASS|FAILED|error" | tail -1)
  # every bad outcome must contain the word FAILED. A crash used to print only
  # "script error", so grepping the output for FAIL missed it and a broken build
  # read as green.
  case "$line" in
    *FAILED*)  fail=1;;
    *error*)   line="FAILED — $line"; fail=1;;
    *"PARSE OK"*|*"ALL PASS"*) ;;
    *)         line="FAILED — no result (harness produced nothing)"; fail=1;;
  esac
  printf "%-14s %s\n" "$s" "$line"
done
if [ "$fail" = 1 ]; then echo; echo "SUITE FAILED"; else echo; echo "all green"; fi
exit $fail

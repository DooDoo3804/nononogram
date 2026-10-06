#!/bin/zsh
# Chain tail verdict, rev 5 -- ADDITIVE. Run at judgment time, after finish4.sh prints
# `finish4.sh done`. This does NOT replace or edit finish4.sh: that script is live in its
# wait loop, and zsh resumes a running script by byte offset, so editing it in place can
# make the interpreter resume mid-token.
#
# Why this exists. §20.2 literal-tested rev4's `case "$vline"` classifier (the play verdict)
# and it is sound. But rev4's OTHER judgment line -- finish4.sh:111-114, the one that answers
# the pass bar "npm run build / npm test / lint green" -- was never run against literals.
# Doing that (§21.2) found the F/H/I family a fourth and fifth time:
#
#   defect J  LINT=$(npx eslint . 2>&1 | tail -3 | tr '\n' ' ')  ...  "eslint: ${LINT:-clean}"
#             eslint's exit code is discarded. Killed or crashed with no output => LINT empty
#             => prints the literal word `clean`. Measured: rc=137 no output -> "eslint: clean";
#             rc=1 no output -> "eslint: clean". A dead linter reports green.
#
#   defect K  TEST=$(npx vitest run 2>&1 | grep -E "Tests |Test Files" | ...)  ...  "vitest: $TEST"
#             A crash before the summary leaves TEST empty and the field prints blank, with no
#             ABSENT marker -- even though rev4's own report() has an explicit ABSENT branch
#             three lines up. Measured: crash-before-summary and killed both -> "vitest: ".
#
# So rev5 captures rc BEFORE anything else can clobber it (defect F lesson), and classifies
# into PASS / FAIL / CRASHED(no output) / ABSENT. No outcome is representable by silence.
set -u
REPO=/Users/stclab/Desktop/project/no-nonogram
DIR=/Users/stclab/Desktop/project/no-nonogram/qa-out/doo8
LOG="$DIR/verdict5.log"
stamp() { date +%H:%M:%S }

# classify <label> <rc> <output> [<expect-pattern>]
# Separated from execution so the classifier itself can be unit-run against literals
# (tests/tail-verdict.sh --selftest). Reading a pattern is what produced F, H, I, J and K.
classify() {
  local label="$1" rc="$2" out="$3" want="${4:-}"
  local n_lines
  n_lines=$(printf '%s' "$out" | grep -c . || true)
  if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
    echo "  $label: PASS (silent, rc=0)"
  elif [ "$rc" -eq 0 ] && [ -n "$want" ] && printf '%s' "$out" | grep -qE "$want"; then
    echo "  $label: PASS rc=0 -> $(printf '%s' "$out" | grep -E "$want" | tr -s ' ' | tr '\n' ' ')"
  elif [ "$rc" -eq 0 ]; then
    echo "  $label: PASS-WITH-OUTPUT rc=0, ${n_lines} line(s) -> $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
  elif [ -z "$out" ]; then
    echo "  $label: CRASHED rc=$rc with ZERO output -- this is the case rev4 printed as 'clean' (defect J)"
  else
    echo "  $label: FAIL rc=$rc, ${n_lines} line(s) -> $(printf '%s' "$out" | tail -5 | tr '\n' ' ')"
  fi
}

if [ "${1:-}" = "--selftest" ]; then
  echo "classifier selftest -- pass / fail / crashed / absent as literals"
  classify "a1 eslint-silent-pass"  0 ""
  classify "a2 eslint-problems"     1 "/x.js
  3:1  error  Unexpected
1 problem"
  classify "a3 eslint-KILLED"       137 ""
  classify "a4 eslint-rc1-no-out"   1 ""
  classify "b1 vitest-pass"         0 " Test Files  28 passed (28)
      Tests  312 passed (312)" 'Tests |Test Files'
  classify "b2 vitest-fail"         1 " Test Files  1 failed | 27 passed (28)
      Tests  2 failed | 310 passed (312)" 'Tests |Test Files'
  classify "b3 vitest-crash"        1 "failed to load config" 'Tests |Test Files'
  classify "b4 vitest-KILLED"       137 "" 'Tests |Test Files'
  exit 0
fi

cd "$REPO" || exit 1
{
  echo "--- pass-bar verdict rev5 $(stamp) ---"

  # Each gate: assign output, capture rc on the very next line, nothing in between.
  o=$(npx eslint . 2>&1); rc=$?
  classify "eslint" "$rc" "$o"

  o=$(npx vitest run 2>&1); rc=$?
  classify "vitest" "$rc" "$o" 'Tests |Test Files'

  o=$(npm run build 2>&1); rc=$?
  classify "npm run build" "$rc" "$o" 'built in|dist/'

  # rev4 printed the literal "12/12 pass" on rc=0 without reading the count. Read it.
  o=$(node tests/mistake-count.mjs 2>&1); rc=$?
  classify "mistake-count" "$rc" "$o" '[0-9]+/[0-9]+|ok |FAIL'
} >> "$LOG" 2>&1
echo "[$(stamp)] verdict5 done -> $LOG" >> "$LOG"

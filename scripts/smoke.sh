#!/usr/bin/env bash
# Live regression check for the conversation and its tools.
#
# Each case speaks one turn through the probe, then checks the events it
# recorded. A case fails if the probe does not close normally or an expected
# tool call never fires. A tool that is expected but not yet registered in
# src/tools/definitions.ts is reported as PENDING instead of failing, so the
# check stays usable while the Phase 1 tools are still being built.
#
# Needs BOSON_API_KEY (see .env.example) and makes real API calls.
# Usage: bash scripts/smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."

CAPTURES=captures
FIXTURES=test/fixtures
mkdir -p "$CAPTURES" "$FIXTURES"

# name | spoken utterance | tools that must fire (comma-separated, may be empty)
CASES=(
  "english|Hi! Can you check my sentence? I went to the shop yesterday.|"
  "mandarin|我想练习中文。你觉得我的发音怎么样？|"
  "mixed|我想说 hello, how do you say 谢谢 in English?|save_phrase"
  "tone|我的声调对吗？mā 和 mǎ，我说得对吗？|pronunciation_feedback"
)

# Probe output for these cases is kept as fixtures for offline tests.
FIXTURE_CASES=(mandarin mixed)

is_registered() {
  grep -q "name: \"$1\"" src/tools/definitions.ts
}

is_fixture_case() {
  local c
  for c in "${FIXTURE_CASES[@]}"; do
    [ "$c" = "$1" ] && return 0
  done
  return 1
}

# Prints each tool the model called, one per line. The probe records a call
# as response.function_call_arguments.done; response.done does not list it.
tool_calls() {
  node -e '
    const events = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const e of events) {
      if (e.type === "response.function_call_arguments.done") console.log(e.name);
    }
  ' "$1"
}

failures=0

for case in "${CASES[@]}"; do
  IFS='|' read -r name utterance expected <<< "$case"
  out="$CAPTURES/smoke-$name.json"
  log="$CAPTURES/smoke-$name.log"
  echo "== $name: $utterance"

  if ! npm run --silent probe -- --say "$utterance" --out "$out" > "$log" 2>&1; then
    echo "   FAIL: probe did not close normally (see $log)"
    failures=$((failures + 1))
    continue
  fi

  calls="$(tool_calls "$out")"
  case_ok=1
  if [ -n "$expected" ]; then
    IFS=',' read -ra wanted <<< "$expected"
    for tool in "${wanted[@]}"; do
      if ! is_registered "$tool"; then
        echo "   PENDING: $tool is not registered yet"
      elif grep -qx "$tool" <<< "$calls"; then
        echo "   ok: $tool fired"
      else
        echo "   FAIL: $tool did not fire (calls: ${calls:-none})"
        case_ok=0
      fi
    done
  else
    echo "   ok: probe completed (no tool expected)"
  fi

  if [ "$case_ok" = 0 ]; then
    failures=$((failures + 1))
    continue
  fi

  if is_fixture_case "$name"; then
    # Fixtures are committed, so never save one that looks like it holds a key.
    if grep -q "bai-" "$out"; then
      echo "   FAIL: output contains a key-like string; fixture not saved"
      failures=$((failures + 1))
    else
      cp "$out" "$FIXTURES/smoke-$name.json"
      echo "   saved fixture $FIXTURES/smoke-$name.json"
    fi
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "smoke: $failures case(s) failed"
  exit 1
fi
echo "smoke: all cases passed"

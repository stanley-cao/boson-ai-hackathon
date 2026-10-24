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

# name | spoken utterance | required tools | argument field | required substring | forbidden tools | spoken echo
# Use "-" for none. "*" in the forbidden column means no tool may fire.
# "Spoken echo" names an argument of the required tool that the reply after
# the call must put into words, so a tutor that saves a phrase and then only
# says "saved!" still fails (#23). The explain case uses 好久不见 because the
# model heard a synthesised 没关系 as 没关机 ("not switched off").
CASES=(
  "english|Hi! Can you check my sentence? I went to the shop yesterday.|-|-|-|*|-"
  "mandarin|我想练习中文。你觉得我的发音怎么样？|-|-|-|set_practice_language|-"
  "mixed|What does 加油 mean?|save_phrase|phrase|加油|set_practice_language|meaning"
  "explain|I keep hearing people say 好久不见. What does that mean?|save_phrase|phrase|好久不见|set_practice_language|meaning"
  "correction|我有三本狗。|note_correction|-|-|set_practice_language|-"
  "tone|我的声调对吗？mā 和 mǎ，我说得对吗？|pronunciation_feedback|-|-|set_practice_language|-"
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

# Succeeds when at least one call to `tool` has a string argument `field`
# containing `wanted`. Parsing the model's JSON here prevents a malformed call
# from passing merely because it used the expected tool name.
call_argument_contains() {
  node -e '
    const [file, tool, field, wanted] = process.argv.slice(1);
    const events = JSON.parse(require("fs").readFileSync(file, "utf8"));
    const matches = events.some((event) => {
      if (event.type !== "response.function_call_arguments.done" || event.name !== tool) return false;
      try {
        const args = JSON.parse(event.arguments);
        return typeof args[field] === "string" && args[field].includes(wanted);
      } catch {
        return false;
      }
    });
    process.exit(matches ? 0 : 1);
  ' "$1" "$2" "$3" "$4"
}

# Succeeds when the tutor's speech after the first call to `tool` shares a
# word with that call's argument `field`. Shared words rather than an exact
# match because the reply paraphrases: "cheer on, keep going" came back as
# "it means keep going". Words under four letters are skipped so "you" or
# "the" can't pass a reply that never explained anything; if the argument has
# none left, any speech at all passes.
reply_echoes_argument() {
  node -e '
    const [file, tool, field] = process.argv.slice(1);
    const events = JSON.parse(require("fs").readFileSync(file, "utf8"));
    const at = events.findIndex((e) => e.type === "response.function_call_arguments.done" && e.name === tool);
    if (at < 0) process.exit(1);
    let value = "";
    try {
      value = String(JSON.parse(events[at].arguments)[field] ?? "");
    } catch {}
    const said = events
      .slice(at + 1)
      .filter((e) => e.type === "response.output_audio_transcript.done")
      .map((e) => String(e.transcript ?? ""))
      .join(" ")
      .toLowerCase();
    const words = value.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
    const ok = words.length > 0 ? words.some((w) => said.includes(w)) : said.trim() !== "";
    process.exit(ok ? 0 : 1);
  ' "$1" "$2" "$3"
}

failures=0

for case in "${CASES[@]}"; do
  IFS='|' read -r name utterance expected arg_field arg_contains forbidden echo_field <<< "$case"
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
  if [ "$expected" != "-" ]; then
    IFS=',' read -ra wanted <<< "$expected"
    for tool in "${wanted[@]}"; do
      if ! is_registered "$tool"; then
        echo "   PENDING: $tool is not registered yet"
      elif grep -qx "$tool" <<< "$calls"; then
        echo "   ok: $tool fired"
        if [ "$arg_field" != "-" ] && ! call_argument_contains "$out" "$tool" "$arg_field" "$arg_contains"; then
          echo "   FAIL: $tool did not send $arg_field containing '$arg_contains'"
          case_ok=0
        elif [ "$arg_field" != "-" ]; then
          echo "   ok: $tool.$arg_field contains '$arg_contains'"
        fi
        if [ "$echo_field" != "-" ] && ! reply_echoes_argument "$out" "$tool" "$echo_field"; then
          echo "   FAIL: the reply after $tool did not explain its $echo_field"
          case_ok=0
        elif [ "$echo_field" != "-" ]; then
          echo "   ok: the reply after $tool explained its $echo_field"
        fi
      else
        echo "   FAIL: $tool did not fire (calls: ${calls:-none})"
        case_ok=0
      fi
    done
  else
    echo "   ok: probe completed (no tool expected)"
  fi

  if [ "$forbidden" = "*" ] && [ -n "$calls" ]; then
    echo "   FAIL: unexpected tool call(s): $calls"
    case_ok=0
  elif [ "$forbidden" != "-" ]; then
    IFS=',' read -ra blocked <<< "$forbidden"
    for tool in "${blocked[@]}"; do
      if grep -qx "$tool" <<< "$calls"; then
        echo "   FAIL: forbidden tool $tool fired"
        case_ok=0
      else
        echo "   ok: $tool did not fire"
      fi
    done
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

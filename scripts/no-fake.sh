#!/usr/bin/env bash
# Guard (docs/ARCHITECTURE.md section 10, FEATURES Q-005): shipped code carries no fixture, mock, lorem, faker or random content pools.
# Scans src/ and crates/*/src (plus src-tauri/src), skipping test files and inline #[cfg(test)] modules' file names. Exit 1 on a match.
set -u
cd "$(dirname "$0")/.."

roots=(src src-tauri/src)
for d in crates/*/src; do roots+=("$d"); done

# Test code is exempt: *.test.*, __tests__, tests/, and e2e/.
excl=(--exclude='*.test.ts' --exclude='*.test.tsx' --exclude='*.spec.ts' --exclude-dir=__tests__ --exclude-dir=tests --exclude-dir=node_modules)

fail=0
check() {
  local label="$1" pattern="$2" flags="${3:--rnIiE}"
  local out
  out=$(grep "$flags" "${excl[@]}" -- "$pattern" "${roots[@]}" 2>/dev/null | grep -vE 'no-fake: allow' || true)
  if [ -n "$out" ]; then
    echo "no-fake: $label"
    echo "$out" | head -40
    fail=1
  fi
}

check "fixture data" 'fixtureRepository|fixture[A-Z_]|[a-z]Fixture\b|\bfixtures?\b'
check "mock data" '\bmock(s|ed|ing)?[A-Z_(]|\bmock(s|ed|ing)?\b'
check "lorem ipsum" 'lorem|ipsum dolor'
check "faker" 'faker|@faker-js|chance\.js'
check "demo or sample people" 'demo (user|space|data)|sample (user|data|space)|seed(ed)? (users|people|data)'
# Content chosen at random from a built-in list (names, quotes, messages): Math.random()*list.length or pick-from-array.
# Case sensitive: scene code legitimately has 'spool' and material pools.
check "random content pools" '\b(NAME|MESSAGE|QUOTE|TEXT)S?_POOL\b|RANDOM_(NAMES|MESSAGES|QUOTES|TEXTS)|pick\((NAMES|MESSAGES|QUOTES|WORDS)\)|\[Math\.floor\(Math\.random\(\) *\* *[A-Za-z_.]+\.length\)\]' -rnIE

if [ "$fail" -ne 0 ]; then
  echo "no-fake: failed. Shipped paths must not contain fake content (annotate a deliberate exception with 'no-fake: allow')."
  exit 1
fi
echo "no-fake: ok"

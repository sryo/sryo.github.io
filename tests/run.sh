#!/usr/bin/env bash
# Test runner for build.sh.
# Runs the build inside tests/fixtures, diffs the output against
# tests/expected/works.html, and runs a handful of sentinel greps.
#
# Usage:
#   bash tests/run.sh            # verify
#   bash tests/run.sh --update   # regenerate tests/expected/works.html after intentional changes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixtures"
EXPECTED="$SCRIPT_DIR/expected/works.html"
MODE="${1:-verify}"

pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; exit 1; }

# Strict sentinel: literal substring match; fails loudly on miss.
sentinel() {
    local desc=$1
    local pattern=$2
    if grep -qF "$pattern" "$ACTUAL"; then
        pass "$desc"
    else
        fail "$desc — pattern not found: $pattern"
    fi
}

# Build into the fixture dir (build.sh resolves paths relative to CWD).
(cd "$FIXTURE_DIR" && bash "$REPO_DIR/build.sh" >/dev/null)
ACTUAL="$FIXTURE_DIR/works.html"
[ -f "$ACTUAL" ] || fail "build did not produce works.html"

if [ "$MODE" = "--update" ]; then
    cp "$ACTUAL" "$EXPECTED"
    pass "regenerated $EXPECTED"
    exit 0
fi

[ -f "$EXPECTED" ] || fail "$EXPECTED missing — run with --update to create"

echo "Diff against expected/works.html..."
if diff -u "$EXPECTED" "$ACTUAL" > /dev/null; then
    pass "output matches expected"
else
    diff -u "$EXPECTED" "$ACTUAL" | head -60
    fail "output differs from expected (re-run with --update if intentional)"
fi

echo "Sentinel checks..."
sentinel "METRICS value rendered"   '<span class="metric-value">15%</span>'
sentinel "METRICS label rendered"   '<span class="metric-label">reduction in churn</span>'
sentinel "date formatted"           '<time datetime="2024-03-01">March 2024</time>'
sentinel "SVG inlined as base64"    'data:image/svg+xml;base64,'
sentinel "tag rendered"             '<span class="tag">design</span>'
sentinel "gallery container"        '<div class="gallery"'
sentinel "EMBED passthrough"        '<iframe src="https://example.com/embed">'
sentinel "code block opened"        '<pre><code>'
sentinel "code block escapes &/</>" 'echo "hello &amp; &lt;world&gt;"'
sentinel "bold rendered"            '<strong>bold</strong>'
sentinel "italic rendered"          '<em>italic</em>'
sentinel "inline code rendered"     '<code>inline code</code>'
sentinel "link rendered"            '<a href="https://example.com">link</a>'
sentinel "title attr escaped"       'title="First &amp; &lt;Special&gt;"'
sentinel "h1 escaped"               'First &amp; &lt;Special&gt;</h1>'
sentinel "stray --- preserved"      'A paragraph after the divider should still render.'

# Gallery ordering: proj-a (2024-08-01) must appear before proj-b (2024-05-01).
pos_a=$(grep -n '<h3>Project A</h3>' "$ACTUAL" | head -n 1 | cut -d: -f1)
pos_b=$(grep -n '<h3>Project B</h3>' "$ACTUAL" | head -n 1 | cut -d: -f1)
if [ -n "$pos_a" ] && [ -n "$pos_b" ] && [ "$pos_a" -lt "$pos_b" ]; then
    pass "gallery sorted date desc (A before B)"
else
    fail "gallery sort: A=$pos_a B=$pos_b"
fi

# Section ordering: 01 (order:1) before 02 (order:2) before 03 (order:3) before 04 (no order, default last).
pos_first=$(grep -n 'First &amp; &lt;Special&gt;</h1>' "$ACTUAL" | head -n 1 | cut -d: -f1)
pos_fourth=$(grep -n '>Fourth Section</h1>' "$ACTUAL" | head -n 1 | cut -d: -f1)
if [ -n "$pos_first" ] && [ -n "$pos_fourth" ] && [ "$pos_first" -lt "$pos_fourth" ]; then
    pass "sections sorted by order (1 before 4)"
else
    fail "section sort: first=$pos_first fourth=$pos_fourth"
fi

echo "All checks passed."

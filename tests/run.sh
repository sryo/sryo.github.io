#!/usr/bin/env bash
# Test runner for build.sh.
# Runs the build inside tests/fixtures, runs sentinel greps against
# works.html and the case pages, then diffs everything against
# tests/expected/works.html and tests/expected/work/.
#
# Usage:
#   bash tests/run.sh            # verify
#   bash tests/run.sh --update   # regenerate tests/expected/ after intentional changes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixtures"
EXPECTED_DIR="$SCRIPT_DIR/expected"
EXPECTED="$EXPECTED_DIR/works.html"
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

# Same, against a named output file (relative to the fixture dir).
sentinel_in() {
    local file=$1 desc=$2 pattern=$3
    [ -f "$FIXTURE_DIR/$file" ] || fail "$desc — $file missing"
    if grep -qF "$pattern" "$FIXTURE_DIR/$file"; then
        pass "$desc ($file)"
    else
        fail "$desc — pattern not found in $file: $pattern"
    fi
}

# Negative sentinel: the pattern must not appear in the file.
absent_in() {
    local file=$1 desc=$2 pattern=$3
    if grep -qF "$pattern" "$FIXTURE_DIR/$file"; then
        fail "$desc — found in $file: $pattern"
    else
        pass "$desc ($file)"
    fi
}

# A stale page from a deleted section; the build must remove it.
mkdir -p "$FIXTURE_DIR/work/ghost"
echo stale > "$FIXTURE_DIR/work/ghost/index.html"

# Build into the fixture dir (build.sh resolves paths relative to CWD).
(cd "$FIXTURE_DIR" && bash "$REPO_DIR/build.sh" >/dev/null)
ACTUAL="$FIXTURE_DIR/works.html"
[ -f "$ACTUAL" ] || fail "build did not produce works.html"

if [ "$MODE" = "--update" ]; then
    cp "$ACTUAL" "$EXPECTED"
    rm -rf "$EXPECTED_DIR/work"
    cp -R "$FIXTURE_DIR/work" "$EXPECTED_DIR/work"
    pass "regenerated $EXPECTED and $EXPECTED_DIR/work/"
    exit 0
fi

[ -f "$EXPECTED" ] || fail "$EXPECTED missing — run with --update to create"

echo "Case pages..."
for slug in 01-tags 02-gallery 03-metrics 04-noorder; do
    [ -f "$FIXTURE_DIR/work/$slug/index.html" ] || fail "missing work/$slug/index.html"
    pass "work/$slug/index.html written"
done
[ ! -e "$FIXTURE_DIR/work/ghost" ] || fail "stale work/ghost/ survived the rebuild"
pass "stale work/ghost/ removed"

echo "Slug validation..."
# Copy the fixture into a scratch dir, let the caller break it, and
# expect the build to exit non-zero with a message naming the problem.
build_must_fail() {
    local desc=$1 expect=$2 setup=$3 tmp out
    tmp=$(mktemp -d)
    cp -R "$FIXTURE_DIR/." "$tmp/"
    rm -rf "$tmp/work" "$tmp/works.html"
    (cd "$tmp" && eval "$setup")
    if out=$(cd "$tmp" && bash "$REPO_DIR/build.sh" 2>&1); then
        rm -rf "$tmp"
        fail "$desc — build succeeded"
    fi
    rm -rf "$tmp"
    case "$out" in
        *"$expect"*) pass "$desc" ;;
        *) fail "$desc — output lacks '$expect': $out" ;;
    esac
}
build_must_fail "folder 'Bad Slug' rejected" "Invalid slug" \
    'mkdir "contents/Bad Slug" && cp contents/04-noorder/_.md "contents/Bad Slug/_.md"'
build_must_fail "duplicate slug rejected" "duplicate slug" \
    'mkdir contents/02-gallery/items/01-tags && cp contents/02-gallery/items/proj-a/_.md contents/02-gallery/items/01-tags/_.md'

echo "Sentinel checks..."
# works.html is the ledger: no ring, no dialogs, no connectors.
sentinel_in works.html "SVG glyph inlined as base64" 'data:image/svg+xml;base64,'
absent_in   works.html "no checkbox buttons"         'type="checkbox"'
absent_in   works.html "no ring"                     'class="clock"'
absent_in   works.html "no connector svg"            'lineContainer'
absent_in   works.html "no dialog galleries"         'class="gallery"'

# Bodies render on their own case pages.
sentinel_in work/03-metrics/index.html "METRICS value rendered"   '<span class="metric-value">15%</span>'
sentinel_in work/03-metrics/index.html "METRICS label rendered"   '<span class="metric-label">reduction in churn</span>'
sentinel_in work/01-tags/index.html    "date formatted"           '<time datetime="2024-03-01">March 2024</time>'
sentinel_in work/03-metrics/index.html "EMBED passthrough"        '<iframe src="https://example.com/embed">'
sentinel_in work/03-metrics/index.html "code block opened"        '<pre><code>'
sentinel_in work/03-metrics/index.html "code block escapes &/</>" 'echo "hello &amp; &lt;world&gt;"'
sentinel_in work/01-tags/index.html    "bold rendered"            '<strong>bold</strong>'
sentinel_in work/01-tags/index.html    "italic rendered"          '<em>italic</em>'
sentinel_in work/01-tags/index.html    "inline code rendered"     '<code>inline code</code>'
sentinel_in work/01-tags/index.html    "link rendered"            '<a href="https://example.com">link</a>'
sentinel_in works.html                 "row name escaped"         '<span class="name">First &amp; &lt;Special&gt;</span>'
sentinel_in work/01-tags/index.html    "h1 escaped"               'First &amp; &lt;Special&gt;</h1>'
sentinel_in work/03-metrics/index.html "stray --- preserved"      'A paragraph after the divider should still render.'
sentinel_in work/02-gallery/index.html "item SVG inlined"         'data:image/svg+xml;base64,'

# Items on a case page: proj-a (2024-08-01) before proj-b (2024-05-01).
GALLERY="$FIXTURE_DIR/work/02-gallery/index.html"
pos_a=$(grep -n '<h3>Project A</h3>' "$GALLERY" | head -n 1 | cut -d: -f1 || true)
pos_b=$(grep -n '<h3>Project B</h3>' "$GALLERY" | head -n 1 | cut -d: -f1 || true)
if [ -n "$pos_a" ] && [ -n "$pos_b" ] && [ "$pos_a" -lt "$pos_b" ]; then
    pass "items sorted date desc (A before B)"
else
    fail "item sort: A=$pos_a B=$pos_b"
fi

# Ledger order: one sorted list, date descending, slug breaks ties.
rows=$(grep -o 'class="row" href="work/[^"]*/"' "$ACTUAL" | sed -e 's|.*href="work/||' -e 's|/"$||' | tr '\n' ' ' || true)
want="01-tags 03-metrics 02-gallery 04-noorder 05-twin-a 05-twin-b "
if [ "$rows" = "$want" ]; then
    pass "rows sorted by date desc, then slug"
else
    fail "row order: got '$rows', want '$want'"
fi

echo "Diff against expected/..."
if diff -u "$EXPECTED" "$ACTUAL" > /dev/null; then
    pass "works.html matches expected"
else
    diff -u "$EXPECTED" "$ACTUAL" | head -60
    fail "works.html differs from expected (re-run with --update if intentional)"
fi
[ -d "$EXPECTED_DIR/work" ] || fail "$EXPECTED_DIR/work missing — run with --update to create"
if diff -r -u "$EXPECTED_DIR/work" "$FIXTURE_DIR/work" > /dev/null; then
    pass "work/ matches expected"
else
    diff -r -u "$EXPECTED_DIR/work" "$FIXTURE_DIR/work" | head -60
    fail "work/ differs from expected (re-run with --update if intentional)"
fi

echo "All checks passed."

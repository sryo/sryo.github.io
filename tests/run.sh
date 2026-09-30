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
sentinel_in work/01-tags/index.html    "h1 escaped"               'First &amp; &lt;Special&gt;</h1>'
sentinel_in work/03-metrics/index.html "stray --- preserved"      'A paragraph after the divider should still render.'
sentinel_in work/02-gallery/index.html "item SVG inlined"         'data:image/svg+xml;base64,'

# Page head: canonical and OG built from SITE_URL, title escaped.
P=work/01-tags/index.html
sentinel_in $P "canonical URL"   '<link rel="canonical" href="https://example.test/work/01-tags/">'
sentinel_in $P "og:url"          '<meta property="og:url" content="https://example.test/work/01-tags/">'
sentinel_in $P "og:image"        '<meta property="og:image" content="https://example.test/og.png">'
sentinel_in $P "title escaped"   '<title>First &amp; &lt;Special&gt; / Test Author</title>'
sentinel_in $P "og:title escaped" '<meta property="og:title" content="First &amp; &lt;Special&gt;">'
sentinel_in $P "styles inlined"  '/* test stub */'
sentinel_in works.html "ledger canonical" '<link rel="canonical" href="https://example.test/works.html">'

# Prev/next follow the ledger order and don't wrap.
sentinel_in work/03-metrics/index.html "rel=prev to newer neighbour" 'rel="prev" href="../01-tags/"'
sentinel_in work/03-metrics/index.html "rel=next to older neighbour" 'rel="next" href="../04-noorder/"'
sentinel_in work/03-metrics/index.html "back link to its row"        'href="../../works.html#03-metrics"'
absent_in   work/01-tags/index.html    "first page has no prev"      'rel="prev"'
absent_in   work/05-twin-b/index.html  "last page has no next"       'rel="next"'

# Page mode: comments dropped, metrics escaped and lifted into a figures
# band, parts left empty by that are skipped, content paths rebased.
if grep -rqF "secret note" "$FIXTURE_DIR/works.html" "$FIXTURE_DIR/work"; then
    fail "HTML comment leaked into output"
else
    pass "HTML comments stripped from every output"
fi
P=work/04-noorder/index.html
sentinel_in $P "metric value escaped"      '<span class="metric-value">&lt;5 min</span>'
sentinel_in $P "figures band"              '<section class="figures"'
absent_in   $P "empty Results part skipped" '<h2 class="label">Results</h2>'
sentinel_in $P "content src rebased"       'src="../../contents/04-noorder/figure.png"'
sentinel_in work/01-tags/index.html "h2 hangs as a part label" '<section class="part"><h2 class="label">Overview</h2><div class="body">'

# Case header: a spec column (glyph + dl) beside the h1 and the dek.
P=work/01-tags/index.html
sentinel_in $P "spec column holds the glyph" '<aside class="spec"><span class="glyph">'
sentinel_in $P "summary is the dek"          '<p class="dek">Tags &amp; &lt;escapes&gt; in one line</p>'
sentinel_in $P "spec lists the client"       '<dt>Client</dt><dd>Tags &amp; &lt;Co&gt;</dd>'
sentinel_in $P "spec lists the role"         '<dt>Role</dt><dd>Designer &amp; writer</dd>'
sentinel_in $P "spec lists the scope"        '<dt>Scope</dt><dd>design, ux, web</dd>'
P=work/03-metrics/index.html
sentinel_in $P "lead link hoisted into spec" '<dt>Link</dt><dd><a href="https://example.com/project">Project Link</a></dd>'
absent_in   $P "hoisted link not in body"    '<p><a href="https://example.com/project">'

# kind: profile: no client row, an About page, the ledger header, and
# its items as the side-project group.
P=work/02-gallery/index.html
absent_in   works.html "profile has no client row"     'class="row" href="work/02-gallery/"'
sentinel_in works.html "ledger header: profile lead"   'I make fixtures. Usually that means breaking things on purpose.'
sentinel_in works.html "ledger header: availability"   "Ten years in. Open to what's next."
sentinel_in works.html "ledger header: About link"     'href="work/02-gallery/"'
sentinel_in works.html "ledger header: year span"      'Work, 2021&ndash;2024'
sentinel_in works.html "client group"                  '<h2 id="g-client">Client work</h2>'
sentinel_in works.html "side group"                    '<h2 id="g-side">Side projects</h2>'
sentinel_in works.html "side row to its About section" 'class="row" href="work/02-gallery/#proj-a"'
sentinel_in $P "About page keeps the full body"        "Open to what's next."
sentinel_in $P "About page anchors each item"          'id="proj-a"'
absent_in   $P "About page has no pager"               'rel="next"'

# Side rows (and About sections): proj-a (2024-08-01) before proj-b (2024-05-01).
pos_a=$(grep -n 'href="work/02-gallery/#proj-a"' "$ACTUAL" | head -n 1 | cut -d: -f1 || true)
pos_b=$(grep -n 'href="work/02-gallery/#proj-b"' "$ACTUAL" | head -n 1 | cut -d: -f1 || true)
if [ -n "$pos_a" ] && [ -n "$pos_b" ] && [ "$pos_a" -lt "$pos_b" ]; then
    pass "side rows sorted date desc (A before B)"
else
    fail "side row sort: A=$pos_a B=$pos_b"
fi
GALLERY="$FIXTURE_DIR/$P"
pos_a=$(grep -n '<h3>Project A</h3>' "$GALLERY" | head -n 1 | cut -d: -f1 || true)
pos_b=$(grep -n '<h3>Project B</h3>' "$GALLERY" | head -n 1 | cut -d: -f1 || true)
if [ -n "$pos_a" ] && [ -n "$pos_b" ] && [ "$pos_a" -lt "$pos_b" ]; then
    pass "About items sorted date desc (A before B)"
else
    fail "About item sort: A=$pos_a B=$pos_b"
fi

# Ledger order: one sorted list, date descending, slug breaks ties.
rows=$(grep -o 'class="row" href="work/[^"]*/"' "$ACTUAL" | sed -e 's|.*href="work/||' -e 's|/"$||' | tr '\n' ' ' || true)
want="01-tags 03-metrics 04-noorder 05-twin-a 05-twin-b "
if [ "$rows" = "$want" ]; then
    pass "rows sorted by date desc, then slug"
else
    fail "row order: got '$rows', want '$want'"
fi

echo "Case fields..."
build_must_fail "case without role: fails" "Missing role" \
    'grep -v "^role:" contents/01-tags/_.md > x && mv x contents/01-tags/_.md'
build_must_fail "case without label: fails" "Missing label" \
    'grep -v "^label:" contents/01-tags/_.md > x && mv x contents/01-tags/_.md'
build_must_fail "case without summary: fails" "Missing summary" \
    'grep -v "^summary:" contents/01-tags/_.md > x && mv x contents/01-tags/_.md'
SUMMARY='Tags &amp; &lt;escapes&gt; in one line'
sentinel_in works.html "summary is the ledger line"   "<span class=\"line\">$SUMMARY</span>"
sentinel_in works.html "label is the ledger name, escaped" '<span class="name">Tags &amp; &lt;Co&gt;</span>'
sentinel_in works.html "role is the last column"      '<span class="role">Designer &amp; writer</span>'
sentinel_in work/01-tags/index.html "summary is the meta description" "<meta name=\"description\" content=\"$SUMMARY\">"
sentinel_in work/01-tags/index.html "summary is og:description"       "<meta property=\"og:description\" content=\"$SUMMARY\">"

echo "Diff against expected/..."
if diff -u "$EXPECTED" "$ACTUAL" > /dev/null; then
    pass "works.html matches expected"
else
    diff -u "$EXPECTED" "$ACTUAL" | head -60 || true
    fail "works.html differs from expected (re-run with --update if intentional)"
fi
[ -d "$EXPECTED_DIR/work" ] || fail "$EXPECTED_DIR/work missing — run with --update to create"
if diff -r -u "$EXPECTED_DIR/work" "$FIXTURE_DIR/work" > /dev/null; then
    pass "work/ matches expected"
else
    diff -r -u "$EXPECTED_DIR/work" "$FIXTURE_DIR/work" | head -60 || true
    fail "work/ differs from expected (re-run with --update if intentional)"
fi

echo "All checks passed."

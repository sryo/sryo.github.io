#!/usr/bin/env bash
# Test runner for build.sh.
# Runs the build inside tests/fixtures, runs sentinel greps against
# works.html and the case pages, then diffs everything against
# tests/expected/works.html and tests/expected/work/.
#
# Usage:
#   bash tests/run.sh            # verify
#   bash tests/run.sh --update   # regenerate tests/expected/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixtures"
EXPECTED_DIR="$SCRIPT_DIR/expected"
EXPECTED="$EXPECTED_DIR/works.html"
MODE="${1:-verify}"

pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; exit 1; }

# Literal substring match in works.html.
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
# Keep stderr: warnings are part of the contract.
BUILD_ERR=$(cd "$FIXTURE_DIR" && bash "$REPO_DIR/build.sh" 2>&1 >/dev/null)
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
for slug in 01-tags 02-gallery 03-metrics 04-noorder proj-a proj-b proj-c; do
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

# Like build_must_fail, but the build must succeed and warn on stderr.
build_warns() {
    local desc=$1 expect=$2 setup=$3 tmp out
    tmp=$(mktemp -d)
    cp -R "$FIXTURE_DIR/." "$tmp/"
    rm -rf "$tmp/work" "$tmp/works.html"
    (cd "$tmp" && eval "$setup")
    if ! out=$(cd "$tmp" && bash "$REPO_DIR/build.sh" 2>&1 >/dev/null); then
        rm -rf "$tmp"
        fail "$desc — build failed: $out"
    fi
    rm -rf "$tmp"
    case "$out" in
        *"$expect"*) pass "$desc" ;;
        *) fail "$desc — stderr lacks '$expect': $out" ;;
    esac
}
A=contents/02-gallery/items/proj-a
build_warns "screen over 250KB flagged" "warn: $A/_.md: screen-1.png is over 250KB" \
    "head -c 260000 /dev/zero >> $A/screen-1.png"
build_warns "more than 3 screens flagged" "warn: $A/_.md: more than 3 screens" \
    "printf '![Four](screen-1.png)\\n' >> $A/_.md"
build_warns "screen without alt flagged" "warn: $A/_.md: image without alt" \
    "printf '\\n![](screen-2.png)\\n' >> $A/_.md && sed -i.bak '/shot.jpg/d' $A/_.md"

build_warns "missing diagram flagged" "warn: $A/_.md: diagram nope.svg not found" \
    "sed -i.bak 's/DIAGRAM: diagram.svg/DIAGRAM: nope.svg/' $A/_.md"
build_warns "diagram without caption flagged" "warn: $A/_.md: diagram without caption" \
    "sed -i.bak 's/^DIAGRAM: diagram.svg.*/DIAGRAM: diagram.svg/' $A/_.md"
build_warns "off-spec diagram flagged" "warn: $A/_.md: diagram.svg off-spec (fill #f00)" \
    "sed -i.bak 's/fill=\"currentColor\"/fill=\"#f00\"/' $A/diagram.svg"
build_warns "diagram with <style> flagged" "warn: $A/_.md: diagram.svg off-spec (<style)" \
    "sed -i.bak 's|<defs>|<style>text{}</style><defs>|' $A/diagram.svg"

warned() {
    local desc=$1 pattern=$2
    case "$BUILD_ERR" in
        *"$pattern"*) pass "$desc" ;;
        *) fail "$desc — stderr lacks '$pattern': $BUILD_ERR" ;;
    esac
}
warned "off-system glyph flagged" 'warn: proj-b glyph off-system'
case "$BUILD_ERR" in
    *"proj-a glyph off-system"*|*"01-tags glyph off-system"*) fail "black glyphs flagged as off-system" ;;
    *) pass "black glyphs pass the glyph check" ;;
esac
case "$BUILD_ERR" in
    *"proj-c glyph off-system"*) fail "glyph: colour flagged as off-system" ;;
    *) pass "glyph: colour is exempt from the glyph check" ;;
esac

echo "Sentinel checks..."
sentinel_in work/02-gallery/index.html "SVG glyph inlined as base64" 'data:image/svg+xml;base64,'
absent_in   works.html "no checkbox buttons"         'type="checkbox"'
absent_in   works.html "no ring"                     'class="clock"'
absent_in   works.html "no connector svg"            'lineContainer'
absent_in   works.html "no dialog galleries"         'class="gallery"'

# Bodies render on their own case pages.
sentinel_in work/03-metrics/index.html "METRICS value rendered"   '<span class="metric-value">15%</span>'
sentinel_in work/03-metrics/index.html "METRICS label rendered"   '<span class="metric-label">reduction in churn</span>'
absent_in   work/03-metrics/index.html "non-quantity not a stat"  '<span class="metric-value">Catalog + tasking</span>'
sentinel_in work/03-metrics/index.html "non-quantity listed"      '<li>Catalog + tasking — dual capture flow</li>'
sentinel_in work/01-tags/index.html    "Year row shows the year"  '<dt>Year</dt><dd><time datetime="2024">2024</time></dd>'
sentinel_in work/03-metrics/index.html "EMBED passthrough"        '<iframe src="https://example.com/embed">'
absent_in   work/03-metrics/index.html "ID-less YouTube embed dropped" 'youtube.googleapis.com/embed/?'
sentinel_in work/03-metrics/index.html "code block opened"        '<pre><code>'
sentinel_in work/03-metrics/index.html "code block escapes &/</>" 'echo "hello &amp; &lt;world&gt;"'
sentinel_in work/01-tags/index.html    "bold rendered"            '<strong>bold</strong>'
sentinel_in work/01-tags/index.html    "italic rendered"          '<em>italic</em>'
sentinel_in work/01-tags/index.html    "inline code rendered"     '<code>inline code</code>'
sentinel_in work/01-tags/index.html    "link rendered"            '<a href="https://example.com">link</a>'
sentinel_in work/01-tags/index.html    "h1 escaped"               'First &amp; &lt;Special&gt;</h1>'
sentinel_in work/03-metrics/index.html "stray --- preserved"      'A paragraph after the divider should still render.'
sentinel_in work/02-gallery/index.html "item SVG inlined"         'data:image/svg+xml;base64,'
absent_in   work/proj-a/index.html "no eager figma iframe"        '<iframe src="https://embed.figma.com'
sentinel_in work/proj-a/index.html "figma facade link"            'class="embed-facade" href="https://embed.figma.com/design/x"'

# Page head: canonical and OG built from SITE_URL, title escaped.
P=work/01-tags/index.html
sentinel_in $P "canonical URL"   '<link rel="canonical" href="https://example.test/work/01-tags/">'
sentinel_in $P "og:url"          '<meta property="og:url" content="https://example.test/work/01-tags/">'
sentinel_in $P "og:image"        '<meta property="og:image" content="https://example.test/og.png">'
sentinel_in $P "title escaped"   '<title>First &amp; &lt;Special&gt; / Test Author</title>'
sentinel_in $P "og:title escaped" '<meta property="og:title" content="First &amp; &lt;Special&gt;">'
sentinel_in $P "styles inlined"  '.test-stub{}'
sentinel_in $P "script inlined on case pages" '/* script stub */'
sentinel_in works.html "script inlined on the ledger" '/* script stub */'
sentinel_in $P "og:image:alt is the page title" '<meta property="og:image:alt" content="First &amp; &lt;Special&gt;">'
sentinel_in $P "twitter:image"   '<meta name="twitter:image" content="https://example.test/og.png">'
sentinel_in works.html "ledger og:description is the front headline" '<meta property="og:description" content="Test Author, fixture designer &amp; lead. Ten years, most of them leading.">'
sentinel_in work/02-gallery/index.html "About description is its lead" '<meta name="description" content="I make fixtures. Usually that means breaking things on purpose.">'
sentinel_in works.html "ledger canonical" '<link rel="canonical" href="https://example.test/works.html">'

# Prev/next follow the ledger order and don't wrap.
sentinel_in work/03-metrics/index.html "rel=prev to newer neighbour" 'rel="prev" href="../01-tags/"'
sentinel_in work/03-metrics/index.html "rel=next to older neighbour" 'rel="next" href="../04-noorder/"'
sentinel_in work/03-metrics/index.html "back link to its row"        'href="../../works.html#03-metrics"'
sentinel_in work/03-metrics/index.html "pager shows the target's ledger line" '<span class="pn-name">Tags &amp; &lt;Co&gt;</span> <span class="pn-line">Tags &amp; &lt;escapes&gt; in one line</span>'
sentinel_in work/01-tags/index.html    "first page leads back to All work" '<a class="pn-all" href="../../works.html#01-tags">'
sentinel_in work/05-twin-b/index.html  "last page leads back to All work"  '<a class="pn-all pn-end" href="../../works.html#05-twin-b">'
absent_in   work/01-tags/index.html    "no empty pager slot"         '<span></span>'
sentinel_in work/01-tags/index.html    "skip link on case pages"     '<a class="skip" href="#main-content">Skip to content</a>'
sentinel_in works.html                 "skip link on the ledger"     '<a class="skip" href="#main-content">Skip to content</a>'
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
absent_in   $P "empty Results part skipped" '<h2>Results</h2>'
sentinel_in $P "content src rebased"       'src="../../contents/04-noorder/figure.png"'
sentinel_in $P "CTA line becomes the closing row" "<p class=\"case-cta\">Need fixtures? <a href=\"https://www.linkedin.com/in/test\" aria-label=\"Let's talk on LinkedIn\">Let's talk</a>.</p>"
absent_in   $P "CTA line not left in the body"   '<p>Need fixtures?'
absent_in   $P "Results holding only a CTA skipped" '<h2>Results</h2>'
sentinel_in work/01-tags/index.html "h2 hangs as a part heading" '<section class="part"><h2>Overview</h2><div class="body">'
absent_in   work/01-tags/index.html "no caps label class on case pages" 'class="label"'
sentinel_in work/01-tags/index.html "back link is plain"  '<nav class="mast"><a class="back" href="../../works.html#01-tags">&larr; All work</a></nav>'

# Case header: a spec column (glyph + dl) beside the h1 and the dek.
P=work/01-tags/index.html
sentinel_in $P "spec column holds the glyph" '<aside class="spec"><span class="glyph" '
# _.parts.svg rides on the spec glyph only.
sentinel_in $P "spec glyph carries its parts" ' data-parts="PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMCAxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiLz48L3N2Zz4K"><img'
# On works.html only the front page's glyph sources carry parts, not the rows.
if grep -qE '<span class="glyph[^>]*data-parts=' "$ACTUAL"; then fail "ledger glyphs carry parts"; else pass "ledger glyphs carry no parts"; fi
absent_in work/proj-a/index.html "no parts without a sidecar" 'data-parts='
sentinel_in $P "summary is the dek"          '<p class="dek">Tags &amp; &lt;escapes&gt; in one line</p>'
sentinel_in $P "spec lists the client"       '<dt>Client</dt><dd>Tags &amp; &lt;Co&gt;</dd>'
sentinel_in $P "spec lists the role"         '<dt>Role</dt><dd>Designer &amp; writer</dd>'
sentinel_in $P "spec lists the scope"        '<dt>Scope</dt><dd>design, ux, web</dd>'
P=work/03-metrics/index.html
sentinel_in $P "lead link hoisted into spec" '<dt>Link</dt><dd><a href="https://example.com/project">Project Link (demo)</a></dd>'
absent_in   $P "hoisted link not in body"    '<p><a href="https://example.com/project">'

# glyph: colour keeps an original colour glyph, marked so dark mode skips the invert.
sentinel_in work/proj-c/index.html "colour glyph marked" '<span class="glyph colour" style="view-transition-name: g-proj-c"><img'

# No glyph: a typographic initial of the label takes its place.
sentinel_in works.html "row initial for a missing glyph" '<span class="name">Third</span>'
sentinel_in works.html "initial in the glyph cell"      '<span class="glyph initial" style="view-transition-name: g-03-metrics" aria-hidden="true">T</span><span class="name">Third</span>'
sentinel_in work/03-metrics/index.html "spec initial"   '<aside class="spec"><span class="glyph initial" style="view-transition-name: g-03-metrics" aria-hidden="true">T</span>'

# View transition: the row's glyph and the case page's glyph share a name.
sentinel_in works.html              "Also glyph named for the transition" '<svg viewBox="0 0 10 10" style="view-transition-name: g-01-tags">'
sentinel_in work/01-tags/index.html "spec glyph shares the name"          '<aside class="spec"><span class="glyph" style="view-transition-name: g-01-tags"'
absent_in   works.html              "no side rows on works.html"          'view-transition-name: g-proj-a">'
sentinel_in work/proj-a/index.html  "side spec glyph shares the name"     '<aside class="spec"><span class="glyph" style="view-transition-name: g-proj-a">'

# kind: profile: no client row, an About page, and its items as side projects.
P=work/02-gallery/index.html
absent_in   works.html "profile has no client row"     'class="row" href="work/02-gallery/"'
absent_in   works.html "front.md replaces the profile lead" 'I make fixtures. Usually that means breaking things on purpose.</h1>'
absent_in   works.html "front.md replaces the profile availability" "Ten years in. Open to what's next."
sentinel_in works.html "ledger header: About link"     'href="work/02-gallery/"'
sentinel_in works.html "masthead LinkedIn"             'href="https://linkedin.com/in/test"'
sentinel_in works.html "masthead GitHub"               'href="https://github.com/test"'
sentinel_in works.html "closing footer"                '<footer class="sig" aria-labelledby="sig-ask">'
absent_in   works.html "no email without one on file"  'mailto:'
# No masthead, counts, column header or caps labels on works.html.
absent_in   works.html "no masthead"                   '<p class="mast">'
absent_in   works.html "no item counts"                'class="count"'
absent_in   works.html "no column header row"          '<div class="cols"'
absent_in   works.html "no caps label class"           'class="label"'
sentinel_in works.html "client group"                  '<h2 id="g-client">Client work</h2>'
absent_in   works.html "no side-project group"       'id="g-side"'
absent_in   works.html "no side row on works.html"   'class="row" href="work/proj-a/"'
absent_in   works.html "side row no longer leaves the site" 'class="row" href="https://example.com/a"'
sentinel_in $P "About item names link to its page"     '<h3><a href="../proj-a/">Project A</a></h3>'
sentinel_in $P "About item keeps its one line"         '<p class="item-line">Project A in one line</p>'
absent_in   $P "About item bodies stay on their pages" 'class="embed-facade"'
sentinel_in $P "About page keeps the full body"        "Open to what's next."
sentinel_in $P "About page anchors each item"          'id="proj-a"'
absent_in   $P "About page has no pager"               'rel="next"'

# Side-project pages: the case shell, with a pager over side projects only.
P=work/proj-a/index.html
sentinel_in $P "side h1"                  '<div class="case-title"><h1>Project A</h1>'
sentinel_in $P "side dek is the summary"  '<p class="dek">Project A in one line</p>'
sentinel_in $P "side Year row"            '<dt>Year</dt><dd><time datetime="2025">2025</time></dd>'
sentinel_in $P "side Medium row"          '<dt>Medium</dt><dd>Web</dd>'
sentinel_in $P "side Scope row"           '<dt>Scope</dt><dd>JavaScript, Browser</dd>'
sentinel_in $P "side Link row says where" '<dt>Link</dt><dd><a href="https://example.com/a">example.com/a</a></dd>'
sentinel_in $P "side Code row from repo:" '<dt>Code</dt><dd><a href="https://github.com/test/a">github.com/test/a</a></dd>'
absent_in   $P "side page has no Client row" '<dt>Client</dt>'
sentinel_in $P "side back link to its About entry" '<a class="back" href="../02-gallery/#proj-a">&larr; Side projects</a>'
absent_in   $P "no position count on side pages" 'class="count"'
sentinel_in $P "first side page leads back"  '<a class="pn-all" href="../02-gallery/#proj-a">'
sentinel_in $P "side rel=next"               'rel="next" href="../proj-b/"'
sentinel_in work/proj-b/index.html "side rel=prev" 'rel="prev" href="../proj-a/"'
sentinel_in work/proj-b/index.html "side rel=next to the last" 'rel="next" href="../proj-c/"'
sentinel_in work/proj-c/index.html "last side page leads back" '<a class="pn-all pn-end" href="../02-gallery/#proj-c">'
absent_in   work/proj-c/index.html "side pager stays in side projects" 'href="../01-tags/"'
absent_in   work/05-twin-b/index.html "client pager stays in client work" 'href="../proj-a/"'

# A link that is the repo shows once, as Code; a link inside a comment is
# never the page link.
sentinel_in work/proj-b/index.html "link equal to repo: shows as Code" '<dt>Code</dt><dd><a href="https://github.com/test/b">github.com/test/b</a></dd>'
absent_in   work/proj-b/index.html "no Link row repeating the repo" '<dt>Link</dt>'
absent_in   work/proj-c/index.html "commented-out link is not the page link" 'example.com/comment'

# Screens: a lone image line is a captioned figure with its size, its
# path resolved from the item's folder; inline images stay inline.
sentinel_in $P "screen figure, caption from the title" '<figure class="screen"><img src="../../contents/02-gallery/items/proj-a/screen-1.png" alt="A grey test card &amp; &lt;b&gt;" loading="lazy" width="120" height="60"><figcaption>The main view, &quot;quoted&quot;</figcaption></figure>'
sentinel_in $P "portrait screen marked, no caption without a title" '<figure class="screen portrait"><img src="../../contents/02-gallery/items/proj-a/screen-2.png" alt="A tall grey test card" loading="lazy" width="40" height="80"></figure>'
sentinel_in $P "JPEG size read"           'shot.jpg" alt="A small dark photo" loading="lazy" width="30" height="20"><figcaption>A JPEG</figcaption>'
sentinel_in $P "inline image stays inline" 'inline <img src="https://example.com/img.png" alt="alt text" loading="lazy" />'
sentinel_in work/04-noorder/index.html "contents/ path kept as is" '<figure class="screen"><img src="../../contents/04-noorder/figure.png" alt="A relative image" loading="lazy"></figure>'
warned "missing screen flagged" 'warn: contents/04-noorder/_.md: contents/04-noorder/figure.png not found'
sentinel_in work/proj-b/index.html "two portrait screens in a row pair up" '<div class="screen-pair"><figure class="screen portrait"><img src="../../contents/02-gallery/items/proj-a/screen-2.png" alt="Tall card one"'
sentinel_in work/01-tags/index.html "client case screen under its decision" '<h3>A decision with a screen</h3><figure class="screen"><img src="../../contents/02-gallery/items/proj-a/screen-1.png" alt="A grey test card" loading="lazy" width="120" height="60"><figcaption>The decision, on screen</figcaption></figure>'
sentinel_in work/proj-b/index.html "the pair closes after the second" '<figcaption>The second tall card</figcaption></figure></div>'

# Diagrams: DIAGRAM: file "caption" inlines the SVG in a captioned figure.
sentinel_in $P "diagram inlined in a figure" '<figure class="diagram"><svg role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160">'
sentinel_in $P "diagram keeps its knockout label" '<text class="knock" x="320" y="80">build.sh</text>'
sentinel_in $P "diagram caption"          '</svg><figcaption>Markdown in, pages out</figcaption></figure>'
absent_in   $P "no XML prolog inlined"    '<?xml'
absent_in   $P "no SVG comment inlined"   'diagram comment'
absent_in   $P "DIAGRAM line not in the body" 'DIAGRAM:'

# motion.js is linked deferred from every page when it exists.
sentinel_in work/01-tags/index.html "motion.js deferred on case pages" '<script src="../../motion.js" defer></script>'
sentinel_in works.html "motion.js deferred on the ledger" '<script src="motion.js" defer></script>'

# Toys: a TOY: line right after a DIAGRAM: line mounts toys/<name>.js in
# that figure. The SVG stays as the no-JS and reduced-motion state.
P=work/01-tags/index.html
sentinel_in $P "toy marks its diagram figure" '<figure class="diagram" data-toy="demo"><svg role="img"'
sentinel_in $P "toy script loads as a module" '<script type="module" src="../../toys/demo.js"></script>'
absent_in   $P "TOY line not in the body"     'TOY:'
absent_in   work/proj-a/index.html "no toy script without a TOY line" 'toys/'
T=contents/01-tags
build_warns "missing toy flagged" "warn: $T/_.md: toy nope not found" \
    "sed -i.bak 's/^TOY: demo/TOY: nope/' $T/_.md"
build_warns "toy without a diagram flagged" "warn: $T/_.md: toy demo is not right after a diagram" \
    "sed -i.bak 's/^DIAGRAM: .*//' $T/_.md"

# About sections: proj-a (2025-08-01) before proj-b (2024-05-01).
GALLERY="$FIXTURE_DIR/work/02-gallery/index.html"
pos_a=$(grep -n 'id="proj-a"' "$GALLERY" | head -n 1 | cut -d: -f1 || true)
pos_b=$(grep -n 'id="proj-b"' "$GALLERY" | head -n 1 | cut -d: -f1 || true)
if [ -n "$pos_a" ] && [ -n "$pos_b" ] && [ "$pos_a" -lt "$pos_b" ]; then
    pass "About items sorted date desc (A before B)"
else
    fail "About item sort: A=$pos_a B=$pos_b"
fi

# Ledger order: featured cases by their featured: number (04-noorder is
# older than 03-metrics but comes first). The Also sentence has no rows,
# and side projects are not listed here.
rows=$(grep -o 'class="row" href="work/[^"]*/"' "$ACTUAL" | sed -e 's|.*href="work/||' -e 's|/"$||' | tr '\n' ' ' || true)
want="04-noorder 03-metrics "
if [ "$rows" = "$want" ]; then
    pass "featured by number, and no side rows"
else
    fail "row order: got '$rows', want '$want'"
fi

echo "Featured and Also..."
sentinel_in works.html "featured list"                '<ol class="ledger featured">'
sentinel_in works.html "featured group keeps its heading" '<div class="group-head"><h2 id="g-client">Client work</h2></div>'
sentinel_in works.html "featured row: glyph, name, summary, no role or year" '<li id="04-noorder"><a class="row" href="work/04-noorder/"><span class="glyph initial" style="view-transition-name: g-04-noorder" aria-hidden="true">F</span><span class="name">Fourth</span><span class="line">No order field; dated last of the four.</span></a></li>'
sentinel_in works.html "Also section"                 '<section class="group also" aria-labelledby="g-also">'
sentinel_in works.html "Also heading is plain"        '<div class="group-head"><h2 id="g-also">Also</h2></div>'
absent_in   works.html "no Also index list"           '<ol class="ledger index">'
# One sentence, newest first: glyph inline (black fills as currentColor),
# name, role inside the link, year; commas, "and" before the last, a stop.
sentinel_in works.html "Also item: glyph, name, role, year, comma" '<span class="it" id="01-tags"><a href="work/01-tags/"><span class="ag" aria-hidden="true"><svg viewBox="0 0 10 10" style="view-transition-name: g-01-tags"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg></span><span class="nm" data-t="Tags &amp; &lt;Co&gt;">Tags &amp; &lt;Co&gt;<span class="rl"> Designer &amp; writer</span></span> <time class="yr" datetime="2024-03-01">2024</time></a>,</span>'
sentinel_in works.html "Also initial for a missing glyph" '<span class="ag initial" aria-hidden="true" style="view-transition-name: g-05-twin-a">T</span>'
sentinel_in works.html "no comma before the and"      '<time class="yr" datetime="2021-05-01">2021</time></a></span> <span class="it" id="05-twin-b"><span class="and">and</span>&nbsp;<a href="work/05-twin-b/">'
sentinel_in works.html "Also ends with a full stop"   '<time class="yr" datetime="2021-05-01">2021</time></a>.</span></p>'
also_order=$(awk '/g-also/,/<\/section>/' "$ACTUAL" | grep -o '<span class="it" id="[^"]*"' | sed -e 's|.*id="||' -e 's|"$||' | tr '\n' ' ')
if [ "$also_order" = "01-tags 05-twin-a 05-twin-b " ]; then
    pass "Also runs newest first, slug breaking ties"
else
    fail "Also order: got '$also_order'"
fi
if awk '/g-also/,/<\/section>/' "$ACTUAL" | grep -qE 'class="(line|glyph)|data-parts='; then
    fail "Also carries a summary line, a ledger glyph or glyph parts"
else
    pass "Also carries no summary line and no glyph parts"
fi
if grep -F '<ol class="ledger featured">' "$ACTUAL" >/dev/null && \
    awk '/<ol class="ledger featured">/,/<\/ol>/' "$ACTUAL" | grep -qE 'id="(01-tags|05-twin-a|05-twin-b)"'; then
    fail "an unfeatured case sits in the featured list"
else
    pass "only featured cases in the featured list"
fi
absent_in works.html "no Role column over featured rows" '<span>Role</span>'

# Without any featured: the client group is one dated ledger.
build_shows() {
    local desc=$1 setup=$2 check=$3 tmp
    tmp=$(mktemp -d)
    cp -R "$FIXTURE_DIR/." "$tmp/"
    rm -rf "$tmp/work" "$tmp/works.html"
    (cd "$tmp" && eval "$setup" && bash "$REPO_DIR/build.sh" >/dev/null 2>&1)
    if (cd "$tmp" && eval "$check"); then
        rm -rf "$tmp"; pass "$desc"
    else
        rm -rf "$tmp"; fail "$desc"
    fi
}
build_shows "no featured: one dated client ledger, no index" \
    'sed -i.bak "/^featured:/d" contents/03-metrics/_.md contents/04-noorder/_.md' \
    '! grep -qF "g-also" works.html && ! grep -qF "ledger featured" works.html && grep -qF "<ol class=\"ledger\">" works.html && [ "$(grep -o "class=\"row\" href=\"work/[^\"]*/\"" works.html | head -n 5 | sed -e "s|.*work/||" -e "s|/\"||" | tr "\n" " ")" = "01-tags 03-metrics 04-noorder 05-twin-a 05-twin-b " ]'
build_warns "featured: that isn't a number flagged" "warn: 03-metrics featured: must be a positive number (top)" \
    'sed -i.bak "s/^featured: 2/featured: top/" contents/03-metrics/_.md'

# contents/front.md: headline, thesis and offers above the cases, How I
# work and the signature below. Without it, the profile heads the page.
echo "Front page..."
sentinel_in works.html "front: headline is the h1, the name links home" '<h1 class="name"><a class="home" href="./">Test Author</a>, fixture designer &amp; lead. Ten years, most of them leading.</h1>'
sentinel_in works.html "front: site links beside the name" '<nav class="site" aria-label="Site"><a href="#g-client">Cases</a> <a href="work/02-gallery/">About</a> <a href="https://linkedin.com/in/test">LinkedIn</a></nav>'
build_shows "front: the email joins the site links, short on a phone" \
    'awk "{ print } /^kind: profile/ { print \"email: test@example.test\" }" contents/02-gallery/_.md > x && mv x contents/02-gallery/_.md' \
    'grep -qF "<a href=\"https://linkedin.com/in/test\">LinkedIn</a> <a href=\"mailto:test@example.test\"><span class=\"long\">test@example.test</span><span class=\"short\">Email</span></a></nav>" works.html'
sentinel_in works.html "front: thesis split at its comma, last word kept with the one before" '<p class="thesis"><span class="l">If the fixtures do the building,</span> <span class="l">someone designs the&nbsp;test.</span></p>'
sentinel_in works.html "front: offers section, one row per offer" '<section class="offers" aria-labelledby="g-offers" style="--n: 2">'
sentinel_in works.html "front: offers heading for screen readers" '<h2 id="g-offers" class="sr">What I can do</h2>'
sentinel_in works.html "front: first offer open, kicker, line, proof" '<li class="offer on" data-proof="03-metrics proj-a"><h3 class="kicker" id="k-1"><span class="t">Numbers people trust</span></h3><div class="detail" id="d-1"><div class="in"><div class="room"></div><p class="offer-line">I make the numbers come first &amp; the story second.</p><p class="proof">See <a href="work/03-metrics/">Third</a> and <a href="work/proj-a/">Project A</a></p></div></div></li>'
sentinel_in works.html "front: later offers closed" '<li class="offer" data-proof="01-tags"><h3 class="kicker" id="k-2">'
sentinel_in works.html "front: offer copy escaped"     'Every tag &amp; &lt;bracket&gt; comes out escaped.'
sentinel_in works.html "front: proof label is the case label" '<a href="work/01-tags/">Tags &amp; &lt;Co&gt;</a>'
sentinel_in works.html "front: stage for the proof glyphs" '<div class="stage" aria-hidden="true"></div>'
sentinel_in works.html "front: proof glyph parts from _.parts.svg" "<i data-slug=\"01-tags\" data-label=\"Tags &amp; &lt;Co&gt;\" data-glyph=\"$(base64 < "$FIXTURE_DIR/contents/01-tags/_.svg" | tr -d '\n')\" data-parts=\"$(base64 < "$FIXTURE_DIR/contents/01-tags/_.parts.svg" | tr -d '\n')\"></i>"
sentinel_in works.html "front: a glyph without parts is one piece" "<i data-slug=\"proj-a\" data-label=\"Project A\" data-glyph=\"$(base64 < "$FIXTURE_DIR/contents/02-gallery/items/proj-a/_.svg" | tr -d '\n')\"></i>"
absent_in   works.html "front: a proof without a glyph has no source" 'data-slug="03-metrics"'
sentinel_in works.html "front: front.js linked, deferred" '<script src="front.js" defer></script>'
absent_in   work/01-tags/index.html "front.js stays off case pages" 'front.js'
absent_in   works.html "front: the old scope and availability lines are gone" '<p class="scope">'
absent_in   works.html "front: the old offers group is gone" 'class="group offers"'
sentinel_in works.html "front: How I work, its paragraph as the heading, the scope under it" "<section class=\"group how\" aria-labelledby=\"g-how\"><h2 class=\"how-line\" id=\"g-how\">I make fixtures. Usually that means breaking things on purpose.</h2><div class=\"how-cols\"><p class=\"facts\">Fixtures, builds &amp; &lt;tests&gt; for anyone. Lately I break things on purpose.</p></div></section>"
sentinel_in works.html "front: signature ask from the CTA line" "<h2 class=\"sig-ask\" id=\"sig-ask\"><span class=\"sig-l\">Testing a fixture people must trust? <a href=\"https://linkedin.com/in/test\" aria-label=\"Let's talk on LinkedIn\">Let's talk</a>.</span></h2>"
sentinel_in works.html "front: signature links and availability" "<p class=\"sig-more\"><a href=\"https://linkedin.com/in/test\">LinkedIn</a> <a href=\"https://github.com/test\">GitHub</a></p>
<p class=\"sig-avail\">Open to what's next. UTC-3.</p>"
sentinel_in works.html "front: signature glyphs are decorative, inline in currentColor" '<li><span class="sig-g" data-name="Project A"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg></span></li>'
absent_in   works.html "front: signature glyphs don't link" 'class="sig-g" href='
sentinel_in works.html "front: foot.js linked, deferred" '<script src="foot.js" defer></script>'
absent_in   work/01-tags/index.html "foot.js stays off case pages" 'foot.js'
absent_in   works.html "front: no inline footer script" '<script type="application/json"'
build_shows "front: the email heads the signature's links" \
    'awk "{ print } /^kind: profile/ { print \"email: test@example.test\" }" contents/02-gallery/_.md > x && mv x contents/02-gallery/_.md' \
    'grep -qF "<a class=\"sig-mail\" href=\"mailto:test@example.test\">test@<wbr>example.test</a>" works.html'
absent_in   works.html "front: comments never render"  'Front page copy for works.html'
if awk '/g-offers/{o=NR} /g-client/{c=NR} /g-how/{h=NR} END{exit !(o && c && h && o < c && c < h)}' "$ACTUAL"; then
    pass "front: offers above the featured cases, How I work below them"
else
    fail "front: offers, cases and How I work out of order"
fi
build_must_fail "front: proof naming no case fails" "Unknown case in" \
    'sed -i.bak "s/^PROOF: 01-tags/PROOF: nope/" contents/front.md'
build_must_fail "front: offer without proof fails" "needs a PROOF" \
    'sed -i.bak "/^PROOF: 01-tags/d" contents/front.md'
build_shows "front: without front.md the profile heads the page" \
    'rm contents/front.md' \
    'grep -qF "<h1 class=\"lead\">I make fixtures. Usually that means breaking things on purpose.</h1>" works.html && grep -qF "Ten years in. Open to" works.html && ! grep -qF "g-offers" works.html && ! grep -qF "front.js" works.html && ! grep -qF "foot.js" works.html && grep -qF "<footer class=\"contact\">" works.html'

echo "Case fields..."
build_must_fail "case without role: fails" "Missing role" \
    'grep -v "^role:" contents/01-tags/_.md > x && mv x contents/01-tags/_.md'
build_must_fail "case without label: fails" "Missing label" \
    'grep -v "^label:" contents/01-tags/_.md > x && mv x contents/01-tags/_.md'
build_must_fail "case without summary: fails" "Missing summary" \
    'grep -v "^summary:" contents/01-tags/_.md > x && mv x contents/01-tags/_.md'
SUMMARY='Tags &amp; &lt;escapes&gt; in one line'
sentinel_in works.html "summary is the featured line" '<span class="line">Numbers first, then the story.</span>'
sentinel_in works.html "label is the Also name, escaped" '<span class="nm" data-t="Tags &amp; &lt;Co&gt;">Tags &amp; &lt;Co&gt;<span class="rl">'
sentinel_in works.html "role rides in the Also link"  '<span class="rl"> Designer &amp; writer</span>'
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

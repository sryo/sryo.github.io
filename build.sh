#!/bin/bash

# ◯┃ LineAndForm (L+F)
# A Simple Portfolio Generator.

# What is LineAndForm?
# LineAndForm is a simple, mostly self-contained bash script that generates an interactive
# HTML portfolio from my content. It's designed for myself, but available to other
# creators who want a quick way to showcase their work online.

# Why LineAndForm?
# - Because updating my portfolio manually was tedious
# - Because I can

# What makes LineAndForm special:
# 1. It's simple: Just organize your content in folders, run the script, and you have a portfolio.
# 2. It's mostly self-contained: One bash script does it all (with a config file and assets).

# How to use LineAndForm:
# 1. Configure:
#    - Edit 'config.cfg' to set your title, output filename, and other options.
#    - SITE_URL builds canonical and og: links; AUTHOR signs page titles.
#    - Ensure 'styles.css' is present. 'script.js' is optional: inlined when non-empty.

# 2. Set up your content:
#    - Create a 'contents/' directory (or whatever you set in config).
#    - Inside, make a folder for each case study. The folder name is its slug
#      and URL, so keep it lowercase letters, digits and dashes.
#    - In each folder:
#      a) Add a _.md file that starts with frontmatter: title, date (YYYY-MM-DD),
#         tags, and the required label (short name), role and summary (one
#         plain line: the ledger line, the dek and the meta description).
#         Optional: client, link.
#      b) Optionally, add a glyph: _.svg (or _.png / _.jpg). Without one, the
#         label's initial stands in. Glyphs are one system: a 100×100 viewBox,
#         black fills only, no text, <style> or animation (the build warns).
#    - Mark one folder 'kind: profile' for the About page. It heads the ledger,
#      and its 'items/' folder holds side projects: one subfolder each, with
#      a _.md (label, link and repo optional) and an optional glyph. Each
#      gets its own page too.
#    - In the body, '## ' headings become the page's parts, 'METRICS:' lists
#      become the Impact band, a lone '[text](url)' line before the first
#      heading becomes the Link, a 'CTA:' line becomes the closing row above
#      the pager, and <!-- comments --> never render.
#    - To add a video or other embed, include a line starting with 'EMBED:' in your .md file.
#    - A lone '![alt](screen.png "caption")' line is a captioned screen, and a
#      'DIAGRAM: diagram.svg "caption"' line inlines a diagram; both resolve
#      from the .md's folder.

# 3. Run the script:
#    - Open a terminal in the folder containing this script.
#    - Run the command: ./build.sh (or bash build.sh)
#    - To use the self-destruct option (if enabled in config), run: ./build.sh -d

# 4. View your portfolio:
#    - 'works.html' is the ledger: client work and side projects, newest first.
#    - 'work/<slug>/index.html' is one page per case study (and the About page),
#      with prev/next in ledger order. The build rewrites 'work/' every run.

# License:
# THE UNRESTRICTED BUT RESPONSIBLY SHARED, ALTERED AND DISTRIBUTED SOFTWARE WITHOUT WARRANTIES AND WITH THE ABSENCE OF LIABILITY FOR ANY UNINTENDED CONSEQUENCES LICENSE (VERSION 1.0, AUGUST 4, 2023)
#
# Use it, change it, share it - but keep it under this license. No promises, no liability. Enjoy.


# ─────────────────────────────────────────────────────────────
# Config & CLI
# ─────────────────────────────────────────────────────────────

# Bash 5.2+ treats "&" in ${var//pat/rep} as the match; keep it literal.
shopt -u patsub_replacement 2>/dev/null || true

if [ -f "config.cfg" ]; then
    source config.cfg
else
    CONTENT_DIR="contents/"
    OUTPUT_FILE="works.html"
    TITLE="Interactive Gallery"
    CSS_FILE="styles.css"
    JS_FILE="script.js"
    INLINE_SVG=true
    SELF_DESTRUCT=false
fi

# Optional: SITE_URL builds canonical and og: URLs (skipped when empty);
# AUTHOR signs page titles.
SITE_URL=${SITE_URL%/}
AUTHOR=${AUTHOR:-$TITLE}

DEFAULT_ORDER=9999

# Field separator for parse_frontmatter. Not whitespace, so `read` keeps
# empty fields in place instead of collapsing them.
FS=$'\037'

# Case pages go to work/<slug>/index.html next to the output file.
OUT_DIR=$(dirname "$OUTPUT_FILE")
WORK_DIR="$OUT_DIR/work"

friendly_message() {
    echo "$1"
    echo "   $2"
}

while getopts ":d" opt; do
  case ${opt} in
    d ) SELF_DESTRUCT=true ;;
    \? ) friendly_message "Invalid Option" "Usage: $0 [-d]"; exit 1 ;;
  esac
done

for file in "$CONTENT_DIR" "$CSS_FILE"; do
    if [ ! -e "$file" ]; then
        friendly_message "Missing requirement: $file" "Please ensure all required files and directories exist."
        exit 1
    fi
done


# ─────────────────────────────────────────────────────────────
# Read — frontmatter, content, escaping
# ─────────────────────────────────────────────────────────────

html_escape() {
    local s=$1
    s=${s//&/&amp;}
    s=${s//</&lt;}
    s=${s//>/&gt;}
    s=${s//\"/&quot;}
    printf '%s' "$s"
}

# Frontmatter fields, in the order parse_frontmatter emits them.
#   title, date, tags, order   the originals; order is a tie-break only
#   label    short name for the ledger, prev/next and <title>
#   client   organization, shown on the case page (defaults to label)
#   role     my role; the ledger's last column
#   summary  one plain-text line: ledger line, dek, meta and og:description
#   link     the project's own site or repo
#   kind     "profile" marks the About section; anything else is a case
#   email    profile only, optional: a mailto link beside LinkedIn and GitHub
#   glyph    "colour" keeps an original colour glyph (skips the glyph check)
#   repo     side projects, optional: the source code, the spec's Code row
# Case studies must set label, role and summary (see require_fields).

# Single awk pass over the frontmatter block. Emits the fields above,
# $FS-separated. Missing fields are empty strings.
parse_frontmatter() {
    awk '
    BEGIN { n = split("title date tags order label client role summary link kind email glyph repo", keys, " ") }
    NR==1 && /^---$/ { in_fm=1; next }
    in_fm && /^---$/ { exit }
    in_fm && match($0, /^[a-z]+:[[:space:]]*/) {
        k = substr($0, 1, index($0, ":") - 1)
        v = substr($0, RLENGTH + 1)
        sub(/[[:space:]]+$/, "", v)
        if (k == "tags") {
            gsub(/[\[\]]/, "", v)
            gsub(/[[:space:]]*,[[:space:]]*/, ",", v)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
        } else {
            sub(/^"/, "", v); sub(/"$/, "", v)
        }
        val[k] = v
    }
    END { for (i = 1; i <= n; i++) printf "%s%s", (i > 1 ? "\037" : ""), val[keys[i]] }
    ' "$1"
}

# Load a folder's frontmatter into fm_* globals, with the ledger fallbacks
# filled in: label from the title's text before ": ", client from label.
load_fm() {
    local folder=$1
    IFS=$FS read -r fm_title fm_date fm_tags fm_order fm_label fm_client fm_role fm_summary fm_link fm_kind fm_email fm_glyph fm_repo \
        < <(parse_frontmatter "$folder/_.md")
    [ -z "$fm_title" ] && fm_title=$(basename "$folder")
    [ -z "$fm_label" ] && fm_label=$(derive_label "$fm_title")
    [ -z "$fm_client" ] && fm_client=$fm_label
    [ -z "$fm_order" ] && fm_order=$DEFAULT_ORDER
    return 0
}

# A case study without label, role or summary would print an ugly
# fallback in the ledger, so the build stops and says which field.
require_fields() {
    local file=$1 field value
    IFS=$FS read -r _ _ _ _ fm_label _ fm_role fm_summary _ fm_kind _ < <(parse_frontmatter "$file")
    [ "$fm_kind" = "profile" ] && return 0
    for field in label role summary; do
        eval "value=\$fm_$field"
        if [ -z "$value" ]; then
            friendly_message "Missing $field: in $file" "Case studies need label:, role: and summary: in their frontmatter."
            return 1
        fi
    done
}

# Skip only the first two `---` markers (the frontmatter delimiters).
# A `---` later in the file is preserved as body content.
strip_frontmatter() {
    local file=$1
    if [[ $(head -n 1 "$file") == "---" ]]; then
        awk 'BEGIN{skip=0} skip<2 && /^---$/{skip++; next} skip>=2{print}' "$file"
    else
        cat "$file"
    fi
}

# A slug is the folder's basename: it names the page (work/<slug>/) and the
# row's #anchor. Prints it, or complains and returns 1 when it isn't a
# plain lowercase URL segment.
slug_of() {
    local slug
    slug=$(basename "$1")
    if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
        friendly_message "Invalid slug: $1" "Folder names must match ^[a-z0-9][a-z0-9-]*\$ (they become URLs)." >&2
        return 1
    fi
    printf '%s' "$slug"
}

# Look for _.svg, then _.png, then _.jpg. Returns empty if none.
find_item_image() {
    local folder=$1
    local ext
    for ext in svg png jpg; do
        if [ -f "$folder/_.$ext" ]; then
            printf '%s' "$folder/_.$ext"
            return
        fi
    done
}

# Glyphs are one system: black fills only (the dark-mode invert depends on
# it), no <text>, <style> or animation. Anything else still renders, with
# a warning naming the folder and the first offence. "glyph: colour" in the
# frontmatter keeps an original colour glyph and skips the check.
check_glyph() {
    local image_file=$1 slug=$2 kind=$3 fill why=""
    [ "$kind" = colour ] && return 0
    [[ "$image_file" == *.svg ]] || return 0
    if grep -qiE '<(text|style|animate)' "$image_file"; then
        why=$(grep -oiE '<(text|style|animate)[A-Za-z]*' "$image_file" | head -n 1)
    else
        while IFS= read -r fill; do
            fill=${fill#fill}; fill=${fill#=\"}; fill=${fill#:}
            fill=$(printf '%s' "$fill" | tr -d ' "' | tr '[:upper:]' '[:lower:]')
            case "$fill" in
                black|'#000'|'#000000'|none) ;;
                *) why="fill $fill"; break ;;
            esac
        done < <(grep -oE 'fill(="[^"]*"|:[^;"]*)' "$image_file")
    fi
    [ -z "$why" ] || echo "warn: $slug glyph off-system ($why)" >&2
    return 0
}

insert_image() {
    local image_file=$1
    local alt_text=$2
    local safe_alt b64_data
    safe_alt=$(html_escape "$alt_text")

    if [[ "$image_file" == *.svg ]] && $INLINE_SVG; then
        b64_data=$(base64 < "$image_file" | tr -d '\n')
        echo "<img src=\"data:image/svg+xml;base64,$b64_data\" alt=\"$safe_alt\" />"
    else
        echo "<img src=\"${image_file#/}\" loading=\"lazy\" alt=\"$safe_alt\" />"
    fi
}

# Pixel size of a PNG, GIF or JPEG as "width height", read from its
# header with od (no image tools needed). Prints nothing when unknown.
image_size() {
    local f=$1 off=2 i b
    [ -f "$f" ] || return 0
    case "$f" in
        *.png|*.PNG)
            od -An -tu1 -j16 -N8 -v "$f" | awk '{ print $1*16777216 + $2*65536 + $3*256 + $4, $5*16777216 + $6*65536 + $7*256 + $8 }' ;;
        *.gif|*.GIF)
            od -An -tu1 -j6 -N4 -v "$f" | awk '{ print $1 + $2*256, $3 + $4*256 }' ;;
        *.jpg|*.jpeg|*.JPG|*.JPEG)
            # Walk the segments to the first start-of-frame marker.
            for ((i = 0; i < 200; i++)); do
                read -r -a b < <(od -An -tu1 -j"$off" -N9 -v "$f" | tr -s ' \n' ' ')
                [ "${#b[@]}" -ge 4 ] && [ "${b[0]}" = 255 ] || return 0
                case "${b[1]}" in
                    192|193|194|195|197|198|199|201|202|203|205|206|207)
                        echo "$((b[7] * 256 + b[8])) $((b[5] * 256 + b[6]))"; return 0 ;;
                esac
                off=$((off + 2 + b[2] * 256 + b[3]))
            done ;;
    esac
    return 0
}

# A lone "![alt](src "caption")" line: a screen, rendered as a figure with
# its pixel size (so the page doesn't jump) and a caption (the title, else
# the alt). A relative src resolves from the markdown file's folder. Warns
# on an empty alt, a missing file, a file over 250KB and a fourth screen
#. Reads render_markdown_content's locals
# (file, mode, screens: already counting this one), since it runs in $().
render_screen() {
    local alt=$1 src=$2 caption=$3 path size w h cls=screen bytes
    local warn=true
    [ "$mode" = metrics ] && warn=false
    case "$src" in
        *://*|/*|"$CONTENT_DIR"*) path=$src ;;
        *) path="$(dirname "$file")/$src"; src=$path ;;
    esac
    if $warn; then
        [ -n "$alt" ] || echo "warn: $file: image without alt ($src)" >&2
        [ "$screens" = 4 ] && echo "warn: $file: more than 3 screens" >&2
        if [[ "$path" != *://* ]]; then
            if [ -f "$path" ]; then
                bytes=$(wc -c < "$path")
                [ "$bytes" -gt 256000 ] && echo "warn: $file: $(basename "$path") is over 250KB ($((bytes / 1024))KB)" >&2
            else
                echo "warn: $file: $path not found" >&2
            fi
        fi
    fi
    read -r w h < <(image_size "$path")
    [ -n "$h" ] && [ "$h" -gt "$w" ] && cls="screen portrait"
    printf '<figure class="%s"><img src="%s" alt="%s" loading="lazy"%s><figcaption>%s</figcaption></figure>' \
        "$cls" "$(html_escape "$src")" "$(html_escape "$alt")" "${w:+ width=\"$w\" height=\"$h\"}" \
        "$(html_escape "${caption:-$alt}")"
}

# A "DIAGRAM: file.svg "caption"" line: the SVG inlined (so it inherits
# the page's font and currentColor, and dark mode works) in a captioned
# figure. The file resolves from the markdown file's folder. Drops the
# XML prolog and comments, adds role="img", and warns when the file is
# missing, the caption is, or the drawing is off-spec: no viewBox, a
# <style>/<script>/<image>/<foreignObject>, or a fill or stroke other
# than currentColor or none.
render_diagram() {
    local spec=$1 name caption path svg why=""
    local warn=true
    [ "$mode" = metrics ] && warn=false
    name=${spec%% *}
    caption=""
    if [[ "$spec" =~ ^[^[:space:]]+[[:space:]]+\"(.*)\"[[:space:]]*$ ]]; then caption=${BASH_REMATCH[1]}; fi
    case "$name" in
        "$CONTENT_DIR"*) path=$name ;;
        *) path="$(dirname "$file")/$name" ;;
    esac
    if [ ! -f "$path" ]; then
        $warn && echo "warn: $file: diagram $name not found" >&2
        return 0
    fi
    $warn && [ -z "$caption" ] && echo "warn: $file: diagram without caption" >&2
    svg=$(sed -e 's/<?xml[^>]*?>//' "$path" | awk '
        { line = $0
          while (1) {
              if (inc) { i = index(line, "-->"); if (!i) { line = ""; break }; line = substr(line, i + 3); inc = 0 }
              i = index(line, "<!--"); if (!i) break
              rest = substr(line, i + 4); j = index(rest, "-->")
              if (j) line = substr(line, 1, i - 1) substr(rest, j + 3)
              else { line = substr(line, 1, i - 1); inc = 1 }
          }
          if (line ~ /[^[:space:]]/) print line }')
    if $warn; then
        if [[ "$svg" =~ \<(style|script|image|foreignObject) ]]; then
            why="<${BASH_REMATCH[1]}"
        elif [[ "$svg" != *"viewBox="* ]]; then
            why="no viewBox"
        else
            why=$(printf '%s' "$svg" | grep -oE '(fill|stroke)="[^"]*"' \
                | grep -vE '="(currentColor|none)"' | head -n 1 | sed -E 's/="/ /; s/"$//' || true)
        fi
        [ -z "$why" ] || echo "warn: $file: $name off-spec ($why)" >&2
    fi
    [[ "$svg" == *"<svg role="* ]] || svg=${svg/<svg /<svg role=\"img\" }
    printf '<figure class="diagram">%s<figcaption>%s</figcaption></figure>' "$svg" "$(html_escape "$caption")"
}


# ─────────────────────────────────────────────────────────────
# Transform — markdown → HTML
# ─────────────────────────────────────────────────────────────

# Per-line inline rules. Block structure (paragraphs, lists, code, METRICS)
# is handled by render_markdown_content. Header rules go longest-prefix-first
# so `#### x` matches `<h4>` before `<h1>` can grab the leading `#`.
parse_markdown() {
    local line=$1
    if [[ "$line" == "EMBED:"* ]]; then
        printf '%s' "${line#EMBED:}"
        return
    fi
    printf '%s' "$line" | sed -E \
        -e 's|^#### (.*)|<h4>\1</h4>|' \
        -e 's|^### (.*)|<h3>\1</h3>|' \
        -e 's|^## (.*)|<h2>\1</h2>|' \
        -e 's|^# (.*)|<h1>\1</h1>|' \
        -e 's|`([^`]+)`|<code>\1</code>|g' \
        -e 's|\*\*([^*]+)\*\*|<strong>\1</strong>|g' \
        -e 's|\*([^*]+)\*|<em>\1</em>|g' \
        -e 's|!\[([^]]*)\]\(([^)]+)\)|<img src="\2" alt="\1" loading="lazy" />|g' \
        -e 's|\[([^]]+)\]\(([^)]+)\)|<a href="\2">\1</a>|g' \
        -e 's|^- (.*)|<li>\1</li>|'
}

# Page mode helper: wrap everything since $part_start in a part. The h2
# hangs as its label; content before the first h2 gets an unlabeled part.
# A part left empty (say, a "Results" that only held METRICS) is dropped.
# Uses render_markdown_content's locals through bash's dynamic scope.
flush_part() {
    local body=${content:$part_start}
    content=${content:0:$part_start}
    [ -n "$body" ] || return 0
    if [ -n "$part_label" ]; then
        content+="<section class=\"part\"><h2 class=\"label\">$part_label</h2><div class=\"body\">$body</div></section>"
    else
        content+="<section class=\"part part-lead\"><div class=\"body\">$body</div></section>"
    fi
}

# A METRICS value earns big-number styling only when it's a quantity:
# it starts with a digit or one of ~ < > + $ ±. "Real-time" or "Finalist"
# are true, but they aren't figures.
is_quantity() {
    case "$1" in
        [0-9~\<\>+\$]*|±*) return 0 ;;
    esac
    return 1
}

# Close a METRICS block: end the figures grid, then list what wasn't a
# quantity under it. Uses render_markdown_content's locals, like flush_part.
close_metrics() {
    local open='<div class="metrics-grid">'
    if [[ "$metrics" == *"$open" ]]; then
        metrics=${metrics%"$open"}
    else
        metrics+="</div>"
    fi
    if [ -n "$notes" ]; then
        metrics+="<ul class=\"metric-notes\">$notes</ul>"
        notes=""
    fi
}

# Modes: "" renders the body in place. "page" wraps each `## ` heading and
# what follows in a part (see flush_part) and leaves METRICS out; "metrics"
# renders only the METRICS blocks, for the figures band. HTML comments
# (source notes) never render, in any mode.
render_markdown_content() {
    local file=$1
    local mode=${2:-}
    local content="" metrics="" notes="" line parsed_line escaped_line after
    local in_paragraph=false in_list=false in_metrics=false in_code_block=false in_comment=false
    local metric_line value label
    local part_start=0 part_label="" hoisted=false screens=0 fig lone_at=-1 lone_end=-1
    local link_re='^\[[^]]+\]\([^)]+\)$'
    local screen_re='^!\[([^]]*)\]\(([^ )]+)( "(([^"\\]|\\.)*)")?\)[[:space:]]*$'
    local figma_embed_re='src="(https://embed\.figma\.com/[^"]*)"'
    local idless_embed_re='src="[^"]*youtube(\.googleapis)?\.com/embed/?(\?|")'

    while IFS= read -r line || [ -n "$line" ]; do
        # Inside a comment: skip until it closes, keep what follows.
        if $in_comment; then
            [[ "$line" == *"-->"* ]] || continue
            line=${line#*-->}
            in_comment=false
            [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        fi

        # Fenced code block — toggle and escape contents.
        if [[ "$line" == '```'* ]]; then
            if $in_code_block; then
                content+="</code></pre>"
                in_code_block=false
            else
                if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
                if $in_list; then content+="</ul>"; in_list=false; fi
                content+="<pre><code>"
                in_code_block=true
            fi
            continue
        fi
        if $in_code_block; then
            escaped_line=${line//&/&amp;}
            escaped_line=${escaped_line//</&lt;}
            escaped_line=${escaped_line//>/&gt;}
            content+="$escaped_line
"
            continue
        fi

        # Strip comments that open on this line; a comment-only line is
        # dropped without closing the paragraph around it.
        if [[ "$line" == *"<!--"* ]]; then
            while [[ "$line" == *"<!--"* ]]; do
                after=${line#*<!--}
                if [[ "$after" == *"-->"* ]]; then
                    line="${line%%<!--*}${after#*-->}"
                else
                    line=${line%%<!--*}
                    in_comment=true
                    break
                fi
            done
            [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        fi

        # A video embed with no video ID renders as a blank grey box, so
        # it's dropped (with a warning) instead of passed through.
        if [[ "$line" == *"<iframe"* ]] && [[ "$line" =~ $idless_embed_re ]]; then
            [ "$mode" = "metrics" ] || echo "warn: $file: embed has no video ID, dropped" >&2
            continue
        fi

        # A Figma embed weighs megabytes and runs its own app, so it waits
        # behind a one-line link to the prototype; script.js swaps the iframe in on
        # click, and without JS the link opens Figma.
        if [[ "$line" == *"<iframe"* ]] && [[ "$line" =~ $figma_embed_re ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            content+="<p><a class=\"embed-facade\" href=\"$(html_escape "${BASH_REMATCH[1]//&amp;/&}")\">Open Figma prototype&nbsp;&#8599;</a></p>"
            continue
        fi

        # A CTA: line is the page's closing row (see case_cta), never body.
        if [[ "$line" == "CTA:"* ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            continue
        fi

        # METRICS block opener.
        if [[ "$line" == "METRICS:" ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            metrics+="<div class=\"metrics-grid\">"
            in_metrics=true
            continue
        fi

        # Inside a METRICS block, any non-`- ` line closes the block and
        # falls through to normal processing (prevents content getting
        # swallowed when the block isn't terminated by a blank line).
        if $in_metrics; then
            if [[ "$line" == "- "* ]]; then
                metric_line=${line#- }
                if [[ "$metric_line" =~ ^\*\*([^*]+)\*\*[[:space:]]*(.*) ]]; then
                    value=$(html_escape "${BASH_REMATCH[1]}")
                    label=$(html_escape "${BASH_REMATCH[2]}")
                    if is_quantity "${BASH_REMATCH[1]}"; then
                        metrics+="<div class=\"metric\"><span class=\"metric-value\">$value</span><span class=\"metric-label\">$label</span></div>"
                    else
                        notes+="<li><strong>$value</strong> $label</li>"
                    fi
                else
                    notes+="<li>$(html_escape "$metric_line")</li>"
                fi
                continue
            else
                close_metrics
                in_metrics=false
                # Rendered in place unless the page lifts it into the band.
                if [ -z "$mode" ]; then content+=$metrics; metrics=""; fi
            fi
        fi

        # Page mode: the first lone link before any heading moves to the
        # spec column (see lead_link), so it's not repeated in the body.
        if [ "$mode" = "page" ] && ! $hoisted && [ -z "$part_label" ] \
            && [[ "$line" =~ $link_re ]]; then
            hoisted=true
            continue
        fi

        # A DIAGRAM: line inlines its SVG in a captioned figure.
        if [[ "$line" == "DIAGRAM:"* ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            after=${line#DIAGRAM:}
            after=${after#"${after%%[![:space:]]*}"}
            content+=$(render_diagram "$after")
            continue
        fi

        # A lone image line is a screen: a captioned figure.
        if [[ "$line" =~ $screen_re ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            local s_alt=${BASH_REMATCH[1]} s_src=${BASH_REMATCH[2]} s_cap=${BASH_REMATCH[4]}
            s_cap=${s_cap//\\\"/\"}
            screens=$((screens + 1))
            fig=$(render_screen "$s_alt" "$s_src" "$s_cap")
            # Two portrait screens in a row sit side by side (a pair).
            if [[ "$fig" == '<figure class="screen portrait">'* ]]; then
                if [ "$lone_at" -ge 0 ] && [ "$lone_end" = "${#content}" ]; then
                    content="${content:0:lone_at}<div class=\"screen-pair\">${content:lone_at}$fig</div>"
                    lone_at=-1
                    continue
                fi
                lone_at=${#content}
                content+=$fig
                lone_end=${#content}
                continue
            fi
            content+=$fig
            continue
        fi

        # Page mode: a `## ` heading starts a new part.
        if [ "$mode" = "page" ] && [[ "$line" == "## "* ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            flush_part
            parsed_line=$(parse_markdown "$line")
            part_label=${parsed_line#<h2>}
            part_label=${part_label%</h2>}
            part_start=${#content}
            continue
        fi

        parsed_line=$(parse_markdown "$line")

        if [[ "$parsed_line" == "<li>"* ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if ! $in_list; then content+="<ul>"; in_list=true; fi
            content+="$parsed_line"
            continue
        elif $in_list; then
            content+="</ul>"
            in_list=false
        fi

        # Lines that start with a block-level HTML tag aren't paragraph
        # content, so we don't wrap them in <p>...</p>.
        case "$parsed_line" in
            "<h"[1-6]*|"<div"*|"<iframe"*|"<svg"*|"<img"*|"<blockquote"*|"<figure"*|"<pre"*|"<hr"*|"<video"*|"<audio"*|"<table"*)
                if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
                content+="$parsed_line"
                ;;
            "")
                if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
                ;;
            *)
                if ! $in_paragraph; then content+="<p>"; in_paragraph=true; fi
                content+="$parsed_line"
                ;;
        esac
    done < <(strip_frontmatter "$file")

    if $in_code_block; then content+="</code></pre>"; fi
    if $in_metrics; then
        close_metrics
        if [ -z "$mode" ]; then content+=$metrics; metrics=""; fi
    fi
    if $in_list; then content+="</ul>"; fi
    if $in_paragraph; then content+="</p>"; fi
    if [ "$mode" = "page" ]; then flush_part; fi
    if [ "$mode" = "metrics" ]; then
        echo "$metrics"
    else
        echo "$content"
    fi
}

# The case's closing call to action: its first "CTA:" line, rendered as
# one row above the pager. A LinkedIn link says where it goes to a screen
# reader ("Let's talk on LinkedIn"). Prints nothing without a CTA line.
case_cta() {
    local line text
    line=$(strip_frontmatter "$1" | grep -m 1 '^CTA:' || true)
    [ -n "$line" ] || return 0
    text=$(parse_markdown "$(printf '%s' "${line#CTA:}" | sed -E 's/^[[:space:]]+//')")
    text=$(printf '%s' "$text" | sed -E 's|<a href="(https://[a-z.]*linkedin\.com/[^"]*)">([^<]*)</a>|<a href="\1" aria-label="\2 on LinkedIn">\2</a>|g')
    printf '<p class="case-cta">%s</p>\n' "$text"
}

# Case pages sit two levels down, so links into the content folder
# ("contents/…") need "../../" in front.
rebase_paths() {
    local html=$1
    local from_src="src=\"$CONTENT_DIR" from_href="href=\"$CONTENT_DIR"
    local to_src="src=\"../../$CONTENT_DIR" to_href="href=\"../../$CONTENT_DIR"
    html=${html//"$from_src"/$to_src}
    html=${html//"$from_href"/$to_href}
    printf '%s' "$html"
}


# ─────────────────────────────────────────────────────────────
# Emit — sections, galleries, final HTML
# ─────────────────────────────────────────────────────────────

# The Year row shows the year alone: a month reads as false precision on
# a multi-month project. Empty or malformed dates return empty.
format_year() {
    [[ "$1" =~ ^([0-9]{4})-[0-9]{2} ]] && printf '%s' "${BASH_REMATCH[1]}"
    return 0
}

# A lone "[text](url)" line before the first ## heading is the project's
# link ("Project Link", "View archive"). Prints text$FS url, or nothing.
lead_link() {
    strip_frontmatter "$1" | strip_comments | awk '
        /^## / { exit }
        /^\[[^]]+\]\([^)]+\)$/ {
            t = $0; sub(/^\[/, "", t); sub(/\]\(.*$/, "", t)
            u = substr($0, index($0, "](") + 2); sub(/\)$/, "", u)
            printf "%s\037%s", t, u; exit
        }'
}

# HTML comments (source notes) removed, even across lines, so a link
# kept in a comment is never taken for the page's link.
strip_comments() {
    awk '{
        line = $0; out = ""
        while (1) {
            if (inc) {
                i = index(line, "-->")
                if (!i) { line = ""; break }
                line = substr(line, i + 3); inc = 0
            }
            i = index(line, "<!--")
            if (!i) { out = out line; break }
            out = out substr(line, 1, i - 1); line = substr(line, i + 4); inc = 1
        }
        print out
    }'
}

# A URL as link text that says where it goes: no scheme, no "www.", no
# trailing slash ("sryo.github.io/murmur").
display_url() {
    local u=${1#*://}
    u=${u#www.}
    printf '%s' "${u%/}"
}

# Case header: a spec column (glyph, then Client / Year / Role / Scope /
# Link) beside the h1 and the summary as dek. Uses the fm_* globals.
# A side project (kind "side") lists Year / Medium / Scope / Link / Code:
# it has no client, and its links read as the address they open.
render_case_head() {
    local folder=$1
    local kind=${2:-case}
    local image_file link_text link_url year scope medium
    image_file=$(find_item_image "$folder")
    IFS=$FS read -r link_text link_url < <(lead_link "$folder/_.md")
    if [ -n "$fm_link" ]; then link_text=$fm_link; link_url=$fm_link; fi
    if [ "$kind" = side ]; then
        medium=$(project_link "$folder" "$fm_label")
        [ -n "$medium" ] && link_url=$medium
        [ -n "$link_url" ] && link_text=$(display_url "$link_url")
        medium=${fm_role:-$(derive_medium "$fm_tags")}
    fi

    echo "<header class=\"case-head\">"
    printf '<aside class="spec">'
    if [ "$fm_kind" = "profile" ]; then
        render_glyph "$image_file" "$fm_label"
    else
        render_glyph "$image_file" "$fm_label" "g-$(basename "$folder")"
    fi
    if [ "$fm_kind" != "profile" ]; then
        printf '<dl>'
        [ "$kind" = side ] || printf '<dt>Client</dt><dd>%s</dd>' "$(html_escape "$fm_client")"
        year=$(format_year "$fm_date")
        if [ -n "$year" ]; then
            printf '<dt>Year</dt><dd><time datetime="%s">%s</time></dd>' "$year" "$year"
        fi
        if [ "$kind" = side ]; then
            [ -n "$medium" ] && printf '<dt>Medium</dt><dd>%s</dd>' "$(html_escape "$medium")"
        else
            printf '<dt>Role</dt><dd>%s</dd>' "$(html_escape "$fm_role")"
        fi
        if [ -n "$fm_tags" ]; then
            scope=${fm_tags//,/, }
            printf '<dt>Scope</dt><dd>%s</dd>' "$(html_escape "$scope")"
        fi
        # A link that is the repo shows once, as Code.
        if [ "$kind" = side ] && [ -n "$fm_repo" ] && [ -n "$link_url" ] \
            && [ "$(display_url "$link_url")" = "$(display_url "$fm_repo")" ]; then
            link_url=""
        fi
        if [ -n "$link_url" ]; then
            printf '<dt>Link</dt><dd><a href="%s">%s</a></dd>' "$(html_escape "$link_url")" "$(html_escape "$link_text")"
        fi
        if [ "$kind" = side ] && [ -n "$fm_repo" ]; then
            printf '<dt>Code</dt><dd><a href="%s">%s</a></dd>' "$(html_escape "$fm_repo")" "$(html_escape "$(display_url "$fm_repo")")"
        fi
        printf '</dl>'
    fi
    printf '</aside>\n'
    printf '<div class="case-title"><h1>%s</h1>' "$(html_escape "$fm_title")"
    if [ -n "$fm_summary" ]; then
        printf '<p class="dek">%s</p>' "$(html_escape "$fm_summary")"
    fi
    printf '</div>\n'
    echo "</header>"
}

# Print folders newest first: date descending, then order:, then slug.
# Folders without a _.md are skipped. Undated ones sort last.
sort_folders() {
    local folder
    for folder in "$@"; do
        folder=${folder%/}
        [ -f "$folder/_.md" ] || continue
        load_fm "$folder"
        printf '%s|%s|%s|%s\n' "$fm_date" "$fm_order" "$(basename "$folder")" "$folder"
    done | LC_ALL=C sort -t'|' -k1,1r -k2,2n -k3,3 | cut -d'|' -f4-
}

# The glyph cell: the folder's image, or, when it has none, the label's
# first letter set in type so the column never has holes. An optional
# view-transition name lets the glyph fly from its row to its case page.
render_glyph() {
    local image_file=$1 label=$2 vt=${3:+ style=\"view-transition-name: $3\"} initial cls=glyph
    [ "$fm_glyph" = colour ] && cls="glyph colour"
    if [ -n "$image_file" ] && [ -f "$image_file" ]; then
        printf '<span class="%s"%s>%s</span>' "$cls" "$vt" "$(insert_image "$image_file" "" | tr -d '\n')"
    else
        initial=$(printf '%s' "${label:0:1}" | tr '[:lower:]' '[:upper:]')
        printf '<span class="glyph initial"%s aria-hidden="true">%s</span>' "$vt" "$(html_escape "$initial")"
    fi
}

# Fallbacks for items without a label: the text before ": " in the title.
derive_label() {
    local title=$1
    if [[ "$title" == *": "* ]]; then printf '%s' "${title%%: *}"; else printf '%s' "$title"; fi
}

derive_line() {
    local title=$1
    if [[ "$title" == *": "* ]]; then printf '%s' "${title#*: }"; else printf '%s' "$title"; fi
}

# A side project's own site or repo: link: from frontmatter, else the first
# body link whose text is the project's label. Empty when neither exists.
project_link() {
    local folder=$1 label=$2 match text
    if [ -n "$fm_link" ]; then printf '%s' "$fm_link"; return; fi
    while IFS= read -r match; do
        text=${match#\[}; text=${text%%\]*}
        if [ "$text" = "$label" ]; then
            match=${match#*\(}
            printf '%s' "${match%\)}"
            return
        fi
    done < <(strip_frontmatter "$folder/_.md" | strip_comments | grep -o '\[[^]]*\]([^)]*)')
}

# Side projects show a platform in the last column: the first tag that
# names one. Empty when none does.
derive_medium() {
    local IFS=',' tag
    for tag in $1; do
        case "$tag" in
            macOS|iOS|Figma|Desktop|Tauri) printf '%s' "$tag"; return ;;
            Hammerspoon) printf 'macOS'; return ;;
            Browser|JavaScript|WebRTC) printf 'Web'; return ;;
            "Google Apps Script") printf 'Gmail'; return ;;
        esac
    done
}

# One <li> in the ledger: Year · Glyph · Name · Line · Role (or Medium).
# A year equal to the row above's gets class="repeat" (hidden by CSS).
render_ledger_row() {
    local folder=$1
    local href=$2
    local last=$3
    local prev_year=$4
    local vt=$5
    local slug image_file line year repeat=""
    slug=$(basename "$folder")
    image_file=$(find_item_image "$folder")
    load_fm "$folder"
    year=${fm_date%%-*}
    line=${fm_summary:-$(derive_line "$fm_title")}
    [ -n "$year" ] && [ "$year" = "$prev_year" ] && repeat=' class="repeat"'

    echo "  > Processing: $fm_label" >&2

    printf '<li id="%s"%s><a class="row" href="%s">' "$slug" "$repeat" "$(html_escape "$href")"
    printf '<time class="yr" datetime="%s">%s</time>' "$fm_date" "$year"
    render_glyph "$image_file" "$fm_label" "$vt"
    printf '<span class="name">%s</span>' "$(html_escape "$fm_label")"
    printf '<span class="line">%s</span>' "$(html_escape "$line")"
    printf '<span class="role">%s</span>' "$(html_escape "$last")"
    printf '</a></li>\n'
}

# Oldest and newest year among the folders' dates, space-separated.
# Undated folders are ignored; prints nothing when none is dated.
year_span() {
    local folder year oldest="" newest=""
    for folder in "$@"; do
        load_fm "$folder"
        year=${fm_date%%-*}
        [[ "$year" =~ ^[0-9]{4}$ ]] || continue
        if [ -z "$oldest" ] || [ "$year" -lt "$oldest" ]; then oldest=$year; fi
        if [ -z "$newest" ] || [ "$year" -gt "$newest" ]; then newest=$year; fi
    done
    [ -n "$oldest" ] && printf '%s %s\n' "$oldest" "$newest"
    return 0
}

# One ledger group: heading, count, column header, rows. `key` is
# "client" or "side"; either way a row opens its page at work/<slug>/.
render_group() {
    local key=$1
    local heading=$2
    local last_col=$3
    shift 3
    local folder href last prev_year="" year vt

    printf '<section class="group" aria-labelledby="g-%s">\n' "$key"
    if [ "$key" = "side" ]; then
        # Side projects state their own span and count in the heading.
        local from to
        read -r from to < <(year_span "$@")
        [ -n "$from" ] && heading+=", $from"
        [ -n "$to" ] && [ "$to" != "$from" ] && heading+="&ndash;$to"
        printf '<div class="group-head"><h2 id="g-%s">%s &middot; %d</h2></div>\n' "$key" "$heading" $#
    else
        printf '<div class="group-head"><h2 id="g-%s">%s</h2><span class="count">%02d</span></div>\n' "$key" "$heading" $#
    fi
    printf '<div class="cols" aria-hidden="true"><span>Year</span><span></span><span>Name</span><span>Line</span><span>%s</span></div>\n' "$last_col"
    echo '<ol class="ledger">'
    for folder in "$@"; do
        load_fm "$folder"
        year=${fm_date%%-*}
        href="work/$(basename "$folder")/"
        vt="g-$(basename "$folder")"
        if [ "$key" = "client" ]; then
            last=$fm_role
        else
            last=${fm_role:-$(derive_medium "$fm_tags")}
        fi
        render_ledger_row "$folder" "$href" "$last" "$prev_year" "$vt"
        prev_year=$year
    done
    echo '</ol>'
    echo '</section>'
}

# Contact links from the profile: LinkedIn and GitHub from its "Find me
# elsewhere" list, plus email: from its frontmatter when set. Prints one
# line of links separated by " &middot; ", or nothing.
contact_links() {
    local text url out="" want
    [ -n "$profile" ] || return 0
    for want in LinkedIn GitHub; do
        while IFS=$FS read -r text url; do
            if [ "$text" = "$want" ]; then
                [ -n "$out" ] && out+=" &middot; "
                out+="<a href=\"$(html_escape "$url")\">$want&nbsp;&#8599;</a>"
                break
            fi
        done < <(strip_frontmatter "$profile/_.md" | awk '
            /^## / { on = ($0 == "## Find me elsewhere"); next }
            on && /^- \[[^]]+\]\([^)]+\)/ {
                t = $0; sub(/^- \[/, "", t); sub(/\]\(.*$/, "", t)
                u = $0; sub(/^[^(]*\(/, "", u); sub(/\).*$/, "", u)
                printf "%s\037%s\n", t, u
            }')
    done
    load_fm "$profile"
    if [ -n "$fm_email" ]; then
        [ -n "$out" ] && out+=" &middot; "
        out+="<a href=\"mailto:$(html_escape "$fm_email")\">$(html_escape "$fm_email")</a>"
    fi
    printf '%s' "$out"
}

# The profile's first plain paragraph: the ledger's lead, and the
# description the ledger and About share. Empty without a profile.
profile_lead() {
    [ -n "$profile" ] || return 0
    strip_frontmatter "$profile/_.md" | awk '
        /^[[:space:]]*$/ || /^[#<>\[*-]/ || /^(METRICS|EMBED|CTA):/ { next }
        { print; exit }'
}

# The ledger's header, from the profile section: its first paragraph as
# the lead and its italic availability line, plus the years on the ledger.
render_intro() {
    local first=$1
    local last=$2
    local lead="" avail="" links
    if [ -n "$profile" ]; then
        lead=$(profile_lead)
        avail=$(strip_frontmatter "$profile/_.md" | awk '/^\*[^*].*\*$/ { print substr($0, 2, length($0) - 2); exit }')
    fi
    [ -z "$lead" ] && lead=$AUTHOR
    links=$(contact_links)

    echo '<header class="intro">'
    printf '<p class="mast"><span><a class="home" href="./">%s</a> &middot; Product designer</span> <span class="meta">Work, %s&ndash;%s</span></p>\n' \
        "$(html_escape "$AUTHOR")" "$first" "$last"
    printf '<h1 class="lead">%s</h1>\n' "$(html_escape "$lead")"
    if [ -n "$profile" ]; then
        printf '<p class="avail">%s <a href="work/%s/">About &rarr;</a>%s</p>\n' \
            "$(html_escape "$avail")" "$(basename "$profile")" "${links:+ &middot; $links}"
    fi
    echo '</header>'
}

# Closing footer: the same contact links, so the skim ends on a next step.
render_contact_footer() {
    local links
    links=$(contact_links)
    [ -n "$links" ] || return 0
    printf '<footer class="contact"><h2 class="label">Get in touch</h2><p>%s</p></footer>\n' "$links"
}

# Items (side projects on the profile) as a compact, anchored list: glyph,
# name linking to the item's own page, year and question, its one line.
# Screens, diagrams and the full body live on that page.
render_items() {
    local dir=$1
    local heading=$2
    local item slug image_file question
    local -a items=()
    while IFS= read -r item; do
        items+=("$item")
    done < <(sort_folders "$dir"/*/)
    [ ${#items[@]} -gt 0 ] || return 0

    printf '<section class="part items"><h2 class="label">%s</h2><div class="body">\n' "$heading"
    for item in "${items[@]}"; do
        slug=$(basename "$item")
        image_file=$(find_item_image "$item")
        load_fm "$item"
        printf '<article class="item" id="%s">\n' "$slug"
        if [ -n "$image_file" ]; then
            printf '<span class="glyph%s">%s</span>\n' "${fm_glyph:+ $fm_glyph}" "$(insert_image "$image_file" "")"
        fi
        question=""
        if [[ "$fm_title" == *": "* ]]; then
            question=$(derive_line "$fm_title")
        elif [ "$fm_title" != "$fm_label" ]; then
            question=$fm_title
        fi
        printf '<h3><a href="../%s/">%s</a></h3>\n' "$slug" "$(html_escape "$fm_label")"
        printf '<p class="item-meta"><time datetime="%s">%s</time> %s</p>\n' \
            "$fm_date" "${fm_date%%-*}" "$(html_escape "$question")"
        [ -n "$fm_summary" ] && printf '<p class="item-line">%s</p>\n' "$(html_escape "$fm_summary")"
        printf '</article>\n'
    done
    echo '</div></section>'
}

# Shared <head> for the ledger and the case pages. `root` is the relative
# path back to the site root ("" or "../../"), so assets resolve from
# any depth, even over file://. `path` is the page's URL below SITE_URL.
page_head() {
    local title=$1
    local description=$2
    local path=$3
    local root=$4
    local og_title=${5:-$1}
    local og_type=${6:-website}
    local url="$SITE_URL/$path"
    local css
    css=$(cat "$CSS_FILE")
    css=${css//url(\"fonts\//url(\"${root}fonts\/}

    cat <<EOF
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$(html_escape "$title")</title>
    <meta name="description" content="$(html_escape "$description")">
EOF
    if [ -n "$SITE_URL" ]; then
        cat <<EOF
    <link rel="canonical" href="$url">
    <meta property="og:type" content="$og_type">
    <meta property="og:site_name" content="$(html_escape "$AUTHOR")">
    <meta property="og:title" content="$(html_escape "$og_title")">
    <meta property="og:description" content="$(html_escape "$description")">
    <meta property="og:url" content="$url">
    <meta property="og:image" content="$SITE_URL/og.png">
    <meta property="og:image:alt" content="$(html_escape "$og_title")">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="$SITE_URL/og.png">
EOF
    fi
    # The one font file: fetched with the HTML, not after the CSS parses.
    if [ -f "$OUT_DIR/fonts/InterVariable.woff2" ]; then
        echo "    <link rel=\"preload\" href=\"${root}fonts/InterVariable.woff2\" as=\"font\" type=\"font/woff2\" crossorigin>"
    fi
    if [ -f "$OUT_DIR/favicon.svg" ]; then
        echo "    <link rel=\"icon\" href=\"${root}favicon.svg\" type=\"image/svg+xml\">"
    fi
    cat <<EOF
    <style>
    $css
    </style>
EOF
    # script.js is an optional enhancement: inlined only when it has
    # content, in the head so the accent is set before first paint.
    if [ -s "$JS_FILE" ]; then
        printf '    <script>\n%s\n    </script>\n' "$(cat "$JS_FILE")"
    fi
    echo "</head>"
}

# Pager for case pages. Follows the page's group in ledger order (the
# pager_folders global: client work or side projects): prev is the row
# above (newer), next the row below (older), each with its ledger line.
# No wrap-around: an end slot leads back to the ledger instead.
render_prev_next() {
    local idx=$1
    local count=${#pager_folders[@]}
    local slug other
    slug=$(basename "${pager_folders[$idx]}")

    echo "<nav class=\"pn\" aria-label=\"More work\">"
    if [ "$idx" -gt 0 ]; then
        other=${pager_folders[$((idx - 1))]}
        load_fm "$other"
        printf '  <a rel="prev" href="../%s/"><span class="label">&larr; Newer, %s</span> <span class="pn-name">%s</span> <span class="pn-line">%s</span></a>\n' \
            "$(basename "$other")" "${fm_date%%-*}" "$(html_escape "$fm_label")" "$(html_escape "$fm_summary")"
    else
        printf '  <a class="pn-all" href="../../works.html#%s"><span class="label">Start of the list</span> <span class="pn-name">&larr; All work</span></a>\n' "$slug"
    fi
    if [ "$idx" -lt $((count - 1)) ]; then
        other=${pager_folders[$((idx + 1))]}
        load_fm "$other"
        printf '  <a rel="next" href="../%s/"><span class="label">Older, %s &rarr;</span> <span class="pn-name">%s</span> <span class="pn-line">%s</span></a>\n' \
            "$(basename "$other")" "${fm_date%%-*}" "$(html_escape "$fm_label")" "$(html_escape "$fm_summary")"
    else
        printf '  <a class="pn-all pn-end" href="../../works.html#%s"><span class="label">End of the list</span> <span class="pn-name">&larr; All work</span></a>\n' "$slug"
    fi
    echo "</nav>"
}

# One standalone page per section or side project, at work/<slug>/index.html.
# `idx` is its place in pager_folders; -1 for the profile, which gets no
# position or pager. `kind` is "case" or "side" (see render_case_head).
write_case_page() {
    local folder=$1
    local idx=$2
    local items_heading=$3
    local kind=${4:-case}
    local slug content_file="$folder/_.md"
    local position="" body figures items="" cta
    slug=$(basename "$folder")
    if [ "$idx" -ge 0 ]; then
        position=" <span class=\"count\">$(printf '%02d / %02d' $((idx + 1)) ${#pager_folders[@]})</span>"
    fi
    body=$(render_markdown_content "$content_file" page)
    figures=$(render_markdown_content "$content_file" metrics)
    cta=$(case_cta "$content_file")
    if [ -d "$folder/items" ]; then
        items=$(render_items "$folder/items" "$items_heading")
    fi

    load_fm "$folder"
    # About has no summary line: its lead describes it instead.
    [ "$fm_kind" = profile ] && [ -z "$fm_summary" ] && fm_summary=$(profile_lead)
    mkdir -p "$WORK_DIR/$slug"
    {
    echo "<!DOCTYPE html>"
    echo "<html lang=\"en\">"
    page_head "$fm_title / $AUTHOR" "${fm_summary:-$fm_title}" "work/$slug/" "../../" "$fm_title" article
    cat <<EOF
<body>
<a class="skip" href="#main-content">Skip to content</a>
<nav class="mast"><a class="back" href="../../works.html#$slug">&larr; All work</a>$position</nav>
<main id="main-content">
EOF
    [ "$fm_kind" = profile ] && fm_summary=""
    render_case_head "$folder" "$kind"
    if [ -n "$figures" ]; then
        printf '<section class="figures"><h2 class="label">Impact</h2>%s</section>\n' "$figures"
    fi
    rebase_paths "$body"
    echo
    if [ -n "$items" ]; then
        rebase_paths "$items"
        echo
    fi
    [ -n "$cta" ] && echo "$cta"
    echo "</main>"
    if [ "$idx" -ge 0 ]; then
        render_prev_next "$idx"
    fi
    cat <<EOF
</body>
</html>
EOF
    } > "$WORK_DIR/$slug/index.html"
}


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

shopt -s nullglob

# Check every slug before writing anything. Sections and their items share
# one namespace, because both become URLs and #anchors.
seen_slugs=" "
for folder in "$CONTENT_DIR"*/ "$CONTENT_DIR"*/items/*/; do
    [ -f "$folder/_.md" ] || continue
    slug=$(slug_of "${folder%/}") || exit 1
    case "$folder" in
        */items/*/) ;;
        *) require_fields "$folder/_.md" || exit 1 ;;
    esac
    load_fm "${folder%/}"
    check_glyph "$(find_item_image "${folder%/}")" "$slug" "$fm_glyph"
    case "$seen_slugs" in
        *" $slug "*) friendly_message "Build stopped: duplicate slug '$slug'" "Rename one of the folders called $slug."; exit 1 ;;
    esac
    seen_slugs+="$slug "
done

# Remove old case pages so a deleted or renamed section leaves nothing
# behind. Scoped to "$OUT_DIR/work", never anything wider.
rm -rf -- "$WORK_DIR"

echo "Building sections..."

# One sorted list per group feeds the ledger and the pager, so they can't
# disagree. The first kind: profile section is About: it gets no row, it
# heads the ledger, and its items are the side projects.
profile=""
declare -a cases=()
for folder in "$CONTENT_DIR"*/; do
    folder=${folder%/}
    [ -f "$folder/_.md" ] || continue
    load_fm "$folder"
    if [ "$fm_kind" = "profile" ] && [ -z "$profile" ]; then
        profile=$folder
    else
        cases+=("$folder")
    fi
done

declare -a sorted_folders=() side_folders=()
while IFS= read -r folder; do
    sorted_folders+=("$folder")
done < <(sort_folders "${cases[@]}")
if [ -n "$profile" ]; then
    while IFS= read -r folder; do
        side_folders+=("$folder")
    done < <(sort_folders "$profile"/items/*/)
fi

pager_folders=("${sorted_folders[@]}")
i=0
for folder in "${sorted_folders[@]}"; do
    write_case_page "$folder" "$i" "Also"
    i=$((i + 1))
done
if [ -n "$profile" ]; then
    write_case_page "$profile" -1 "Side projects"
fi
# Every side project gets the same shell, with a pager of its own.
pager_folders=("${side_folders[@]}")
i=0
for folder in "${side_folders[@]}"; do
    write_case_page "$folder" "$i" "" side
    i=$((i + 1))
done

# Year span of everything on the ledger, client work and side projects.
read -r oldest newest < <(year_span "${sorted_folders[@]}" "${side_folders[@]}")

echo "Assembling $OUTPUT_FILE..."

{
echo "<!DOCTYPE html>"
echo "<html lang=\"en\">"
ledger_lead=$(profile_lead)
page_head "$TITLE" "${ledger_lead:-$TITLE - Portfolio}" "$(basename "$OUTPUT_FILE")" ""
echo "<body>"
echo '<a class="skip" href="#main-content">Skip to content</a>'
echo "<main id=\"main-content\">"
render_intro "$oldest" "$newest"
render_group client "Client work" "Role" "${sorted_folders[@]}"
if [ ${#side_folders[@]} -gt 0 ]; then
    render_group side "Side projects" "Medium" "${side_folders[@]}"
fi
render_contact_footer
echo "</main>"
cat <<EOF
</body>
</html>
EOF
} > "$OUTPUT_FILE"

echo "LineAndForm is done!"
full_path=$(cd "$(dirname "$OUTPUT_FILE")" || exit; pwd)/$(basename "$OUTPUT_FILE")
echo "Open \"$full_path\" in a web browser to see your work."

if $SELF_DESTRUCT; then
    rm -- "$0"
    echo "Self-destructed."
fi

#!/bin/bash

# ◯┃ LineAndForm (L+F)
# Builds a portfolio site from a folder of markdown.

# Usage: ./build.sh [-d]
#   -d deletes this script after the build (also SELF_DESTRUCT in config).

# Config (config.cfg):
#   CONTENT_DIR, OUTPUT_FILE, TITLE, CSS_FILE, JS_FILE, INLINE_SVG, SELF_DESTRUCT.
#   SITE_URL builds canonical and og: links; skipped when empty.
#   AUTHOR signs page titles; defaults to TITLE.
#   styles.css is required. script.js is inlined when non-empty.
#   motion.js and egg.js, when present, are linked deferred from every page.

# Content:
#   One folder per case under the content folder. The folder name is the
#   slug and URL: lowercase letters, digits and dashes.
#   _.md starts with frontmatter. Required: label, role, summary.
#   Optional: title, date (YYYY-MM-DD), tags, client, link, order, and
#   featured: N to head works.html, smallest N first. Field list below.
#   _.svg, _.png or _.jpg is the glyph; without one the label's initial
#   stands in. SVG glyphs use a 100x100 viewBox and black fills only, with
#   no text, <style> or animation (the build warns). An optional
#   _.parts.svg lists the shapes that XOR into the glyph, for motion.js.
#   One folder with kind: profile is the About page. Its items/ folder
#   holds side projects, one subfolder each, with their own pages.

# Body syntax:
#   ## heading           starts a part of the page
#   METRICS:             a list of "- **value** label" lines, the Impact band
#   [text](url)          alone before the first heading: the spec's Link
#   CTA: ...             the closing row above the pager
#   EMBED: ...           raw HTML passed through (video, iframe)
#   ![alt](f.png "cap")  alone on a line: a captioned screen
#   DIAGRAM: f.svg "cap" an inlined, captioned SVG diagram
#   TOY: name            right after a DIAGRAM line: mounts toys/name.js
#   Paths resolve from the .md's folder.

# Front page (optional): contents/front.md. Format above FRONT_FILE.
#   Without it, the profile's first paragraph is the h1. works.html links
#   front.js when front.md has offers, foot.js when there is a profile.

# Output:
#   works.html: the front page, featured cases, the rest of client work
#   as one "Also" sentence (newest first), How I work and the signature.
#   With no case featured, client work is one dated ledger. Side projects
#   are listed on the About page, not here.
#   work/<slug>/index.html: one page per case, side project and About,
#   with prev/next in ledger order. work/ is rebuilt every run.

# License:
# THE UNRESTRICTED BUT RESPONSIBLY SHARED, ALTERED AND DISTRIBUTED SOFTWARE WITHOUT WARRANTIES AND WITH THE ABSENCE OF LIABILITY FOR ANY UNINTENDED CONSEQUENCES LICENSE (VERSION 1.0, AUGUST 4, 2023)
#
# Use it, change it, share it - but keep it under this license. No promises, no liability. Enjoy.


# ─────────────────────────────────────────────────────────────
# Config and CLI
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

SITE_URL=${SITE_URL%/}
AUTHOR=${AUTHOR:-$TITLE}

DEFAULT_ORDER=9999

# Field separator for parse_frontmatter. Not whitespace, so `read` keeps
# empty fields in place instead of collapsing them.
FS=$'\037'

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
# Read: frontmatter, content, escaping
# ─────────────────────────────────────────────────────────────

html_escape() {
    local s=$1
    s=${s//&/&amp;}
    s=${s//</&lt;}
    s=${s//>/&gt;}
    s=${s//\"/&quot;}
    printf '%s' "$s"
}

# Frontmatter fields, in the order parse_frontmatter emits them:
#   title     page h1; label falls back to its text before ": "
#   date      YYYY-MM-DD; sorts newest first
#   tags      comma list; the spec's Scope row
#   order     breaks date ties; side projects with one sort first
#   label     short name for the ledger, prev/next and <title>
#   client    shown on the case page; defaults to label
#   role      the role on the project; the ledger's last column
#   summary   one plain line: ledger line, dek and meta description
#   link      the project's own site or repo
#   kind      "profile" marks the About page; anything else is a case
#   email     profile only: a mailto link in the site links and signature
#   glyph     "colour" keeps a colour glyph and skips the glyph check
#   repo      side projects: the spec's Code row
#   featured  client cases: a positive number; the rest go to Also
# Cases must set label, role and summary (see require_fields).

# Emits the fields above, $FS-separated; missing ones are empty.
parse_frontmatter() {
    awk '
    BEGIN { n = split("title date tags order label client role summary link kind email glyph repo featured", keys, " ") }
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

# Sets the fm_* globals from a folder's frontmatter, with fallbacks filled.
load_fm() {
    local folder=$1
    IFS=$FS read -r fm_title fm_date fm_tags fm_order fm_label fm_client fm_role fm_summary fm_link fm_kind fm_email fm_glyph fm_repo fm_featured \
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

# The folder's basename becomes a URL and an #anchor, so only a plain
# lowercase segment passes.
slug_of() {
    local slug
    slug=$(basename "$1")
    if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
        friendly_message "Invalid slug: $1" "Folder names must match ^[a-z0-9][a-z0-9-]*\$ (they become URLs)." >&2
        return 1
    fi
    printf '%s' "$slug"
}

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

# Black fills only, because the dark-mode invert depends on it. An
# off-system glyph still renders, with a warning.
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

# "width height" of a PNG, GIF or JPEG, read from its header with od so
# no image tools are needed. Prints nothing when unknown.
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

# A screen figure carries its pixel size so the page doesn't jump while it
# loads. Reads render_markdown_content's locals (file, mode, and screens,
# already counting this one), since it runs in $().
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
        local max=5
        [[ "$file" == */items/* ]] && max=3
        [ "$screens" = $((max + 1)) ] && echo "warn: $file: more than $max screens" >&2
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
    # Composites exported wider than any single screen break out of the
    # text column (styles.css).
    [ -n "$w" ] && [ "$w" -gt 1600 ] && cls="screen wide"
    printf '<figure class="%s"><img src="%s" alt="%s" loading="lazy"%s>%s</figure>' \
        "$cls" "$(html_escape "$src")" "$(html_escape "$alt")" "${w:+ width=\"$w\" height=\"$h\"}" \
        "${caption:+<figcaption>$(html_escape "$caption")</figcaption>}"
}

# Diagrams are inlined, not linked, so they take the page's font and
# currentColor and follow dark mode. Off-spec drawings warn.
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
# Transform: markdown to HTML
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

# A part left empty (a "Results" that only held METRICS) is dropped.
# Uses render_markdown_content's locals through bash's dynamic scope.
flush_part() {
    local body=${content:$part_start}
    content=${content:0:$part_start}
    [ -n "$body" ] || return 0
    if [ -n "$part_label" ]; then
        content+="<section class=\"part\"><h2>$part_label</h2><div class=\"body\">$body</div></section>"
    else
        content+="<section class=\"part part-lead\"><div class=\"body\">$body</div></section>"
    fi
}

# Only quantities get big-number styling. "Real-time" or "Finalist" may
# be true, but they aren't figures.
is_quantity() {
    case "$1" in
        [0-9~\<\>+\$]*|±*) return 0 ;;
    esac
    return 1
}

# Non-quantities are listed under the figures grid. Uses
# render_markdown_content's locals, like flush_part.
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
# what follows in a part and leaves METRICS out. "metrics" renders only
# the METRICS blocks, for the figures band.
render_markdown_content() {
    local file=$1
    local mode=${2:-}
    local content="" metrics="" notes="" line parsed_line escaped_line after
    local in_paragraph=false in_list=false in_metrics=false in_code_block=false in_comment=false
    local metric_line value label
    local part_start=0 part_label="" hoisted=false screens=0 fig lone_at=-1 lone_end=-1
    local diagram_at=-1 diagram_end=-1 toy
    local diagram_open='<figure class="diagram">'
    local link_re='^\[[^]]+\]\([^)]+\)$'
    local screen_re='^!\[([^]]*)\]\(([^ )]+)( "(([^"\\]|\\.)*)")?\)[[:space:]]*$'
    local figma_embed_re='src="(https://embed\.figma\.com/[^"]*)"'
    local idless_embed_re='src="[^"]*youtube(\.googleapis)?\.com/embed/?(\?|")'

    while IFS= read -r line || [ -n "$line" ]; do
        # HTML comments never render, even across lines.
        if $in_comment; then
            [[ "$line" == *"-->"* ]] || continue
            line=${line#*-->}
            in_comment=false
            [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        fi

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

        # A comment-only line is dropped without closing the paragraph
        # around it.
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

        # A Figma embed weighs megabytes, so it waits behind a link that
        # script.js swaps for the iframe on click. Without JS it opens Figma.
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

        if [[ "$line" == "METRICS:" ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            metrics+="<div class=\"metrics-grid\">"
            in_metrics=true
            continue
        fi

        # Any non-list line closes the block and falls through, so content
        # isn't swallowed when no blank line ends it.
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

        if [[ "$line" == "DIAGRAM:"* ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            after=${line#DIAGRAM:}
            after=${after#"${after%%[![:space:]]*}"}
            diagram_at=${#content}
            content+=$(render_diagram "$after")
            diagram_end=${#content}
            continue
        fi

        # The figure only gets the toy's name; toy_scripts loads the script.
        if [[ "$line" == "TOY:"* ]]; then
            toy=${line#TOY:}
            toy=${toy//[[:space:]]/}
            if [ "$diagram_at" -ge 0 ] && [ "$diagram_end" = "${#content}" ] \
                && [ "${content:diagram_at:${#diagram_open}}" = "$diagram_open" ]; then
                content="${content:0:diagram_at}<figure class=\"diagram\" data-toy=\"$(html_escape "$toy")\">${content:$((diagram_at + ${#diagram_open}))}"
                if [ "$mode" != metrics ] && [ ! -f "$OUT_DIR/toys/$toy.js" ]; then
                    echo "warn: $file: toy $toy not found" >&2
                fi
            elif [ "$mode" != metrics ]; then
                echo "warn: $file: toy $toy is not right after a diagram" >&2
            fi
            continue
        fi

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

# The first "CTA:" line. A LinkedIn link gets an aria-label so a screen
# reader hears where it goes ("Let's talk on LinkedIn").
case_cta() {
    local line text
    line=$(strip_frontmatter "$1" | grep -m 1 '^CTA:' || true)
    [ -n "$line" ] || return 0
    text=$(parse_markdown "$(printf '%s' "${line#CTA:}" | sed -E 's/^[[:space:]]+//')")
    text=$(printf '%s' "$text" | sed -E 's|<a href="(https://[a-z.]*linkedin\.com/[^"]*)">([^<]*)</a>|<a href="\1" aria-label="\2 on LinkedIn">\2</a>|g')
    printf '<p class="case-cta">%s</p>\n' "$text"
}

toy_scripts() {
    local name
    strip_frontmatter "$1" | strip_comments | awk '/^TOY:/ { sub(/^TOY:[[:space:]]*/, ""); sub(/[[:space:]]+$/, ""); if (!seen[$0]++) print }' \
        | while IFS= read -r name; do
            [[ "$name" =~ ^[a-z0-9-]+$ ]] && [ -f "$OUT_DIR/toys/$name.js" ] || continue
            printf '<script type="module" src="../../toys/%s.js"></script>\n' "$name"
        done
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
# Emit: pages and the ledger
# ─────────────────────────────────────────────────────────────

# The Year row shows the year alone: a month reads as false precision on
# a multi-month project. Empty or malformed dates return empty.
format_year() {
    [[ "$1" =~ ^([0-9]{4})-[0-9]{2} ]] && printf '%s' "${BASH_REMATCH[1]}"
    return 0
}

# The lone "[text](url)" line before the first ## heading. Prints
# text$FS url, or nothing.
lead_link() {
    strip_frontmatter "$1" | strip_comments | awk '
        /^## / { exit }
        /^\[[^]]+\]\([^)]+\)$/ {
            t = $0; sub(/^\[/, "", t); sub(/\]\(.*$/, "", t)
            u = substr($0, index($0, "](") + 2); sub(/\)$/, "", u)
            printf "%s\037%s", t, u; exit
        }'
}

# Removes HTML comments, even across lines, so a link inside one is never
# taken for the page's link.
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

# A URL as readable link text: no scheme, "www." or trailing slash.
display_url() {
    local u=${1#*://}
    u=${u#www.}
    printf '%s' "${u%/}"
}

# Uses the fm_* globals. A side project (kind "side") has no Client row,
# shows Medium instead of Role, and its links read as the address they open.
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
        render_glyph "$image_file" "$fm_label" "" parts
    else
        render_glyph "$image_file" "$fm_label" "g-$(basename "$folder")" parts
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

# Newest first, then order:, then slug. Undated folders sort last.
sort_folders() {
    local folder
    for folder in "$@"; do
        folder=${folder%/}
        [ -f "$folder/_.md" ] || continue
        load_fm "$folder"
        printf '%s|%s|%s|%s\n' "$fm_date" "$fm_order" "$(basename "$folder")" "$folder"
    done | LC_ALL=C sort -t'|' -k1,1r -k2,2n -k3,3 | cut -d'|' -f4-
}

# Side projects: the ones given an order: come first, in that order; the
# rest follow newest first, then by slug.
sort_items() {
    local folder
    for folder in "$@"; do
        folder=${folder%/}
        [ -f "$folder/_.md" ] || continue
        load_fm "$folder"
        printf '%s|%s|%s|%s\n' "$fm_order" "$fm_date" "$(basename "$folder")" "$folder"
    done | LC_ALL=C sort -t'|' -k1,1n -k2,2r -k3,3 | cut -d'|' -f4-
}

# Without an image, the label's initial fills the cell so the column has
# no holes. The view-transition name lets the glyph fly from its row to
# its page. "parts" adds _.parts.svg for motion.js (spec glyph only).
render_glyph() {
    local image_file=$1 label=$2 vt=${3:+ style=\"view-transition-name: $3\"} initial cls=glyph parts=""
    [ "$fm_glyph" = colour ] && cls="glyph colour"
    if [ "${4:-}" = parts ] && [[ "$image_file" == *.svg ]] && [ -f "${image_file%.svg}.parts.svg" ]; then
        parts=" data-parts=\"$(base64 < "${image_file%.svg}.parts.svg" | tr -d '\n')\""
    fi
    if [ -n "$image_file" ] && [ -f "$image_file" ]; then
        printf '<span class="%s"%s%s>%s</span>' "$cls" "$vt" "$parts" "$(insert_image "$image_file" "" | tr -d '\n')"
    else
        initial=$(printf '%s' "${label:0:1}" | tr '[:lower:]' '[:upper:]')
        printf '<span class="glyph initial"%s aria-hidden="true">%s</span>' "$vt" "$(html_escape "$initial")"
    fi
}

# A title "Label: line" splits at the first ": ".
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
            Gmail|"Google Apps Script") printf 'Gmail'; return ;;
        esac
    done
}

# A year equal to the row above's gets class="repeat", hidden by CSS.
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

# No role or year on featured rows: the case page holds those facts.
render_featured_row() {
    local folder=$1 slug image_file
    slug=$(basename "$folder")
    image_file=$(find_item_image "$folder")
    load_fm "$folder"
    echo "  > Processing: $fm_label (featured)" >&2
    printf '<li id="%s"><a class="row" href="work/%s/">' "$slug" "$slug"
    render_glyph "$image_file" "$fm_label" "g-$slug"
    printf '<span class="name">%s</span>' "$(html_escape "$fm_label")"
    printf '<span class="line">%s</span>' "$(html_escape "${fm_summary:-$(derive_line "$fm_title")}")"
    printf '</a></li>\n'
}

render_featured() {
    printf '<section class="group" aria-labelledby="g-client">\n'
    printf '<div class="group-head"><h2 id="g-client">Client work</h2></div>\n'
    echo '<ol class="ledger featured">'
    local folder
    for folder in "$@"; do
        render_featured_row "$folder"
    done
    echo '</ol>'
    echo '</section>'
}

# Inlined, not an <img>, so it takes the text colour and script.js can
# fit its box to the ink. Colour glyphs keep their fills.
render_also_glyph() {
    local image_file=$1 label=$2 vt=$3 svg vb inner
    if [[ "$image_file" == *.svg ]] && [ -f "$image_file" ]; then
        svg=$(tr -d '\n' < "$image_file")
        vb=$(printf '%s' "${svg%%>*}" | grep -o 'viewBox="[^"]*"' || true)
        inner=${svg#*<svg}
        inner=${inner#*>}
        inner=${inner%</svg>*}
        inner=${inner// style=\"mix-blend-mode:multiply\"/}
        [ "$fm_glyph" = colour ] || inner=$(printf '%s' "$inner" | sed -E 's/fill="(black|#000|#000000)"/fill="currentColor"/g')
        printf '<span class="ag" aria-hidden="true"><svg %s style="view-transition-name: %s">%s</svg></span>' \
            "${vb:-viewBox=\"0 0 100 100\"}" "$vt" "$inner"
    elif [ -n "$image_file" ] && [ -f "$image_file" ]; then
        printf '<span class="ag" aria-hidden="true" style="view-transition-name: %s">%s</span>' "$vt" "$(insert_image "$image_file" "" | tr -d '\n')"
    else
        printf '<span class="ag initial" aria-hidden="true" style="view-transition-name: %s">%s</span>' \
            "$vt" "$(html_escape "$(printf '%s' "${label:0:1}" | tr '[:lower:]' '[:upper:]')")"
    fi
}

# The other client cases as one sentence. The role sits inside each link
# for screen readers and is never shown on screen.
render_also() {
    local n=$# i=0 folder slug label year role tail
    printf '<section class="group also" aria-labelledby="g-also">\n'
    printf '<div class="group-head"><h2 id="g-also">Also</h2></div>\n'
    printf '<p class="run">'
    for folder in "$@"; do
        i=$((i + 1))
        slug=$(basename "$folder")
        load_fm "$folder"
        echo "  > Processing: $fm_label (also)" >&2
        label=${fm_label:-$(derive_label "$fm_title")}
        year=${fm_date%%-*}
        tail=,
        [ "$i" -eq $((n - 1)) ] && tail=""
        [ "$i" -eq "$n" ] && tail=.
        [ "$i" -gt 1 ] && printf ' '
        printf '<span class="it" id="%s">' "$slug"
        [ "$i" -eq "$n" ] && [ "$n" -gt 1 ] && printf '<span class="and">and</span>&nbsp;'
        printf '<a href="work/%s/">' "$slug"
        render_also_glyph "$(find_item_image "$folder")" "$label" "g-$slug"
        printf '<span class="nm" data-t="%s">%s' "$(html_escape "$label")" "$(html_escape "$label")"
        [ -n "$fm_role" ] && printf '<span class="rl"> %s</span>' "$(html_escape "$fm_role")"
        printf '</span>'
        [ -n "$year" ] && printf ' <time class="yr" datetime="%s">%s</time>' "$fm_date" "$year"
        printf '</a>%s</span>' "$tail"
    done
    printf '</p>\n</section>\n'
}

# "oldest newest" year among the folders. Prints nothing when none is dated.
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

# `key` is "client" or "side".
render_group() {
    local key=$1
    local heading=$2
    shift 2
    local folder href last prev_year="" year vt

    printf '<section class="group" aria-labelledby="g-%s">\n' "$key"
    if [ "$key" = "side" ]; then
        local from to
        read -r from to < <(year_span "$@")
        [ -n "$from" ] && heading+=", $from"
        [ -n "$to" ] && [ "$to" != "$from" ] && heading+="&ndash;$to"
    fi
    printf '<div class="group-head"><h2 id="g-%s">%s</h2></div>\n' "$key" "$heading"
    echo '<ol class="ledger">'
    for folder in "$@"; do
        load_fm "$folder"
        year=${fm_date%%-*}
        href="work/$(basename "$folder")/"
        vt="g-$(basename "$folder")"
        if [ "$key" = "side" ]; then
            last=${fm_role:-$(derive_medium "$fm_tags")}
        else
            last=$fm_role
        fi
        render_ledger_row "$folder" "$href" "$last" "$prev_year" "$vt"
        prev_year=$year
    done
    echo '</ol>'
    echo '</section>'
}

# A URL from the profile's "Find me elsewhere" list, by its link text.
profile_link() {
    local want=$1 text url
    [ -n "$profile" ] || return 0
    while IFS=$FS read -r text url; do
        if [ "$text" = "$want" ]; then printf '%s' "$url"; return 0; fi
    done < <(strip_frontmatter "$profile/_.md" | awk '
        /^## / { on = ($0 == "## Find me elsewhere"); next }
        on && /^- \[[^]]+\]\([^)]+\)/ {
            t = $0; sub(/^- \[/, "", t); sub(/\].*$/, "", t)
            u = $0; sub(/^[^(]*\(/, "", u); sub(/\).*$/, "", u)
            printf "%s\037%s\n", t, u
        }')
    return 0
}

# LinkedIn and GitHub from the profile's list, plus its email: when set.
contact_links() {
    local url out="" want
    [ -n "$profile" ] || return 0
    for want in LinkedIn GitHub; do
        url=$(profile_link "$want")
        [ -n "$url" ] || continue
        [ -n "$out" ] && out+=" &middot; "
        out+="<a href=\"$(html_escape "$url")\">$want</a>"
    done
    load_fm "$profile"
    if [ -n "$fm_email" ]; then
        [ -n "$out" ] && out+=" &middot; "
        out+="<a href=\"mailto:$(html_escape "$fm_email")\">$(html_escape "$fm_email")</a>"
    fi
    printf '%s' "$out"
}

# The profile's first plain paragraph: the ledger's lead and the
# description the ledger and About share.
profile_lead() {
    [ -n "$profile" ] || return 0
    strip_frontmatter "$profile/_.md" | awk '
        /^[[:space:]]*$/ || /^[#<>\[*-]/ || /^(METRICS|EMBED|CTA):/ { next }
        { print; exit }'
}

# The header when there is no front.md: the profile's lead as the h1 and
# its italic availability line.
render_intro() {
    local lead="" avail="" links name h1 link
    if [ -n "$profile" ]; then
        lead=$(profile_lead)
        avail=$(strip_frontmatter "$profile/_.md" | awk '/^\*[^*].*\*$/ { print substr($0, 2, length($0) - 2); exit }')
    fi
    [ -z "$lead" ] && lead=$AUTHOR
    links=$(contact_links)

    name=$(html_escape "$AUTHOR")
    h1=$(html_escape "$lead")
    link="<a class=\"home\" href=\"./\">$name</a>"
    h1=${h1/"$name"/$link}

    echo '<header class="intro">'
    printf '<h1 class="lead">%s</h1>\n' "$h1"
    if [ -n "$profile" ]; then
        printf '<p class="avail">%s <a href="work/%s/">About &rarr;</a>%s</p>\n' \
            "$(html_escape "$avail")" "$(basename "$profile")" "${links:+ &middot; $links}"
    fi
    echo '</header>'
}

# The footer when there is no signature, so the page still ends on a way
# to get in touch.
render_contact_footer() {
    local links ask=""
    links=$(contact_links)
    [ -n "$links" ] || return 0
    [ -f "$FRONT_FILE" ] && ask=$(case_cta "$FRONT_FILE" | sed -e 's/^<p class="case-cta">/<h2 class="ask">/' -e 's|</p>$|</h2>|')
    printf '<footer class="contact">%s<p>%s</p></footer>\n' "${ask:-<h2>Get in touch</h2>}" "$links"
}

# Front page: contents/front.md, optional.
#   # Headline              the h1; the author's name in it links home
#   first plain paragraph   scope, shown under How I work
#   > Thesis                under the h1, split after its first comma
#   *Availability*          shown in the signature
#   ## What I can do        per offer: "### Kicker", one line, then
#                           "PROOF: slug, slug" naming cases or side
#                           projects; an unknown slug stops the build
#   ## How I work           one paragraph, the section's heading
#   CTA: Ask? [text](url)   the signature's ask
# Offers sit above the cases; How I work and the signature below them.
FRONT_FILE="${CONTENT_DIR}front.md"

# One part of front.md, by name: h1, scope, thesis, avail or how.
front_part() {
    [ -f "$FRONT_FILE" ] || return 0
    strip_frontmatter "$FRONT_FILE" | strip_comments | awk -v part="$1" '
        /^## / { sec = substr($0, 4); next }
        /^CTA:/ || /^[[:space:]]*$/ { next }
        sec == "" && part == "h1" && /^# / { print substr($0, 3); exit }
        sec == "" && part == "thesis" && /^> / { print substr($0, 3); exit }
        sec == "" && part == "avail" && /^\*[^*].*\*$/ { print substr($0, 2, length($0) - 2); exit }
        sec == "" && part == "scope" && /^[^#>*<-]/ { print; exit }
        sec == "How I work" && part == "how" && /^[^#>*<-]/ { print; exit }'
}

# The offers under "## What I can do": kicker, line, proof slugs
# (comma-separated), $FS-separated, one offer per output line.
front_offers() {
    [ -f "$FRONT_FILE" ] || return 0
    strip_frontmatter "$FRONT_FILE" | strip_comments | awk '
        function flush() { if (k != "") printf "%s\037%s\037%s\n", k, l, p; k = l = p = "" }
        /^## / { flush(); on = ($0 == "## What I can do"); next }
        !on { next }
        /^### / { flush(); k = substr($0, 5); next }
        /^PROOF:/ { p = $0; sub(/^PROOF:[[:space:]]*/, "", p); next }
        k != "" && NF { l = (l == "" ? $0 : l " " $0) }
        END { flush() }'
}

# The folder a PROOF slug names: a case, or a side project under a
# section's items/. Prints nothing when there is none.
proof_folder() {
    local slug=$1 f
    [[ "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]] || return 0
    if [ -f "$CONTENT_DIR$slug/_.md" ]; then
        load_fm "$CONTENT_DIR$slug"
        [ "$fm_kind" = "profile" ] || { printf '%s' "$CONTENT_DIR$slug"; return 0; }
    fi
    for f in "$CONTENT_DIR"*/items/"$slug"; do
        [ -f "$f/_.md" ] && { printf '%s' "$f"; return 0; }
    done
    return 0
}

# Every offer needs a PROOF line, and every slug on it a page. Runs before
# anything is written, so a typo stops the build instead of a dead link.
check_front() {
    local kicker line proof slug
    while IFS=$FS read -r kicker line proof; do
        if [ -z "$proof" ]; then
            friendly_message "Build stopped: $FRONT_FILE offer \"$kicker\" needs a PROOF: line" "List the slugs of the cases that prove it."
            return 1
        fi
        IFS=',' read -ra slugs <<< "$proof"
        for slug in "${slugs[@]}"; do
            slug=${slug//[[:space:]]/}
            if [ -z "$(proof_folder "$slug")" ]; then
                friendly_message "Build stopped: Unknown case in $FRONT_FILE PROOF: '$slug'" "Use the folder name of a case or side project."
                return 1
            fi
        done
    done < <(front_offers)
}

# Without JS every offer reads open (styles.css). front.js builds the
# proof glyphs from the <template>, which holds each glyph and its
# _.parts.svg once per slug.
render_front() {
    local h1 name link nav url thesis kicker line proof slug folder links n i k image_file src
    local -a offers=() srcs=()
    local seen=" "

    name=$(html_escape "$AUTHOR")
    h1=$(html_escape "$(front_part h1)")
    link="<a class=\"home\" href=\"./\">$name</a>"
    h1=${h1/"$name"/$link}

    nav="<a href=\"#g-client\">Cases</a>"
    if [ -n "$profile" ]; then
        nav+=" <a href=\"work/$(basename "$profile")/\">About</a>"
        url=$(profile_link LinkedIn)
        [ -n "$url" ] && nav+=" <a href=\"$(html_escape "$url")\">LinkedIn</a>"
        load_fm "$profile"
        # The full address on desktop, "Email" on a phone (styles.css).
        [ -n "$fm_email" ] && nav+=" <a href=\"mailto:$(html_escape "$fm_email")\"><span class=\"long\">$(html_escape "$fm_email")</span><span class=\"short\">Email</span></a>"
    fi

    echo '<div class="front">'
    echo '<header class="intro">'
    printf '<h1 class="name">%s</h1>\n' "$h1"
    printf '<nav class="site" aria-label="Site">%s</nav>\n' "$nav"
    echo '</header>'

    thesis=$(html_escape "$(front_part thesis)")
    if [ -n "$thesis" ]; then
        # No one-word last line.
        [[ "$thesis" == *" "* ]] && thesis="${thesis% *}&nbsp;${thesis##* }"
        if [[ "$thesis" == *", "* ]]; then
            thesis="<span class=\"l\">${thesis%%, *},</span> <span class=\"l\">${thesis#*, }</span>"
        else
            thesis="<span class=\"l\">$thesis</span>"
        fi
        printf '<p class="thesis">%s</p>\n' "$thesis"
    fi

    while IFS= read -r line; do
        offers+=("$line")
    done < <(front_offers)
    n=${#offers[@]}
    if [ "$n" -gt 0 ]; then
        printf '<section class="offers" aria-labelledby="g-offers" style="--n: %s">\n' "$n"
        echo '<h2 id="g-offers" class="sr">What I can do</h2>'
        echo '<ol class="offers-list">'
        k=0
        for line in "${offers[@]}"; do
            k=$((k + 1))
            IFS=$FS read -r kicker line proof <<< "$line"
            links=""
            IFS=',' read -ra slugs <<< "$proof"
            # "A", "A and B", "A, B and C".
            for i in "${!slugs[@]}"; do
                slug=${slugs[$i]//[[:space:]]/}
                slugs[$i]=$slug
                folder=$(proof_folder "$slug")
                load_fm "$folder"
                if [ "$i" -gt 0 ]; then
                    if [ "$i" -eq $((${#slugs[@]} - 1)) ]; then links+=" and "; else links+=", "; fi
                fi
                links+="<a href=\"work/$slug/\">$(html_escape "$fm_label")</a>"
                case "$seen" in *" $slug "*) continue ;; esac
                seen+="$slug "
                image_file=$(find_item_image "$folder")
                # front.js draws glyphs as white XOR shapes: black-only glyphs.
                [[ "$image_file" == *.svg ]] && [ "$fm_glyph" != colour ] || continue
                src="<i data-slug=\"$slug\" data-label=\"$(html_escape "$fm_label")\" data-glyph=\"$(base64 < "$image_file" | tr -d '\n')\""
                [ -f "${image_file%.svg}.parts.svg" ] && src+=" data-parts=\"$(base64 < "${image_file%.svg}.parts.svg" | tr -d '\n')\""
                srcs+=("$src></i>")
            done
            printf '<li class="offer%s" data-proof="%s"><h3 class="kicker" id="k-%s"><span class="t">%s</span></h3>' \
                "$([ "$k" -eq 1 ] && printf ' on')" "${slugs[*]}" "$k" "$(html_escape "$kicker")"
            printf '<div class="detail" id="d-%s"><div class="in"><div class="room"></div><p class="offer-line">%s</p><p class="proof">See %s</p></div></div></li>\n' \
                "$k" "$(html_escape "$line")" "$links"
        done
        echo '</ol>'
        echo '<div class="stage" aria-hidden="true"></div>'
        if [ ${#srcs[@]} -gt 0 ]; then
            printf '<template class="glyph-src">'
            printf '%s' "${srcs[@]}"
            printf '</template>\n'
        fi
        echo '</section>'
    fi
    echo '</div>'
}

# Its paragraph is the heading; front.md's scope paragraph sits under it.
render_how() {
    local how line scope
    how=$(front_part how)
    scope=$(front_part scope)
    [ -n "$how$scope" ] || return 0
    line=$how
    printf '<section class="group how" aria-labelledby="g-how">'
    [ -n "$line" ] && printf '<h2 class="how-line" id="g-how">%s</h2>' "$(html_escape "$line")"
    printf '<div class="how-cols">'
    [ -n "$scope" ] && printf '<p class="facts">%s</p>' "$(html_escape "$scope")"
    printf '</div></section>\n'
}

# The page's closing footer: front.md's CTA as the ask, then the
# profile's contact links and the availability line. Featured and side
# project glyphs ride along inline, with their parts, for foot.js.
# Colour glyphs stay out.
render_signature() {
    local ask url want email avail folder slug image_file svg parts more="" items=""
    ask=$(case_cta "$FRONT_FILE" | sed -e 's/^<p class="case-cta">//' -e 's|</p>$||')
    [ -n "$ask" ] || ask="Get in touch."
    load_fm "$profile"
    email=$fm_email
    for want in LinkedIn GitHub; do
        url=$(profile_link "$want")
        [ -n "$url" ] && more+="${more:+ }<a href=\"$(html_escape "$url")\">$want</a>"
    done
    avail=$(front_part avail)
    for folder in "$@"; do
        load_fm "$folder"
        image_file=$(find_item_image "$folder")
        [[ "$image_file" == *.svg ]] && [ "$fm_glyph" != colour ] || continue
        slug=$(basename "$folder")
        svg=$(tr '\n' ' ' < "$image_file" | sed -E -e 's/[[:space:]]+/ /g' -e 's/fill="(black|#000|#000000)"/fill="currentColor"/g' -e 's/<svg /<svg aria-hidden="true" focusable="false" /' -e 's/[[:space:]]+$//')
        parts=""
        [ -f "${image_file%.svg}.parts.svg" ] && parts=" data-parts=\"$(base64 < "${image_file%.svg}.parts.svg" | tr -d '\n')\""
        # Decorative, so the glyphs don't link.
        items+="<li><span class=\"sig-g$([[ " ${featured_folders[*]} " == *" $folder "* ]] && printf ' client')\" data-name=\"$(html_escape "$fm_label")\"$parts>$svg</span></li>"$'\n'
    done
    echo '<footer class="sig" aria-labelledby="sig-ask">'
    echo '<div class="sig-stage">'
    echo '<div class="sig-poster">'
    printf '<h2 class="sig-ask" id="sig-ask"><span class="sig-l">%s</span></h2>\n' "$ask"
    echo '<div class="sig-reach">'
    # The address may break after the @ on a phone.
    [ -n "$email" ] && printf '<a class="sig-mail" href="mailto:%s">%s</a>\n' "$(html_escape "$email")" "$(html_escape "$email" | sed 's/@/@<wbr>/')"
    [ -n "$more" ] && printf '<p class="sig-more">%s</p>\n' "$more"
    [ -n "$avail" ] && printf '<p class="sig-avail">%s</p>\n' "$(html_escape "$avail")"
    echo '</div>'
    echo '</div>'
    if [ -n "$items" ]; then
        echo '<div class="sig-ring" aria-hidden="true"><ol>'
        printf '%s' "$items"
        echo '</ol></div>'
    fi
    echo '</div>'
    echo '</footer>'
}

# Side projects on the About page as a compact, anchored list. The full
# body lives on each item's own page.
render_items() {
    local dir=$1
    local heading=$2
    local item slug image_file question
    local -a items=()
    while IFS= read -r item; do
        items+=("$item")
    done < <(sort_items "$dir"/*/)
    [ ${#items[@]} -gt 0 ] || return 0

    printf '<section class="part items"><h2>%s</h2><div class="body">\n' "$heading"
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
        [ -n "$question" ] && printf '<p class="item-meta">%s</p>\n' "$(html_escape "$question")"
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
    local page_js=${7:-}
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
    # Inlined in the head so its js class lands before first paint.
    if [ -s "$JS_FILE" ]; then
        printf '    <script>\n%s\n    </script>\n' "$(cat "$JS_FILE")"
    fi
    # Linked and deferred, so it stays out of the inlined head.
    if [ -f "$OUT_DIR/motion.js" ]; then
        echo "    <script src=\"${root}motion.js\" defer></script>"
    fi
    if [ -f "$OUT_DIR/egg.js" ]; then
        echo "    <script src=\"${root}egg.js\" defer></script>"
    fi
    # page_js is space-separated; each loads only when present.
    local js
    for js in $page_js; do
        if [ -f "$OUT_DIR/$js" ]; then echo "    <script src=\"${root}$js\" defer></script>"; fi
    done
    echo "</head>"
}

# A side project leads back to its About entry, since works.html doesn't
# list it. Reads back_kind, set by write_case_page.
back_href() {
    if [ "${back_kind:-case}" = side ] && [ -n "$profile" ]; then
        printf '../%s/#%s' "$(basename "$profile")" "$1"
    else
        printf '../../works.html#%s' "$1"
    fi
}
back_label() {
    if [ "${back_kind:-case}" = side ] && [ -n "$profile" ]; then printf 'Side projects'; else printf 'All work'; fi
}

# Pages through the pager_folders global in ledger order. No wrap-around:
# each end leads back to the list instead.
render_prev_next() {
    local idx=$1
    local count=${#pager_folders[@]}
    local slug other dir
    slug=$(basename "${pager_folders[$idx]}")

    echo "<nav class=\"pn\" aria-label=\"More work\">"
    if [ "$idx" -gt 0 ]; then
        other=${pager_folders[$((idx - 1))]}
        load_fm "$other"
        if [ "${back_kind:-case}" = side ]; then dir="&larr; Previous"; else dir="&larr; Newer, ${fm_date%%-*}"; fi
        printf '  <a rel="prev" href="../%s/"><span class="pn-dir">%s</span> <span class="pn-name">%s</span> <span class="pn-line">%s</span></a>\n' \
            "$(basename "$other")" "$dir" "$(html_escape "$fm_label")" "$(html_escape "$fm_summary")"
    else
        printf '  <a class="pn-all" href="%s"><span class="pn-dir">Start of the list</span> <span class="pn-name">&larr; %s</span></a>\n' "$(back_href "$slug")" "$(back_label)"
    fi
    if [ "$idx" -lt $((count - 1)) ]; then
        other=${pager_folders[$((idx + 1))]}
        load_fm "$other"
        if [ "${back_kind:-case}" = side ]; then dir="Next &rarr;"; else dir="Older, ${fm_date%%-*} &rarr;"; fi
        printf '  <a rel="next" href="../%s/"><span class="pn-dir">%s</span> <span class="pn-name">%s</span> <span class="pn-line">%s</span></a>\n' \
            "$(basename "$other")" "$dir" "$(html_escape "$fm_label")" "$(html_escape "$fm_summary")"
    else
        printf '  <a class="pn-all pn-end" href="%s"><span class="pn-dir">End of the list</span> <span class="pn-name">&larr; %s</span></a>\n' "$(back_href "$slug")" "$(back_label)"
    fi
    echo "</nav>"
}

# `idx` is the page's place in pager_folders; -1 for the profile, which
# gets no pager. `kind` is "case" or "side".
write_case_page() {
    local folder=$1
    local idx=$2
    local items_heading=$3
    local kind=${4:-case}
    back_kind=$kind
    local slug content_file="$folder/_.md"
    local body figures items="" cta
    slug=$(basename "$folder")
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
<nav class="mast"><a class="back" href="$(back_href "$slug")">&larr; $(back_label)</a></nav>
<main id="main-content">
EOF
    [ "$fm_kind" = profile ] && fm_summary=""
    render_case_head "$folder" "$kind"
    if [ -n "$figures" ]; then
        printf '<section class="figures"><h2>Impact</h2>%s</section>\n' "$figures"
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
    toy_scripts "$content_file"
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
    if [ -n "$fm_featured" ] && [[ ! "$fm_featured" =~ ^[1-9][0-9]*$ ]]; then
        echo "warn: $slug featured: must be a positive number ($fm_featured), left unfeatured" >&2
    fi
    case "$seen_slugs" in
        *" $slug "*) friendly_message "Build stopped: duplicate slug '$slug'" "Rename one of the folders called $slug."; exit 1 ;;
    esac
    seen_slugs+="$slug "
done
check_front || exit 1

# Remove old case pages so a deleted or renamed section leaves nothing
# behind. Scoped to "$OUT_DIR/work", never anything wider.
rm -rf -- "$WORK_DIR"

echo "Building sections..."

# One sorted list per group feeds the ledger and the pager, so they can't
# disagree. The first kind: profile folder is About: it gets no row, and
# its items are the side projects.
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
    done < <(sort_items "$profile"/items/*/)
fi

# Featured cases (featured: N, smallest first, date order breaking ties)
# head works.html; the rest of client work is the Also index. The pager
# keeps the dated order of all client work.
declare -a featured_folders=() index_folders=()
featured_keys=""
i=0
for folder in "${sorted_folders[@]}"; do
    load_fm "$folder"
    if [[ "$fm_featured" =~ ^[1-9][0-9]*$ ]]; then
        featured_keys+="$fm_featured|$i|$folder"$'\n'
    else
        index_folders+=("$folder")
    fi
    i=$((i + 1))
done
while IFS='|' read -r _ _ folder; do
    [ -n "$folder" ] && featured_folders+=("$folder")
done < <(printf '%s' "$featured_keys" | LC_ALL=C sort -t'|' -k1,1n -k2,2n)

pager_folders=("${sorted_folders[@]}")
i=0
for folder in "${sorted_folders[@]}"; do
    write_case_page "$folder" "$i" "Also"
    i=$((i + 1))
done
if [ -n "$profile" ]; then
    write_case_page "$profile" -1 "Side projects"
fi
# Side projects page among themselves.
pager_folders=("${side_folders[@]}")
i=0
for folder in "${side_folders[@]}"; do
    write_case_page "$folder" "$i" "" side
    i=$((i + 1))
done

echo "Assembling $OUTPUT_FILE..."

{
echo "<!DOCTYPE html>"
echo "<html lang=\"en\">"
ledger_lead=$(front_part h1)
[ -n "$ledger_lead" ] || ledger_lead=$(profile_lead)
front_js=""
[ -n "$(front_offers)" ] && front_js=front.js
[ -f "$FRONT_FILE" ] && [ -n "$profile" ] && front_js+="${front_js:+ }foot.js"
page_head "$TITLE" "${ledger_lead:-$TITLE - Portfolio}" "$(basename "$OUTPUT_FILE")" "" "" "" "$front_js"
echo "<body>"
echo '<a class="skip" href="#main-content">Skip to content</a>'
echo "<main id=\"main-content\">"
if [ -f "$FRONT_FILE" ]; then render_front; else render_intro; fi
if [ ${#featured_folders[@]} -gt 0 ]; then
    render_featured "${featured_folders[@]}"
    [ ${#index_folders[@]} -gt 0 ] && render_also "${index_folders[@]}"
else
    render_group client "Client work" "${sorted_folders[@]}"
fi
# Side projects are listed on the About page, not here.
render_how
if [ -f "$FRONT_FILE" ] && [ -n "$profile" ]; then
    render_signature "${featured_folders[@]}" "${side_folders[@]}"
else
    render_contact_footer
fi
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

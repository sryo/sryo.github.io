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
#    - Ensure 'styles.css' and 'script.js' are present.

# 2. Set up your content:
#    - Create a 'contents/' directory (or whatever you set in config).
#    - Inside, make a folder for each main section of your portfolio.
#    - In each section folder:
#      a) Add a .md (Markdown) file with your content. Start it with '# Title' or frontmatter.
#      b) Optionally, add an image file (.jpg, .png, or .svg) for the section cover.
#    - For projects or sub-galleries:
#      a) Create a 'gallery' folder inside any section folder.
#      b) In the 'gallery' folder, make a subfolder for each project.
#      c) In each project folder, add a .md file and an image file.
#    - To add a video or other embed, include a line starting with 'EMBED:' in your .md file.

# 3. Run the script:
#    - Open a terminal in the folder containing this script.
#    - Run the command: ./build.sh (or bash build.sh)
#    - To use the self-destruct option (if enabled in config), run: ./build.sh -d

# 3. View your portfolio:
#    - Open the generated 'works.html' file in a web browser.

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
# Case studies must set label, role and summary (see require_fields).

# Single awk pass over the frontmatter block. Emits the fields above,
# $FS-separated. Missing fields are empty strings.
parse_frontmatter() {
    awk '
    BEGIN { n = split("title date tags order label client role summary link kind", keys, " ") }
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
    IFS=$FS read -r fm_title fm_date fm_tags fm_order fm_label fm_client fm_role fm_summary fm_link fm_kind \
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
    IFS=$FS read -r _ _ _ _ fm_label _ fm_role fm_summary _ fm_kind < <(parse_frontmatter "$file")
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

# Modes: "" renders the body in place. "page" wraps each `## ` heading and
# what follows in a part (see flush_part) and leaves METRICS out; "metrics"
# renders only the METRICS blocks, for the figures band. HTML comments
# (source notes) never render, in any mode.
render_markdown_content() {
    local file=$1
    local mode=${2:-}
    local content="" metrics="" line parsed_line escaped_line after
    local in_paragraph=false in_list=false in_metrics=false in_code_block=false in_comment=false
    local metric_line value label
    local part_start=0 part_label="" hoisted=false
    local link_re='^\[[^]]+\]\([^)]+\)$'

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
                    metrics+="<div class=\"metric\"><span class=\"metric-value\">$value</span><span class=\"metric-label\">$label</span></div>"
                fi
                continue
            else
                metrics+="</div>"
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
        metrics+="</div>"
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

# Format YYYY-MM-DD as "Month YYYY". Empty or malformed dates return empty.
format_date() {
    local date=$1
    [[ "$date" =~ ^[0-9]{4}-[0-9]{2} ]] || { printf ''; return; }
    local year=${date%%-*}
    local month_num=${date#*-}
    month_num=${month_num%%-*}
    month_num=${month_num#0}
    local months=("" "January" "February" "March" "April" "May" "June"
                  "July" "August" "September" "October" "November" "December")
    printf '%s %s' "${months[$month_num]}" "$year"
}

# A lone "[text](url)" line before the first ## heading is the project's
# link ("Project Link", "View archive"). Prints text$FS url, or nothing.
lead_link() {
    strip_frontmatter "$1" | awk '
        /^## / { exit }
        /^\[[^]]+\]\([^)]+\)$/ {
            t = $0; sub(/^\[/, "", t); sub(/\]\(.*$/, "", t)
            u = $0; sub(/^[^(]*\(/, "", u); sub(/\)$/, "", u)
            printf "%s\037%s", t, u; exit
        }'
}

# Case header: a spec column (glyph, then Client / Year / Role / Scope /
# Link) beside the h1 and the summary as dek. Uses the fm_* globals.
render_case_head() {
    local folder=$1
    local image_file link_text link_url formatted_date scope
    image_file=$(find_item_image "$folder")
    IFS=$FS read -r link_text link_url < <(lead_link "$folder/_.md")
    if [ -n "$fm_link" ]; then link_text=$fm_link; link_url=$fm_link; fi

    echo "<header class=\"case-head\">"
    printf '<aside class="spec">'
    if [ "$fm_kind" = "profile" ]; then
        render_glyph "$image_file" "$fm_label"
    else
        render_glyph "$image_file" "$fm_label" "g-$(basename "$folder")"
    fi
    if [ "$fm_kind" != "profile" ]; then
        printf '<dl>'
        printf '<dt>Client</dt><dd>%s</dd>' "$(html_escape "$fm_client")"
        formatted_date=$(format_date "$fm_date")
        if [ -n "$formatted_date" ]; then
            printf '<dt>Year</dt><dd><time datetime="%s">%s</time></dd>' "$fm_date" "$formatted_date"
        fi
        printf '<dt>Role</dt><dd>%s</dd>' "$(html_escape "$fm_role")"
        if [ -n "$fm_tags" ]; then
            scope=${fm_tags//,/, }
            printf '<dt>Scope</dt><dd>%s</dd>' "$(html_escape "$scope")"
        fi
        if [ -n "$link_url" ]; then
            printf '<dt>Link</dt><dd><a href="%s">%s</a></dd>' "$(html_escape "$link_url")" "$(html_escape "$link_text")"
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
    local image_file=$1 label=$2 vt=${3:+ style=\"view-transition-name: $3\"} initial
    if [ -n "$image_file" ] && [ -f "$image_file" ]; then
        printf '<span class="glyph"%s>%s</span>' "$vt" "$(insert_image "$image_file" "" | tr -d '\n')"
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
    done < <(strip_frontmatter "$folder/_.md" | grep -o '\[[^]]*\]([^)]*)')
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

# One ledger group: heading, count, column header, rows. `key` is
# "client" (rows open case pages) or "side" (rows open About sections).
render_group() {
    local key=$1
    local heading=$2
    local last_col=$3
    shift 3
    local folder href last prev_year="" year vt

    printf '<section class="group" aria-labelledby="g-%s">\n' "$key"
    printf '<div class="group-head"><h2 id="g-%s">%s</h2><span class="count">%02d</span></div>\n' "$key" "$heading" $#
    printf '<div class="cols" aria-hidden="true"><span>Year</span><span></span><span>Name</span><span>Line</span><span>%s</span></div>\n' "$last_col"
    echo '<ol class="ledger">'
    for folder in "$@"; do
        load_fm "$folder"
        year=${fm_date%%-*}
        if [ "$key" = "client" ]; then
            href="work/$(basename "$folder")/"
            last=$fm_role
            vt="g-$(basename "$folder")"
        else
            vt=""
            href=$(project_link "$folder" "$fm_label")
            [ -z "$href" ] && href="work/$(basename "$profile")/#$(basename "$folder")"
            last=${fm_role:-$(derive_medium "$fm_tags")}
        fi
        render_ledger_row "$folder" "$href" "$last" "$prev_year" "$vt"
        prev_year=$year
    done
    echo '</ol>'
    echo '</section>'
}

# The ledger's header, from the profile section: its first paragraph as
# the lead and its italic availability line, plus the client-work years.
render_intro() {
    local first=$1
    local last=$2
    local lead="" avail=""
    if [ -n "$profile" ]; then
        lead=$(strip_frontmatter "$profile/_.md" | awk '
            /^[[:space:]]*$/ || /^[#<>\[*-]/ || /^(METRICS|EMBED):/ { next }
            { print; exit }')
        avail=$(strip_frontmatter "$profile/_.md" | awk '/^\*[^*].*\*$/ { print substr($0, 2, length($0) - 2); exit }')
    fi
    [ -z "$lead" ] && lead=$AUTHOR

    echo '<header class="intro">'
    printf '<p class="mast"><a class="home" href="./">%s</a> <span class="meta">Work, %s&ndash;%s</span></p>\n' \
        "$(html_escape "$AUTHOR")" "$first" "$last"
    printf '<h1 class="lead">%s</h1>\n' "$(html_escape "$lead")"
    if [ -n "$profile" ]; then
        printf '<p class="avail">%s <a href="work/%s/">About &rarr;</a></p>\n' \
            "$(html_escape "$avail")" "$(basename "$profile")"
    fi
    echo '</header>'
}

# Items (side projects on the profile) as anchored sections of a page.
render_items() {
    local dir=$1
    local heading=$2
    local item slug image_file body question link
    local -a items=()
    while IFS= read -r item; do
        items+=("$item")
    done < <(sort_folders "$dir"/*/)
    [ ${#items[@]} -gt 0 ] || return 0

    printf '<section class="part items"><h2 class="label">%s</h2><div class="body">\n' "$heading"
    for item in "${items[@]}"; do
        slug=$(basename "$item")
        image_file=$(find_item_image "$item")
        body=$(render_markdown_content "$item/_.md")
        load_fm "$item"
        printf '<article class="item" id="%s">\n' "$slug"
        if [ -n "$image_file" ]; then
            printf '<span class="glyph">%s</span>\n' "$(insert_image "$image_file" "")"
        fi
        question=""
        if [[ "$fm_title" == *": "* ]]; then
            question=$(derive_line "$fm_title")
        elif [ "$fm_title" != "$fm_label" ]; then
            question=$fm_title
        fi
        link=$(project_link "$item" "$fm_label")
        if [ -n "$link" ]; then
            printf '<h3><a href="%s">%s</a></h3>\n' "$(html_escape "$link")" "$(html_escape "$fm_label")"
        else
            printf '<h3>%s</h3>\n' "$(html_escape "$fm_label")"
        fi
        printf '<p class="item-meta"><time datetime="%s">%s</time> %s</p>\n' \
            "$fm_date" "${fm_date%%-*}" "$(html_escape "$question")"
        printf '%s\n</article>\n' "$body"
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
    <meta name="twitter:card" content="summary_large_image">
EOF
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

# Pager for case pages. Follows the ledger's sorted list: prev is the row
# above (newer), next the row below (older). No wrap-around.
render_prev_next() {
    local idx=$1
    local count=${#sorted_folders[@]}
    local other

    echo "<nav class=\"pn\" aria-label=\"More work\">"
    if [ "$idx" -gt 0 ]; then
        other=${sorted_folders[$((idx - 1))]}
        load_fm "$other"
        printf '  <a rel="prev" href="../%s/"><span class="label">&larr; Newer, %s</span> <span class="pn-name">%s</span></a>\n' \
            "$(basename "$other")" "${fm_date%%-*}" "$(html_escape "$fm_label")"
    else
        echo "  <span></span>"
    fi
    if [ "$idx" -lt $((count - 1)) ]; then
        other=${sorted_folders[$((idx + 1))]}
        load_fm "$other"
        printf '  <a rel="next" href="../%s/"><span class="label">Older, %s &rarr;</span> <span class="pn-name">%s</span></a>\n' \
            "$(basename "$other")" "${fm_date%%-*}" "$(html_escape "$fm_label")"
    fi
    echo "</nav>"
}

# One standalone page per section, at work/<slug>/index.html. `idx` is the
# section's place in the client-work list; -1 for the profile, which gets
# no position or pager.
write_case_page() {
    local folder=$1
    local idx=$2
    local items_heading=$3
    local slug content_file="$folder/_.md"
    local position="" body figures items=""
    slug=$(basename "$folder")
    if [ "$idx" -ge 0 ]; then
        position=" <span class=\"count\">$(printf '%02d / %02d' $((idx + 1)) ${#sorted_folders[@]})</span>"
    fi
    body=$(render_markdown_content "$content_file" page)
    figures=$(render_markdown_content "$content_file" metrics)
    if [ -d "$folder/items" ]; then
        items=$(render_items "$folder/items" "$items_heading")
    fi

    load_fm "$folder"
    mkdir -p "$WORK_DIR/$slug"
    {
    echo "<!DOCTYPE html>"
    echo "<html lang=\"en\">"
    page_head "$fm_title / $AUTHOR" "${fm_summary:-$fm_title}" "work/$slug/" "../../" "$fm_title" article
    cat <<EOF
<body>
<nav class="mast"><a class="back" href="../../works.html#$slug">&larr; All work</a>$position</nav>
<main id="main-content">
EOF
    render_case_head "$folder"
    if [ -n "$figures" ]; then
        printf '<section class="figures"><h2 class="label">Impact</h2>%s</section>\n' "$figures"
    fi
    rebase_paths "$body"
    echo
    if [ -n "$items" ]; then
        rebase_paths "$items"
        echo
    fi
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

i=0
for folder in "${sorted_folders[@]}"; do
    write_case_page "$folder" "$i" "Also"
    i=$((i + 1))
done
if [ -n "$profile" ]; then
    write_case_page "$profile" -1 "Side projects"
fi

# Year span of the client work, newest and oldest.
newest=""; oldest=""
if [ ${#sorted_folders[@]} -gt 0 ]; then
    load_fm "${sorted_folders[0]}"; newest=${fm_date%%-*}
    load_fm "${sorted_folders[$((${#sorted_folders[@]} - 1))]}"; oldest=${fm_date%%-*}
fi

echo "Assembling $OUTPUT_FILE..."

{
echo "<!DOCTYPE html>"
echo "<html lang=\"en\">"
page_head "$TITLE" "$TITLE - Portfolio" "$(basename "$OUTPUT_FILE")" ""
echo "<body>"
echo "<main id=\"main-content\">"
render_intro "$oldest" "$newest"
render_group client "Client work" "Role" "${sorted_folders[@]}"
if [ ${#side_folders[@]} -gt 0 ]; then
    render_group side "Side projects" "Medium" "${side_folders[@]}"
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

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

for file in "$CONTENT_DIR" "$CSS_FILE" "$JS_FILE"; do
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

# Single awk pass over the frontmatter block. Emits $FS-separated
# title, date, tags, order. Missing fields are empty strings.
parse_frontmatter() {
    awk '
    BEGIN { in_fm=0; title=""; date=""; tags=""; order="" }
    NR==1 && /^---$/ { in_fm=1; next }
    in_fm && /^---$/ { in_fm=0; exit }
    in_fm {
        if (match($0, /^title:[[:space:]]*/)) {
            v = substr($0, RLENGTH+1)
            sub(/^"/, "", v); sub(/"$/, "", v)
            title = v
        } else if (match($0, /^date:[[:space:]]*/)) {
            date = substr($0, RLENGTH+1)
        } else if (match($0, /^tags:[[:space:]]*/)) {
            v = substr($0, RLENGTH+1)
            gsub(/[\[\]]/, "", v)
            gsub(/[[:space:]]*,[[:space:]]*/, ",", v)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
            tags = v
        } else if (match($0, /^order:[[:space:]]*/)) {
            order = substr($0, RLENGTH+1)
        }
    }
    END { printf "%s\037%s\037%s\037%s", title, date, tags, order }
    ' "$1"
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

render_markdown_content() {
    local file=$1
    local content="" line parsed_line escaped_line
    local in_paragraph=false in_list=false in_metrics=false in_code_block=false
    local metric_line value label

    while IFS= read -r line || [ -n "$line" ]; do
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

        # METRICS block opener.
        if [[ "$line" == "METRICS:" ]]; then
            if $in_paragraph; then content+="</p>"; in_paragraph=false; fi
            if $in_list; then content+="</ul>"; in_list=false; fi
            content+="<div class=\"metrics-grid\">"
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
                    value=${BASH_REMATCH[1]}
                    label=${BASH_REMATCH[2]}
                    content+="<div class=\"metric\"><span class=\"metric-value\">$value</span><span class=\"metric-label\">$label</span></div>"
                fi
                continue
            else
                content+="</div>"
                in_metrics=false
            fi
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
    if $in_metrics; then content+="</div>"; fi
    if $in_list; then content+="</ul>"; fi
    if $in_paragraph; then content+="</p>"; fi
    echo "$content"
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

render_case_study_header() {
    local title=$1
    local date=$2
    local tags=$3
    local id=$4
    local safe_title formatted_date tag safe_tag
    safe_title=$(html_escape "$title")

    echo "<header class=\"case-study-header\">"
    echo "  <h1 id=\"title-$id\">$safe_title</h1>"
    echo "  <div class=\"meta\">"

    if [ -n "$date" ]; then
        formatted_date=$(format_date "$date")
        if [ -n "$formatted_date" ]; then
            echo "    <time datetime=\"$date\">$formatted_date</time>"
        fi
    fi

    if [ -n "$tags" ]; then
        echo "    <div class=\"tags\">"
        local IFS=','
        for tag in $tags; do
            safe_tag=$(html_escape "$tag")
            echo "      <span class=\"tag\">$safe_tag</span>"
        done
        echo "    </div>"
    fi

    echo "  </div>"
    echo "</header>"
}

# Render gallery items sorted by date descending (newest first); items
# without a date sort to the end.
process_gallery() {
    local gallery_dir=$1
    local item content_file image_file body
    local title date tags order safe_title
    local -a tuples=()

    shopt -s nullglob
    for item in "$gallery_dir"/*/; do
        item=${item%/}
        content_file="$item/_.md"
        [ -f "$content_file" ] || continue
        IFS=$FS read -r title date tags order < <(parse_frontmatter "$content_file")
        tuples+=("${date}|${item}")
    done

    while IFS='|' read -r date item; do
        [ -n "$item" ] || continue
        content_file="$item/_.md"
        image_file=$(find_item_image "$item")
        IFS=$FS read -r title date tags order < <(parse_frontmatter "$content_file")
        [ -z "$title" ] && title=$(basename "$item")
        body=$(render_markdown_content "$content_file")
        safe_title=$(html_escape "$title")

        echo "<div class=\"project\">"
        echo "  <div class=\"project-content\">"
        echo "    <h3>$safe_title</h3>"
        echo "    $body"
        echo "  </div>"
        if [ -n "$image_file" ] && [ -f "$image_file" ]; then
            echo "  <div class=\"project-image\">"
            insert_image "$image_file" "$title"
            echo "  </div>"
        fi
        echo "</div>"
    done < <(printf '%s\n' "${tuples[@]}" | sort -t'|' -k1,1 -r)
}

# Ledger columns until frontmatter names them: the text before ": " in
# the title is the name, the rest is the line, the first tag is the role.
derive_label() {
    local title=$1
    if [[ "$title" == *": "* ]]; then printf '%s' "${title%%: *}"; else printf '%s' "$title"; fi
}

derive_line() {
    local title=$1
    if [[ "$title" == *": "* ]]; then printf '%s' "${title#*: }"; else printf '%s' "$title"; fi
}

# The short name of a section folder, for rows and prev/next links.
label_of() {
    local title
    IFS=$FS read -r title _ < <(parse_frontmatter "$1/_.md")
    [ -z "$title" ] && title=$(basename "$1")
    derive_label "$title"
}

# One <li> in the ledger: Year · Glyph · Name · Line · Role.
render_ledger_row() {
    local slug=$1
    local title=$2
    local date=$3
    local tags=$4
    local image_file=$5
    local year=${date%%-*}

    echo "  > Processing section: $title" >&2

    printf '<li id="%s"><a class="row" href="work/%s/">' "$slug" "$slug"
    printf '<time class="yr" datetime="%s">%s</time>' "$date" "$year"
    printf '<span class="glyph">'
    if [ -n "$image_file" ] && [ -f "$image_file" ]; then
        insert_image "$image_file" "" | tr -d '\n'
    fi
    printf '</span>'
    printf '<span class="name">%s</span>' "$(html_escape "$(derive_label "$title")")"
    printf '<span class="line">%s</span>' "$(html_escape "$(derive_line "$title")")"
    printf '<span class="role">%s</span>' "$(html_escape "${tags%%,*}")"
    printf '</a></li>\n'
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
</head>
EOF
}

# Pager for case pages. Follows the ledger's sorted list: prev is the row
# above (newer), next the row below (older). No wrap-around.
render_prev_next() {
    local idx=$1
    local count=${#sorted_folders[@]}
    local other year

    echo "<nav class=\"pn\" aria-label=\"More work\">"
    if [ "$idx" -gt 0 ]; then
        other=${sorted_folders[$((idx - 1))]}
        IFS=$FS read -r _ year _ < <(parse_frontmatter "$other/_.md")
        printf '  <a rel="prev" href="../%s/"><span class="label">&larr; Newer, %s</span> <span class="pn-name">%s</span></a>\n' \
            "$(basename "$other")" "${year%%-*}" "$(html_escape "$(label_of "$other")")"
    else
        echo "  <span></span>"
    fi
    if [ "$idx" -lt $((count - 1)) ]; then
        other=${sorted_folders[$((idx + 1))]}
        IFS=$FS read -r _ year _ < <(parse_frontmatter "$other/_.md")
        printf '  <a rel="next" href="../%s/"><span class="label">Older, %s &rarr;</span> <span class="pn-name">%s</span></a>\n' \
            "$(basename "$other")" "${year%%-*}" "$(html_escape "$(label_of "$other")")"
    fi
    echo "</nav>"
}

# One standalone page per section, at work/<slug>/index.html.
write_case_page() {
    local slug=$1
    local folder=$2
    local title=$3
    local date=$4
    local tags=$5
    local idx=$6
    local content_file="$folder/_.md"
    local position
    position=$(printf '%02d / %02d' $((idx + 1)) ${#sorted_folders[@]})
    local body
    body=$(render_markdown_content "$content_file")

    mkdir -p "$WORK_DIR/$slug"
    {
    echo "<!DOCTYPE html>"
    echo "<html lang=\"en\">"
    page_head "$title / $AUTHOR" "$title" "work/$slug/" "../../" "$title" article
    cat <<EOF
<body>
<nav class="mast"><a class="back" href="../../works.html#$slug">&larr; All work</a> <span class="count">$position</span></nav>
<main id="main-content">
EOF
    render_case_study_header "$title" "$date" "$tags" "$slug"
    printf '%s\n' "$body"
    if [ -d "$folder/items" ]; then
        process_gallery "$folder/items"
    fi
    echo "</main>"
    render_prev_next "$idx"
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
    case "$seen_slugs" in
        *" $slug "*) friendly_message "Build stopped: duplicate slug '$slug'" "Rename one of the folders called $slug."; exit 1 ;;
    esac
    seen_slugs+="$slug "
done

# Remove old case pages so a deleted or renamed section leaves nothing
# behind. Scoped to "$OUT_DIR/work", never anything wider.
rm -rf -- "$WORK_DIR"

echo "Building sections..."

# One sorted record list feeds the ledger and the case pages, so they can't
# disagree: date descending, then order:, then slug.
declare -a records=()
for folder in "$CONTENT_DIR"*/; do
    folder=${folder%/}
    content_file="$folder/_.md"
    [ -f "$content_file" ] || continue
    IFS=$FS read -r _ date _ forder < <(parse_frontmatter "$content_file")
    [ -z "$forder" ] && forder=$DEFAULT_ORDER
    records+=("$date|$forder|$(basename "$folder")|$folder")
done

declare -a sorted_folders=()
while IFS='|' read -r _ _ _ folder; do
    [ -n "$folder" ] && sorted_folders+=("$folder")
done < <(printf '%s\n' "${records[@]}" | LC_ALL=C sort -t'|' -k1,1r -k2,2n -k3,3)

rows_html=""
i=0
for folder in "${sorted_folders[@]}"; do
    slug=$(basename "$folder")
    content_file="$folder/_.md"
    image_file=$(find_item_image "$folder")
    IFS=$FS read -r title date tags _ < <(parse_frontmatter "$content_file")
    [ -z "$title" ] && title=$slug

    rows_html+=$(render_ledger_row "$slug" "$title" "$date" "$tags" "$image_file")
    rows_html+=$'\n'
    write_case_page "$slug" "$folder" "$title" "$date" "$tags" "$i"
    i=$((i + 1))
done

echo "Assembling $OUTPUT_FILE..."

{
echo "<!DOCTYPE html>"
echo "<html lang=\"en\">"
page_head "$TITLE" "$TITLE - Portfolio" "$(basename "$OUTPUT_FILE")" ""
cat <<EOF
<body>
<main id="main-content">
<ol class="ledger">
EOF
printf '%s' "$rows_html"
echo "</ol>"
echo "</main>"
# script.js is an optional enhancement: inlined only when it has content.
if [ -s "$JS_FILE" ]; then
    printf '<script>\n%s\n</script>\n' "$(cat "$JS_FILE")"
fi
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

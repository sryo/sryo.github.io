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

DEFAULT_ORDER=9999

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

# Single awk pass over the frontmatter block. Emits tab-separated
# title<TAB>date<TAB>tags<TAB>order. Missing fields are empty strings.
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
    END { printf "%s\t%s\t%s\t%s", title, date, tags, order }
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
        IFS=$'\t' read -r title date tags order < <(parse_frontmatter "$content_file")
        tuples+=("${date}|${item}")
    done

    while IFS='|' read -r date item; do
        [ -n "$item" ] || continue
        content_file="$item/_.md"
        image_file=$(find_item_image "$item")
        IFS=$'\t' read -r title date tags order < <(parse_frontmatter "$content_file")
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

# Caller resolves content_file, title, image_file once and passes them in
# so we don't re-scan the folder.
process_section_item() {
    local content_file=$1
    local title=$2
    local image_file=$3
    local section_id=$4
    local item_id="item-$section_id"
    local gallery_id="gallery-$section_id"
    local safe_title
    safe_title=$(html_escape "$title")

    echo "  > Processing section: $title" >&2

    echo "<label class=\"item\" title=\"$safe_title\">"
    echo "  <input type=\"checkbox\" name=\"menu\" id=\"$item_id\" role=\"button\" tabindex=\"0\" aria-haspopup=\"dialog\" aria-controls=\"$gallery_id\" />"
    if [ -n "$image_file" ] && [ -f "$image_file" ]; then
        insert_image "$image_file" "$title"
    else
        echo "  <div class=\"placeholder-image\">No Image</div>"
    fi
    echo "</label>"
}

process_section_gallery() {
    local folder=$1
    local content_file=$2
    local title=$3
    local date=$4
    local tags=$5
    local section_id=$6
    local item_id="item-$section_id"
    local gallery_id="gallery-$section_id"
    local body
    body=$(render_markdown_content "$content_file")

    echo "<div class=\"gallery\" id=\"$gallery_id\" data-for=\"$item_id\" role=\"dialog\" tabindex=\"-1\" aria-labelledby=\"title-$section_id\">"
    render_case_study_header "$title" "$date" "$tags" "$section_id"
    echo "  $body"

    if [ -d "$folder/items" ]; then
        process_gallery "$folder/items"
    fi
    echo "</div>"
}


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

echo "Building sections..."

shopt -s nullglob
declare -a folder_order=()
for folder in "$CONTENT_DIR"*/; do
    content_file="$folder/_.md"
    [ -f "$content_file" ] || continue
    IFS=$'\t' read -r _ _ _ forder < <(parse_frontmatter "$content_file")
    [ -z "$forder" ] && forder=$DEFAULT_ORDER
    folder_order+=("$forder:$folder")
done

items_html=""
galleries_html=""
i=0
while IFS=: read -r _ folder; do
    folder=${folder%/}
    content_file="$folder/_.md"
    image_file=$(find_item_image "$folder")
    IFS=$'\t' read -r title date tags _ < <(parse_frontmatter "$content_file")
    [ -z "$title" ] && title=$(basename "$folder")

    items_html+=$(process_section_item "$content_file" "$title" "$image_file" "$i")
    items_html+=$'\n'
    galleries_html+=$(process_section_gallery "$folder" "$content_file" "$title" "$date" "$tags" "$i")
    galleries_html+=$'\n'
    ((i++))
done < <(printf '%s\n' "${folder_order[@]}" | sort -t: -k1 -n)

echo "Assembling $OUTPUT_FILE..."

{
cat <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="$TITLE - Portfolio">
    <title>$TITLE</title>
    <style>
    $(cat "$CSS_FILE")
    </style>
</head>
<body>
<main id="main-content">
<div class="clock" id="clock">
EOF
printf '%s' "$items_html"
echo "</div>"
printf '%s' "$galleries_html"
cat <<EOF
</main>
<svg id="lineContainer" aria-hidden="true"></svg>
<script>
    $(cat "$JS_FILE")
</script>
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

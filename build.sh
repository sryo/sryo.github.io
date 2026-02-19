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


# Load Configuration
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

friendly_message() {
    echo "$1"
    echo "   $2"
}

# Parse command-line options
while getopts ":d" opt; do
  case ${opt} in
    d )
      SELF_DESTRUCT=true
      ;;
    \? )
      friendly_message "Invalid Option" "Usage: $0 [-d]"
      exit 1
      ;;
  esac
done

# Check requirements
for file in "$CONTENT_DIR" "$CSS_FILE" "$JS_FILE"; do
    if [ ! -e "$file" ]; then
        friendly_message "Missing requirement: $file" "Please ensure all required files and directories exist."
        exit 1
    fi
done

# --- Helper Functions ---

extract_frontmatter_field() {
    local file=$1
    local field=$2
    sed -n '/^---$/,/^---$/p' "$file" | grep "^$field:" | sed "s/^$field: *//;s/^\"//;s/\"$//"
}

extract_title() {
    local file=$1
    local title=$(extract_frontmatter_field "$file" "title")

    if [ -z "$title" ]; then
        title=$(sed -n '1s/^#\{1,4\} //p' "$file" 2>/dev/null)
    fi

    if [ -z "$title" ]; then
        title=$(basename "$(dirname "$file")")
    fi
    echo "$title"
}

extract_date() {
    local file=$1
    extract_frontmatter_field "$file" "date"
}

extract_tags() {
    local file=$1
    local tags=$(extract_frontmatter_field "$file" "tags")
    # Remove brackets and clean up
    echo "$tags" | tr -d '[]' | sed 's/, */,/g'
}

extract_order() {
    local file=$1
    extract_frontmatter_field "$file" "order"
}

strip_frontmatter() {
    local file=$1
    if [[ $(head -n 1 "$file") == "---" ]]; then
        # Skip content between first and second --- markers
        awk 'BEGIN{skip=0} /^---$/{skip++; next} skip>=2{print}' "$file"
    else
        cat "$file"
    fi
}

insert_image() {
    local image_file=$1
    local alt_text=$2

    if [[ "$image_file" == *.svg ]] && $INLINE_SVG; then
        local b64_data
        if [[ "$OSTYPE" == "darwin"* ]]; then
            b64_data=$(base64 -i "$image_file" | tr -d '\n')
        else
            b64_data=$(base64 "$image_file" | tr -d '\n')
        fi
        echo "<img src=\"data:image/svg+xml;base64,$b64_data\" alt=\"$alt_text\" />"
    else
        echo "<img src=\"${image_file#/}\" loading=\"lazy\" alt=\"$alt_text\" />"
    fi
}

parse_markdown() {
    local line="$1"

    # Headers
    line=$(echo "$line" | sed 's/^# \(.*\)/<h1>\1<\/h1>/' 2>/dev/null)
    line=$(echo "$line" | sed 's/^## \(.*\)/<h2>\1<\/h2>/' 2>/dev/null)
    line=$(echo "$line" | sed 's/^### \(.*\)/<h3>\1<\/h3>/' 2>/dev/null)
    line=$(echo "$line" | sed 's/^#### \(.*\)/<h4>\1<\/h4>/' 2>/dev/null)

    # Inline Code
    line=$(echo "$line" | sed 's/`\([^`]*\)`/<code>\1<\/code>/g' 2>/dev/null)

    # Bold & Italic
    line=$(echo "$line" | sed 's/\*\*\([^*]*\)\*\*/<strong>\1<\/strong>/g' 2>/dev/null)
    line=$(echo "$line" | sed 's/\*\([^*]*\)\*/<em>\1<\/em>/g' 2>/dev/null)

    # Images (must come before links)
    line=$(echo "$line" | sed 's/!\[\([^]]*\)\](\([^)]*\))/<img src="\2" alt="\1" loading="lazy" \/>/g' 2>/dev/null)

    # Links
    line=$(echo "$line" | sed 's/\[\([^]]*\)\](\([^)]*\))/<a href="\2">\1<\/a>/g' 2>/dev/null)

    # Lists
    line=$(echo "$line" | sed 's/^- \(.*\)/<li>\1<\/li>/' 2>/dev/null)

    # Embed code
    if [[ "$line" == "EMBED:"* ]]; then
        echo "${line#EMBED:}"
        return
    fi

    echo "$line"
}

render_markdown_content() {
    local file=$1
    local content=""
    local in_paragraph=false
    local in_list=false
    local in_metrics=false
    local in_code_block=false
    local first_line=true

    while IFS= read -r line || [ -n "$line" ]; do
        # Skip legacy headers on first line
        if $first_line && [[ "$line" == "# "* ]]; then
            first_line=false
            continue
        fi
        first_line=false

        # Handle fenced code blocks
        if [[ "$line" == '```'* ]]; then
            if $in_code_block; then
                content+="</code></pre>"
                in_code_block=false
            else
                if $in_paragraph; then
                    content+="</p>"
                    in_paragraph=false
                fi
                if $in_list; then
                    content+="</ul>"
                    in_list=false
                fi
                content+="<pre><code>"
                in_code_block=true
            fi
            continue
        fi

        if $in_code_block; then
            local escaped_line="${line//&/&amp;}"
            escaped_line="${escaped_line//</&lt;}"
            escaped_line="${escaped_line//>/&gt;}"
            content+="$escaped_line
"
            continue
        fi

        # Handle METRICS block
        if [[ "$line" == "METRICS:" ]]; then
            if $in_paragraph; then
                content+="</p>"
                in_paragraph=false
            fi
            if $in_list; then
                content+="</ul>"
                in_list=false
            fi
            content+="<div class=\"metrics-grid\">"
            in_metrics=true
            continue
        fi

        # Parse metric items (format: - **value** label)
        if $in_metrics; then
            if [[ "$line" == "- "* ]]; then
                # Extract value and label from: - **value** label
                local metric_line="${line#- }"
                if [[ "$metric_line" =~ ^\*\*([^*]+)\*\*[[:space:]]*(.*) ]]; then
                    local value="${BASH_REMATCH[1]}"
                    local label="${BASH_REMATCH[2]}"
                    content+="<div class=\"metric\"><span class=\"metric-value\">$value</span><span class=\"metric-label\">$label</span></div>"
                fi
                continue
            elif [[ -z "$line" ]]; then
                content+="</div>"
                in_metrics=false
                continue
            fi
        fi

        parsed_line=$(parse_markdown "$line")

        # Check for list item
        if [[ "$parsed_line" == "<li>"* ]]; then
            if $in_paragraph; then
                content+="</p>"
                in_paragraph=false
            fi
            if ! $in_list; then
                content+="<ul>"
                in_list=true
            fi
            content+="$parsed_line"
            continue
        else
            if $in_list; then
                content+="</ul>"
                in_list=false
            fi
        fi

        if [[ "$parsed_line" == "<h"* || "$parsed_line" == "<div"* ]]; then
            if $in_paragraph; then
                content+="</p>"
                in_paragraph=false
            fi
            content+="$parsed_line"
        elif [[ -z "$parsed_line" ]]; then
            if $in_paragraph; then
                content+="</p>"
                in_paragraph=false
            fi
        else
            if ! $in_paragraph; then
                content+="<p>"
                in_paragraph=true
            fi
            content+="$parsed_line"
        fi
    done < <(strip_frontmatter "$file")

    # Close any open tags
    if $in_code_block; then
        content+="</code></pre>"
    fi
    if $in_metrics; then
        content+="</div>"
    fi
    if $in_list; then
        content+="</ul>"
    fi
    if $in_paragraph; then
        content+="</p>"
    fi
    echo "$content"
}

render_case_study_header() {
    local title=$1
    local date=$2
    local tags=$3
    local id=$4

    echo "<header class=\"case-study-header\">"
    echo "  <h1 id=\"title-$id\">$title</h1>"
    echo "  <div class=\"meta\">"

    if [ -n "$date" ]; then
        # Parse YYYY-MM-DD and format as "Month YYYY"
        local year=${date%%-*}
        local month_num=${date#*-}
        month_num=${month_num%%-*}
        month_num=${month_num#0}  # Remove leading zero

        local months=("" "January" "February" "March" "April" "May" "June"
                      "July" "August" "September" "October" "November" "December")
        local formatted_date="${months[$month_num]} ${year}"
        echo "    <time datetime=\"$date\">$formatted_date</time>"
    fi

    if [ -n "$tags" ]; then
        echo "    <div class=\"tags\">"
        IFS=',' read -ra tag_array <<< "$tags"
        for tag in "${tag_array[@]}"; do
            tag=$(echo "$tag" | xargs) # trim whitespace
            echo "      <span class=\"tag\">$tag</span>"
        done
        echo "    </div>"
    fi

    echo "  </div>"
    echo "</header>"
}

process_gallery() {
    local gallery_dir=$1

    for item in "$gallery_dir"/*; do
        if [ -d "$item" ]; then
            local item_content=$(find "$item" -maxdepth 1 -type f -iname \*.md | head -n 1)
            local item_image=""
            for ext in svg png jpg; do
                if [ -f "$item/icon.$ext" ]; then
                    item_image="$item/icon.$ext"
                    break
                fi
            done
            if [ -z "$item_image" ]; then
                item_image=$(find "$item" -maxdepth 1 -type f \( -iname \*.jpg -o -iname \*.png -o -iname \*.svg \) | head -n 1)
            fi

            if [ -f "$item_content" ]; then
                local title=$(extract_title "$item_content")
                local content=$(render_markdown_content "$item_content")

                echo "<div class=\"project\">"
                echo "  <div class=\"project-content\">"
                echo "    <h3>$title</h3>"
                echo "    $content"
                echo "  </div>"

                if [ -f "$item_image" ]; then
                    echo "  <div class=\"project-image\">"
                    insert_image "$item_image" "$title"
                    echo "  </div>"
                fi
                echo "</div>"
            fi
        fi
    done
}

process_section_item() {
    local folder=$1
    local section_id=$2
    local content_file=$(find "$folder" -maxdepth 1 -type f -iname \*.md | head -n 1)

    if [ ! -f "$content_file" ]; then return; fi

    local title=$(extract_title "$content_file")
    echo "  > Processing section: $title" >&2

    local image_file=""
    # Prefer icon.svg/png/jpg, fall back to any image
    for ext in svg png jpg; do
        if [ -f "$folder/icon.$ext" ]; then
            image_file="$folder/icon.$ext"
            break
        fi
    done
    if [ -z "$image_file" ]; then
        image_file=$(find "$folder" -maxdepth 1 -type f \( -iname \*.jpg -o -iname \*.png -o -iname \*.svg \) | head -n 1)
    fi
    local item_id="item-$section_id"
    local gallery_id="gallery-$section_id"

    echo "<label class=\"item\" title=\"$title\">"
    echo "  <input type=\"checkbox\" name=\"menu\" id=\"$item_id\" role=\"button\" tabindex=\"0\" aria-haspopup=\"dialog\" aria-controls=\"$gallery_id\" />"
    if [ -f "$image_file" ]; then
        insert_image "$image_file" "$title"
    else
        echo "  <div class=\"placeholder-image\">No Image</div>"
    fi
    echo "</label>"
}

process_section_gallery() {
    local folder=$1
    local section_id=$2
    local content_file=$(find "$folder" -maxdepth 1 -type f -iname \*.md | head -n 1)

    if [ ! -f "$content_file" ]; then return; fi

    local title=$(extract_title "$content_file")
    local date=$(extract_date "$content_file")
    local tags=$(extract_tags "$content_file")
    local content=$(render_markdown_content "$content_file")
    local item_id="item-$section_id"
    local gallery_id="gallery-$section_id"

    echo "<div class=\"gallery\" id=\"$gallery_id\" data-for=\"$item_id\" role=\"dialog\" tabindex=\"-1\" aria-labelledby=\"title-$section_id\">"
    render_case_study_header "$title" "$date" "$tags" "$section_id"
    echo "  $content"

    if [ -d "$folder/gallery" ]; then
        process_gallery "$folder/gallery"
    fi
    echo "</div>"
}

# --- Main Execution ---

# Prepare output
temp_dir=$(mktemp -d)
mkdir -p "$temp_dir/items" "$temp_dir/galleries"

# Process sections
echo "Building sections..."

# Collect folders with their order values
declare -a folder_order=()
for folder in "$CONTENT_DIR"*/; do
    content_file=$(find "$folder" -maxdepth 1 -type f -iname \*.md | head -n 1)
    if [ -f "$content_file" ]; then
        order=$(extract_order "$content_file")
        [ -z "$order" ] && order=9999
        folder_order+=("$order:$folder")
    fi
done

# Sort by order number and process
i=0
while IFS=: read -r order folder; do
    process_section_item "$folder" "$i" > "$temp_dir/items/$i.html"
    process_section_gallery "$folder" "$i" > "$temp_dir/galleries/$i.html"
    ((i++))
done < <(printf '%s\n' "${folder_order[@]}" | sort -t: -k1 -n)

# Assemble final HTML
echo "Assembling $OUTPUT_FILE..."

cat << EOF > "$OUTPUT_FILE"
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

# Add items (inside clock)
for ((j=0; j<i; j++)); do
    if [ -f "$temp_dir/items/$j.html" ]; then
        cat "$temp_dir/items/$j.html" >> "$OUTPUT_FILE"
    fi
done

cat << EOF >> "$OUTPUT_FILE"
</div>
EOF

# Add galleries (outside clock, so position:fixed works)
for ((j=0; j<i; j++)); do
    if [ -f "$temp_dir/galleries/$j.html" ]; then
        cat "$temp_dir/galleries/$j.html" >> "$OUTPUT_FILE"
    fi
done

cat << EOF >> "$OUTPUT_FILE"
</main>
<svg id="lineContainer" aria-hidden="true"></svg>
<script>
$(cat "$JS_FILE")
</script>
</body>
</html>
EOF

# Cleanup
rm -rf "$temp_dir"

echo "LineAndForm is done!"
full_path=$(cd "$(dirname "$OUTPUT_FILE")"; pwd)/$(basename "$OUTPUT_FILE")
echo "Open \"$full_path\" in a web browser to see your work."

if $SELF_DESTRUCT; then
    rm -- "$0"
    echo "Self-destructed."
fi

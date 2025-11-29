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
    # Default Configuration
    CONTENT_DIR="contents/"
    OUTPUT_FILE="works.html"
    TITLE="Interactive Gallery"
    CSS_FILE="styles.css"
    JS_FILE="script.js"
    INLINE_SVG=true
    SELF_DESTRUCT=false
fi

friendly_message() {
    echo "💡 $1"
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

extract_title() {
    local file=$1
    local title=$(sed -n '/^---$/,/^---$/p' "$file" | grep "^title:" | sed 's/^title: //;s/^"//;s/"$//')
    
    if [ -z "$title" ]; then
        title=$(sed -n '1s/^#\{1,4\} //p' "$file" 2>/dev/null)
    fi
    
    if [ -z "$title" ]; then
        title=$(basename "$(dirname "$file")")
    fi
    echo "$title"
}

strip_frontmatter() {
    local file=$1
    if [[ $(head -n 1 "$file") == "---" ]]; then
        sed '1,/^---$/d' "$file"
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
    
    # Links
    line=$(echo "$line" | sed 's/\[\([^]]*\)\](\([^)]*\))/<a href="\2">\1<\/a>/g' 2>/dev/null)
    
    # Lists (Simple implementation)
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
    local first_line=true

    while IFS= read -r line || [ -n "$line" ]; do
        # Skip legacy headers on first line if frontmatter is preferred
        if $first_line && [[ "$line" == "# "* ]]; then
            first_line=false
            continue
        fi
        first_line=false

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

    if $in_list; then
        content+="</ul>"
    fi
    if $in_paragraph; then
        content+="</p>"
    fi
    echo "$content"

}

process_gallery() {
    local gallery_dir=$1
    
    for item in "$gallery_dir"/*; do
        if [ -d "$item" ]; then
            local item_content=$(find "$item" -maxdepth 1 -type f -iname \*.md | head -n 1)
            local item_image=$(find "$item" -maxdepth 1 -type f \( -iname \*.jpg -o -iname \*.png -o -iname \*.svg \) | head -n 1)
            
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

process_section() {
    local folder=$1
    local content_file=$(find "$folder" -maxdepth 1 -type f -iname \*.md | head -n 1)
    
    if [ ! -f "$content_file" ]; then return; fi

    local title=$(extract_title "$content_file")
    echo "  > Processing section: $title" >&2
    local image_file=$(find "$folder" -maxdepth 1 -type f \( -iname \*.jpg -o -iname \*.png -o -iname \*.svg \) | head -n 1)
    local content=$(render_markdown_content "$content_file")

    echo "<label class=\"item\" title=\"$title\">"
    echo "  <input type=\"checkbox\" name=\"menu\" role=\"button\" tabindex=\"0\" aria-haspopup=\"dialog\" />"
    if [ -f "$image_file" ]; then
        insert_image "$image_file" "$title"
    else
        echo "  <div class=\"placeholder-image\">No Image</div>"
    fi
    echo "</label>"
    echo "<div class=\"gallery\" role=\"dialog\" tabindex=\"-1\" aria-hidden=\"false\" aria-modal=\"true\">"
    echo "  <h1>$title</h1>"
    echo "  $content"

    if [ -d "$folder/gallery" ]; then
        process_gallery "$folder/gallery"
    fi
    echo "</div>"
}

# What makes LineAndForm special:
# 1. It's simple: Just organize your content in folders, run the script, and you have a portfolio.
# 2. It's lightweight: Uses standard Unix tools. No heavy frameworks or complex dependencies.

# How to use LineAndForm:
# 1. Configure:
#    - Edit 'config.cfg' to set your title, output filename, and other options.
#    - Ensure 'styles.css' and 'script.js' are present (or point to them in config).

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

# --- Main Execution ---

# Prepare output
temp_dir=$(mktemp -d)
pids=""

# Process sections in parallel
echo "Building sections..."
i=0
for folder in "$CONTENT_DIR"*/; do
    (
        process_section "$folder" > "$temp_dir/$i.html"
    ) &
    pids="$pids $!"
    ((i++))
done

# Wait for all processes
wait $pids

# Assemble final HTML
echo "Assembling $OUTPUT_FILE..."

cat << EOF > "$OUTPUT_FILE"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$TITLE</title>
    <style>
    $(cat "$CSS_FILE")
    </style>
</head>
<body>
EOF

# Concatenate section HTMLs
for ((j=0; j<i; j++)); do
    if [ -f "$temp_dir/$j.html" ]; then
        cat "$temp_dir/$j.html" >> "$OUTPUT_FILE"
    fi
done

cat << EOF >> "$OUTPUT_FILE"
    <svg id="lineContainer"></svg>
    <script>
    $(cat "$JS_FILE")
    </script>
</body>
</html>
EOF

# Cleanup
rm -rf "$temp_dir"

echo "◯┃ LineAndForm is done!"
full_path=$(cd "$(dirname "$OUTPUT_FILE")"; pwd)/$(basename "$OUTPUT_FILE")
echo "Open \"$full_path\" in a web browser to see your work."

if $SELF_DESTRUCT; then
    rm -- "$0"
    echo "Self-destructed."
fi

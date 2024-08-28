#!/bin/bash

# ◯┃ LineAndForm (L+F)
# A Simple Portfolio Generator

# What is LineAndForm?
# LineAndForm is a lightweight, command-line tool that generates an interactive
# HTML portfolio from my content. It's designed for myself, but available to other
# creators who want a quick way to showcase their work online.

# How to use LineAndForm:
# 1. Set up your content:
#    - Create a 'contents/' directory in the same folder as this script.
#    - Inside 'contents/', make a folder for each main section of your portfolio.
#    - In each section folder:
#      a) Add a .md (Markdown) file with your content. Start it with '# Title'.
#      b) Optionally, add an image file (.jpg, .png, or .svg) for the section cover.
#    - For projects or sub-galleries:
#      a) Create a 'gallery' folder inside any section folder.
#      b) In the 'gallery' folder, make a subfolder for each project.
#      c) In each project folder, add a .md file and an image file.
#    - To add a video or other embed, include a line starting with 'EMBED:' in your .md file.

# 2. Run the script:
#    - Open a terminal in the folder containing this script.
#    - Run the command: ./build.sh (or bash build.sh)

# 3. View your portfolio:
#    - Open the generated 'works.html' file in a web browser.

# Configuration
CONTENT_DIR="contents/"
OUTPUT_FILE="works.html"
TITLE="Interactive Gallery"
CSS_FILE="styles.css"
JS_FILE="script.js"
INLINE_SVG=true

friendly_message() {
    echo "💡 $1"
    echo "   $2"
}

# Check if required directories and files exist
if [ ! -d "$CONTENT_DIR" ]; then
    friendly_message "The content directory '$CONTENT_DIR' is missing." \
    "Create a folder named 'contents' in the same directory as this script."
    exit 1
fi

if [ ! -f "$CSS_FILE" ]; then
    friendly_message "The CSS file '$CSS_FILE' is not found." \
    "Create a file named 'styles.css' in the same directory as this script."
    exit 1
fi

if [ ! -f "$JS_FILE" ]; then
    friendly_message "The JavaScript file '$JS_FILE' is not found." \
    "Create a file named 'script.js' in the same directory as this script."
    exit 1
fi

parse_markdown() {
    local line="$1"
    # Headers
    line=$(echo "$line" | sed 's/^# \(.*\)/<h1>\1<\/h1>/' 2>/dev/null)
    line=$(echo "$line" | sed 's/^## \(.*\)/<h2>\1<\/h2>/' 2>/dev/null)
    line=$(echo "$line" | sed 's/^### \(.*\)/<h3>\1<\/h3>/' 2>/dev/null)
    line=$(echo "$line" | sed 's/^#### \(.*\)/<h4>\1<\/h4>/' 2>/dev/null)

    # Bold
    line=$(echo "$line" | sed 's/\*\*\([^*]*\)\*\*/<strong>\1<\/strong>/g' 2>/dev/null)
    # Italic
    line=$(echo "$line" | sed 's/\*\([^*]*\)\*/<em>\1<\/em>/g' 2>/dev/null)
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

extract_title() {
    local file=$1
    local title=$(sed -n '1s/^#\{1,4\} //p' "$file" 2>/dev/null)
    if [ -z "$title" ]; then
        title=$(basename "$(dirname "$file")")
    fi
    echo "$title"
}

insert_image() {
    local image_file=$1
    local alt_text=$2

    if [[ "$image_file" == *.svg ]] && $INLINE_SVG; then
        cat "$image_file"
    else
        echo "<img src=\"${image_file#/}\" loading=\"lazy\" alt=\"$alt_text\" />"
    fi
}

generate_main_section() {
    local folder=$1
    local content_file=$(find "$folder" -maxdepth 1 -type f -iname \*.md | head -n 1)
    local title=$(extract_title "$content_file")
    local image_file=$(find "$folder" -maxdepth 1 -type f \( -iname \*.jpg -o -iname \*.png -o -iname \*.svg \) | head -n 1)

    if [ ! -f "$content_file" ]; then
        return
    fi

    echo "<label class=\"item\" title=\"$title\">"
    echo "  <input type=\"checkbox\" name=\"menu\" role=\"button\" tabindex=\"0\" aria-haspopup=\"dialog\" />"
    if [ -f "$image_file" ]; then
        insert_image "$image_file" "$title"
    else
        echo "  <div class=\"placeholder-image\">No Image</div>"
    fi
    echo "</label>"
    echo "<div class=\"gallery\" role=\"dialog\" tabindex=\"-1\" aria-hidden=\"false\" aria-modal=\"true\">"
    echo "  <h2>$title</h2>"

    # Parse and output the Markdown content
    local in_paragraph=false
    local first_line=true
    while IFS= read -r line || [ -n "$line" ]; do
        parsed_line=$(parse_markdown "$line")
        if [[ "$parsed_line" == "<h"* || "$parsed_line" == "<ul>"* || "$parsed_line" == "<li>"* ]]; then
            if $in_paragraph; then
                echo "</p>"
                in_paragraph=false
            fi
            echo "$parsed_line"
        elif [[ -z "$parsed_line" ]]; then
            if $in_paragraph; then
                echo "</p>"
                in_paragraph=false
            fi
        else
            if ! $in_paragraph; then
                echo "<p>"
                in_paragraph=true
            fi
            echo "$parsed_line"
        fi
    done < "$content_file"

    if $in_paragraph; then
        echo "</p>"
    fi

    # Check if gallery folder exists and generate gallery if it does
    if [ -d "$folder/gallery" ]; then
        generate_gallery "$folder/gallery"
    fi

    echo "</div>"
}

generate_gallery() {
    local gallery_dir=$1

    for item in "$gallery_dir"/*; do
        if [ -d "$item" ]; then
            local item_content=$(find "$item" -maxdepth 1 -type f -iname \*.md | head -n 1)
            local item_image=$(find "$item" -maxdepth 1 -type f \( -iname \*.jpg -o -iname \*.png -o -iname \*.svg \) | head -n 1)
            local embed_code=""

            echo "<div class=\"project\">"
            echo "  <div class=\"project-content\">"
            if [ -f "$item_content" ]; then
                local item_title=$(extract_title "$item_content")
                if [ -z "$item_title" ]; then
                    friendly_message "No title found in gallery item '${item##*/}'." \
                    "Add a heading (# Title) at the start of your .md file to set a custom title."
                    item_title="Untitled"
                fi
                echo "    <h3>$item_title</h3>"
                local in_paragraph=false
                local first_line=true
                while IFS= read -r line || [ -n "$line" ]; do
                    if $first_line; then
                        first_line=false
                        continue  # Skip the first line (title) as we've already used it
                    fi
                    parsed_line=$(parse_markdown "$line")
                    if [[ "$parsed_line" == "<div class=\"video-responsive\">"* ]]; then
                        embed_code="$parsed_line"
                    elif [[ "$parsed_line" == "<h"* || "$parsed_line" == "<ul>"* || "$parsed_line" == "<li>"* ]]; then
                        if $in_paragraph; then
                            echo "</p>"
                            in_paragraph=false
                        fi
                        echo "$parsed_line"
                    elif [[ -z "$parsed_line" ]]; then
                        if $in_paragraph; then
                            echo "</p>"
                            in_paragraph=false
                        fi
                    else
                        if ! $in_paragraph; then
                            echo "<p>"
                            in_paragraph=true
                        fi
                        echo "$parsed_line"
                    fi
                done < "$item_content"
                if $in_paragraph; then
                    echo "</p>"
                fi
            else
                friendly_message "No content file found for gallery item '${item##*/}'." \
                "Add a .md file to the '${item##*/}' folder in the gallery. Start with '# Title' to set the item's title."
            fi
            echo "  </div>"
            if [ -n "$embed_code" ]; then
                echo "  <div class=\"project-media\">"
                echo "    $embed_code"
                echo "  </div>"
            elif [ -f "$item_image" ]; then
                echo "  <div class=\"project-image\">"
                insert_image "$item_image" "${item_title:-Untitled}"
                echo "  </div>"
            fi
            echo "</div>"
        fi
    done
}

# Start generating the HTML file
cat << EOF > "$OUTPUT_FILE"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$TITLE</title>
    <style>
    $(cat "$CSS_FILE" 2>/dev/null)
    </style>
</head>
<body>
EOF

# Generate main sections
content_folders=("$CONTENT_DIR"*/)
if [ ${#content_folders[@]} -eq 0 ]; then
    friendly_message "No content folders found in '$CONTENT_DIR'." \
    "Add subfolders to the 'contents' directory. Each subfolder should contain a .md file and optionally an image file."
    exit 1
fi

for folder in "${content_folders[@]}"; do
    generate_main_section "$folder" >> "$OUTPUT_FILE"
done

# Close the HTML file
cat << EOF >> "$OUTPUT_FILE"
    <svg id="lineContainer"></svg>
    <script>
    $(cat "$JS_FILE" 2>/dev/null)
    </script>
</body>
</html>
EOF

echo "◯┃ LineAndForm is done!"
echo "Open \"$OUTPUT_FILE\" in a web browser to see your work."

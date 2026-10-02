# Builds offer-ring/index.html: works.html with its header and offers replaced by the offer ring.
import json, os, re, shutil

REPO = "/Users/mateoyadarola/Documents/sryo.github.io"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)

src = open(os.path.join(REPO, "works.html")).read()
names = dict(re.findall(r'href="work/([a-z-]+)/">.*?<span class="name">(.*?)</span>', src))

# Only the glyphs that prove an offer, in ring order.
ORDER = ["valora", "bancor", "trueframe", "continental", "avis", "ey-helix", "fin"]
OFFERS = [["valora", "fin"], ["bancor", "continental"], ["continental", "ey-helix", "valora"],
          ["bancor", "ey-helix", "valora"], ["trueframe", "avis", "fin"]]

def find(slug, name):
    for p in (f"contents/{slug}/{name}", f"contents/about/items/{slug}/{name}"):
        f = os.path.join(REPO, p)
        if os.path.exists(f):
            return open(f).read()
    raise SystemExit("no " + name + " for " + slug)

def inner(svg):
    return re.sub(r"\s+", " ", re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S).group(1)).strip()

data = {
    "glyphs": [{"slug": s, "name": names[s], "href": f"work/{s}/", "parts": inner(find(s, "_.parts.svg"))} for s in ORDER],
    "offers": OFFERS,
}

# No-JS: the XOR'd _.svg of each glyph in a row under the offers.
static = []
for s_ in ORDER:
    body = inner(find(s_, "_.svg")).replace('fill="black"', 'fill="currentColor"')
    static.append(f'<a class="or-static" href="work/{s_}/" tabindex="-1" aria-label="{names[s_]}"><svg viewBox="0 0 100 100">{body}</svg></a>')

hero = open(os.path.join(HERE, "hero.html")).read().replace("<!--STATIC-->", "\n".join(static))
css = open(os.path.join(HERE, "hero.css")).read()
js = open(os.path.join(HERE, "hero.js")).read()

start = src.index('<header class="intro">')
offers = src.index('<section class="group offers"')
end = src.index("</section>", offers) + len("</section>")
page = src[:start] + hero + src[end:]

s0 = page.index("    <style>")
s1 = page.index("    </style>") + len("    </style>")
page = page[:s0] + '    <link rel="stylesheet" href="styles.css">\n    <style>\n' + css + "\n    </style>\n" + \
    "    <script>document.documentElement.classList.add(\"or-js\");</script>" + page[s1:]
page = page.replace("</main>", "</main>\n<script type=\"application/json\" id=\"or-data\">" +
                    json.dumps(data, ensure_ascii=False) + "</script>\n<script>\n" + js + "\n</script>", 1)

shutil.copy(os.path.join(REPO, "styles.css"), os.path.join(OUT, "styles.css"))
shutil.copytree(os.path.join(REPO, "fonts"), os.path.join(OUT, "fonts"), dirs_exist_ok=True)
open(os.path.join(OUT, "index.html"), "w").write(page)
print("ok", len(page))

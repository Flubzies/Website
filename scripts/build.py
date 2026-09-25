#!/usr/bin/env python3
"""Injects shared HTML snippets from partials/ into every page, then
regenerates sitemap.xml from the pages on disk.

Each partial is the single source of truth for one duplicated snippet.
Edit the partial (or add a page), then run this script and commit the
regenerated files:

    python scripts/build.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://flubzies.dev"
PARTIALS_DIR = ROOT / "partials"
TARGET_GLOBS = ["*.html", "projects/*.html"]

# Maps a partial file to the regex span it replaces in every target page.
PARTIALS = {
    "footer.html": re.compile(r"<p>&copy;.*?</p>"),
}


def target_files():
    seen = set()
    for pattern in TARGET_GLOBS:
        for path in ROOT.glob(pattern):
            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                yield path


def main():
    changed = 0
    for partial_name, pattern in PARTIALS.items():
        partial_text = (PARTIALS_DIR / partial_name).read_text(encoding="utf-8").strip()
        for path in target_files():
            text = path.read_text(encoding="utf-8")
            new_text, count = pattern.subn(partial_text, text)
            if count and new_text != text:
                path.write_text(new_text, encoding="utf-8")
                changed += 1
                print(f"updated {path.relative_to(ROOT)}")
    if not changed:
        print("all pages already match their partials")
    write_sitemap()


def page_url(path):
    # Cloudflare redirects /page.html to /page, so list the extensionless form.
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return SITE_URL + "/"
    return f"{SITE_URL}/{rel.removesuffix('.html')}"


def write_sitemap():
    top_level = sorted(ROOT.glob("*.html"), key=lambda p: p.name != "index.html")
    pages = top_level + sorted(ROOT.glob("projects/*.html"))
    entries = "\n".join(f"  <url><loc>{page_url(p)}</loc></url>" for p in pages)
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}\n"
        "</urlset>\n"
    )
    path = ROOT / "sitemap.xml"
    if not path.exists() or path.read_text(encoding="utf-8") != sitemap:
        path.write_text(sitemap, encoding="utf-8", newline="\n")
        print(f"updated sitemap.xml ({len(pages)} pages)")


if __name__ == "__main__":
    main()

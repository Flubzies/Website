#!/usr/bin/env python3
"""Injects shared HTML snippets from partials/ into every page.

Each partial is the single source of truth for one duplicated snippet.
Edit the partial, then run this script and commit the regenerated pages:

    python scripts/build.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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


if __name__ == "__main__":
    main()

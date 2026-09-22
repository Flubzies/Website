#!/usr/bin/env python3
"""Regenerates every project's tech-tags list from a single source of truth.

TAGS below is the "database": each project lists which tags apply, in any
order. TAG_TIER classifies every tag that can appear. This script derives
the display order (Language/Engine/Version Control, then a spacer, then
everything else ranked by technicality) and rewrites the <ul class="tech-tags">
block in both projects/<slug>.html and its matching card on index.html, so
the two can never drift out of sync or out of order.

Edit TAGS (and TAG_TIER, for a brand-new tag) then run:

    python scripts/update_tags.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Tier 0: Language
# Tier 1: Engine
# Tier 2: Version control
# --- spacer ---
# Tier 3: Frameworks / runtime middleware
# Tier 4: Libraries / plugins
# Tier 5: Techniques / systems
# Tier 6: DCC / art tools
# Tier 7: Audio tools
TAG_TIER = {
    # Tier 0 - Language
    "C#": 0,
    "C++": 0,
    # Tier 1 - Engine
    "Unity": 1,
    "Unity3D": 1,
    "Unity 2018.3 (HDRP)": 1,
    "Unity 2019.1 (LWRP)": 1,
    "Unity 2020.3": 1,
    "Unreal Engine": 1,
    "Unreal Engine 4": 1,
    "Unreal Engine 5": 1,
    # Tier 2 - Version control
    "Git": 2,
    "Perforce": 2,
    # Tier 3 - Frameworks / runtime middleware
    "UI Toolkit": 3,
    "Unity Sentis": 3,
    "Mirror Networking": 3,
    "VRTK": 3,
    "NavMesh": 3,
    "FMOD": 3,
    # Tier 4 - Libraries / plugins
    "DOTween": 4,
    "NUnit": 4,
    "Odin": 4,
    "Amplify Shader Editor": 4,
    "Rewired": 4,
    "Cinemachine": 4,
    "TextMesh Pro": 4,
    "ParrelSync": 4,
    # Tier 5 - Techniques / systems
    "Procedural Generation": 5,
    "Custom Editor Tooling": 5,
    "Editor Tooling": 5,
    "Multiplayer": 5,
    "Local Multiplayer": 5,
    "Object Pooling": 5,
    "Finite State Machine AI": 5,
    "Dedicated Server": 5,
    "Fog of War": 5,
    "Gameplay Systems": 5,
    "Physical Prototyping": 5,
    "Accelerometer Controls": 5,
    "Voxel Terrain": 5,
    "Simplex Noise": 5,
    "Level Design": 5,
    # Tier 6 - DCC / art tools
    "Maya": 6,
    "ZBrush": 6,
    "Substance Painter": 6,
    "Photoshop": 6,
    "Blender": 6,
    "Mixamo": 6,
    # Tier 7 - Audio tools
    "FMOD Studio": 7,
    "LMMS": 7,
    "Bosca Ceoil": 7,
    "BFXR": 7,
    "Ableton Live": 7,
}

# The database: project slug -> the tags that apply to it, in any order.
TAGS = {
    "aljakun": [
        "C#", "Unity", "Git",
        "UI Toolkit", "Unity Sentis", "DOTween", "NUnit",
        "Procedural Generation", "Custom Editor Tooling",
    ],
    "badwiches": [
        "C++", "Unreal Engine", "Git",
        "Maya", "ZBrush", "Substance Painter", "Photoshop",
        "FMOD Studio", "LMMS",
    ],
    "das": [
        "C++", "Unreal Engine", "Perforce",
        "Multiplayer",
    ],
    "dataskream": [
        "C#", "Unity", "Git",
        "Odin", "DOTween", "Amplify Shader Editor",
        "Blender", "Maya", "ZBrush", "Photoshop", "Ableton Live",
    ],
    "fallguys": [
        "C#", "Unity", "Perforce",
        "Editor Tooling",
    ],
    "ferral": [
        "C#", "Unity3D", "Git",
        "Local Multiplayer",
        "Blender", "Photoshop", "Mixamo",
    ],
    "gallant": [
        "C#", "Unity3D", "Git",
        "Local Multiplayer",
        "Blender",
    ],
    "lumina": [
        "C#", "Unity", "Git",
        "Maya", "Blender", "Substance Painter", "Photoshop", "Bosca Ceoil",
    ],
    "niloc": [
        "C#", "Unity 2018.3 (HDRP)", "Git",
        "Odin", "DOTween", "Rewired", "FMOD", "Cinemachine",
        "Object Pooling", "Custom Editor Tooling",
    ],
    "plucky": [
        "C#", "Unity", "Git",
        "VRTK", "Odin", "DOTween",
        "Finite State Machine AI",
        "Blender",
    ],
    "redmirror": [
        "C#", "Unity 2020.3", "Git",
        "Mirror Networking", "NavMesh", "Odin", "DOTween", "ParrelSync",
        "Dedicated Server", "Fog of War",
    ],
    "robrawl": [
        "C#", "Unity 2019.1 (LWRP)", "Git",
        "Rewired", "Odin", "DOTween", "TextMesh Pro",
        "Local Multiplayer",
    ],
    "sod3": [
        "C++", "Unreal Engine 5", "Perforce",
        "Gameplay Systems",
    ],
    "sqube": [
        "Blender", "Photoshop", "Level Design", "Physical Prototyping",
    ],
    "the-exalted": [
        "C#", "Unity3D", "Git",
        "Photoshop", "BFXR", "Bosca Ceoil",
    ],
    "valiant": [
        "C#", "Unity3D", "Git",
        "Photoshop", "Bosca Ceoil", "Accelerometer Controls",
    ],
    "venture": [
        "C#", "Unity3D", "Git",
        "Procedural Generation", "Object Pooling", "Accelerometer Controls",
        "Photoshop", "BFXR",
    ],
    "worldcraft": [
        "C++", "Unreal Engine 4", "Git",
        "Procedural Generation", "Voxel Terrain", "Simplex Noise",
    ],
}

CORE_TIER_CUTOFF = 3  # tiers below this sit left of the spacer
TAG_UL_RE = re.compile(r'(?P<indent>[ \t]*)<ul class="tech-tags">\n(?P<body>.*?)\n(?P=indent)</ul>', re.DOTALL)


def ordered_tags(slug):
    tags = TAGS[slug]
    unknown = [t for t in tags if t not in TAG_TIER]
    if unknown:
        raise ValueError(f"{slug}: untiered tag(s) {unknown!r} - add them to TAG_TIER")
    ranked = sorted(tags, key=lambda t: (TAG_TIER[t], tags.index(t)))
    core = [t for t in ranked if TAG_TIER[t] < CORE_TIER_CUTOFF]
    rest = [t for t in ranked if TAG_TIER[t] >= CORE_TIER_CUTOFF]
    return core, rest


def render_block(indent, slug):
    core, rest = ordered_tags(slug)
    li_indent = indent + "  "
    lines = [f'{li_indent}<li>{tag}</li>' for tag in core]
    if core and rest:
        lines.append(f'{li_indent}<li class="tag-spacer" aria-hidden="true"></li>')
    lines.extend(f'{li_indent}<li>{tag}</li>' for tag in rest)
    return "\n".join(lines)


def update_project_pages():
    for slug in TAGS:
        path = ROOT / "projects" / f"{slug}.html"
        text = path.read_text(encoding="utf-8")
        match = TAG_UL_RE.search(text)
        if not match:
            raise ValueError(f"{path}: no tech-tags block found")
        new_body = render_block(match.group("indent"), slug)
        new_text = text[: match.start("body")] + new_body + text[match.end("body") :]
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            print(f"updated {path.relative_to(ROOT)}")


def update_index():
    path = ROOT / "index.html"
    text = path.read_text(encoding="utf-8")
    for slug in TAGS:
        anchor = f'href="projects/{slug}.html"'
        anchor_pos = text.find(anchor)
        if anchor_pos == -1:
            raise ValueError(f"index.html: no card found for {slug}")
        match = TAG_UL_RE.search(text, anchor_pos)
        if not match:
            raise ValueError(f"index.html: no tech-tags block found for {slug}")
        new_body = render_block(match.group("indent"), slug)
        text = text[: match.start("body")] + new_body + text[match.end("body") :]
    path.write_text(text, encoding="utf-8")
    print(f"updated {path.relative_to(ROOT)}")


def main():
    update_project_pages()
    update_index()


if __name__ == "__main__":
    main()

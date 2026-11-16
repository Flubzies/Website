#!/usr/bin/env python3
"""Exports Steam store and library art from one PhotoCraft document.

Each Steam slot is a top-level group named "<Section> (<W>x<H>) <N>", e.g.
"Screenshots (1920x1080) 5". Inside it:

    <ABBR>_Border     a dimmed layer with a window cut out: what Steam will show
    <ABBR>_Guide...   optional guides (e.g. the library hero's safe area)
    1 .. N            one group per image to export
    anything else     drafts (a "6" in a section of 5, "old", ...), never exported

Export (what steam/<project>/Export Steam Art.cmd runs):

    python scripts/steam_art.py export steam/aljakun/ZC_Steam.psd

writes group k of each section as <PREFIX>_<ABBR>_<k>.png in Exported/ beside the PSD, the
window cropped and resampled to exactly W x H, where PREFIX is the PSD name up
to its first "_" (ZC_Steam.psd -> ZC_HC_1.png). Exports that no longer have a
group are deleted, so a stale image can't be uploaded by mistake. It reads the
PSD as saved on disk and never writes to it.

Scaffold (one-off; adds the sections in SECTIONS that don't exist yet):

    python scripts/steam_art.py scaffold steam/aljakun/ZC_Steam.psd

edits a staged copy through photocraft-cli serve, checks it, backs the
original up to .backup/ beside it, then copies the result back. Close the PSD
in PhotoCraft first, or a stale window can later save over the result.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from PIL import Image

CLI = Path(r"C:\Program Files\PhotoCraft\photocraft-cli.exe")
SECTION_RE = re.compile(r"^(?P<name>.+?)\s*\((?P<w>\d+)x(?P<h>\d+)\)\s*(?P<n>\d+)$")
BORDER_SUFFIX = "_Border"
# Where exports go, beside the PSD.
EXPORT_DIR = "Exported"

# The canvas every section shares; the library hero needs it this wide.
CANVAS = (3840, 2160)

# (group name, abbreviation, width, height, images) in Layers panel order, top to bottom.
SECTIONS = [
    ("HeaderCapsule", "HC", 920, 430, 1),
    ("SmallCapsule", "SC", 462, 174, 1),
    ("MainCapsule", "MC", 1232, 706, 1),
    ("VerticalCapsule", "VC", 748, 896, 1),
    ("PageBackground", "PB", 1438, 810, 1),
    ("Screenshots", "SS", 1920, 1080, 5),
    ("LibraryCapsule", "LC", 600, 900, 1),
    ("LibraryHeader", "LHD", 920, 430, 1),
    ("LibraryHero", "LH", 3840, 1240, 1),
    ("LibraryLogo", "LL", 1280, 720, 1),
]
# Steam's library hero safe area: what stays visible however the client window is sized.
HERO_SAFE_AREA = (860, 380)
BORDER_OPACITY = 0.9


# --- reading the document --------------------------------------------------

def cli(*args):
    result = subprocess.run([str(CLI), *map(str, args)], capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        sys.exit(f"photocraft-cli {args[0]} failed:\n{result.stderr or result.stdout}")
    return result.stdout


def document_info(psd):
    return json.loads(cli("info", psd, "--compact"))


def walk(layers):
    for layer in layers:
        yield layer
        yield from walk(layer.get("children") or [])


class Section:
    def __init__(self, group):
        match = SECTION_RE.match(group["name"])
        self.group = group
        self.name = match["name"]
        self.size = (int(match["w"]), int(match["h"]))
        self.count = int(match["n"])
        children = group.get("children") or []
        borders = [c for c in children if c["name"].endswith(BORDER_SUFFIX)]
        self.border = borders[0] if borders else None
        self.abbr = self.border["name"][: -len(BORDER_SUFFIX)] if self.border else None
        self.images = {c["name"]: c for c in children if c["kind"] == "Group" and c["name"].isdigit()}


def has_pixels(layer):
    """Whether a layer, or anything visible inside a group, has painted pixels."""
    if layer["kind"] == "Group":
        return any(child["visible"] and has_pixels(child) for child in layer.get("children") or [])
    bounds = layer.get("bounds")
    return bool(bounds) and bounds[2] > 0 and bounds[3] > 0


def find_sections(info):
    return [Section(layer) for layer in info["layers"]
            if layer["kind"] == "Group" and SECTION_RE.match(layer["name"])]


def visibility_commands(info, show):
    """setProps commands that leave only the layers in `show` (and their ancestors) visible at the
    levels they compete on: every other top-level layer, and every other child of a shown group."""
    shown = {layer["id"] for layer in show}

    # The groups on the way down to each shown layer.
    ancestors = set()

    def collect(layers, path):
        for layer in layers:
            if layer["id"] in shown:
                ancestors.update(path)
            collect(layer.get("children") or [], path + [layer["id"]])

    commands = []

    def visit(layers):
        for layer in layers:
            visible = layer["id"] in shown or layer["id"] in ancestors
            commands.append(("layer.setProps", {"layer": layer["id"], "visible": visible}))
            if layer["id"] in ancestors:
                visit(layer.get("children") or [])

    collect(info["layers"], [])
    visit(info["layers"])
    return commands


def render(psd, commands, out):
    args = ["run", psd]
    for command, params in commands:
        args += ["--cmd", command, "--params", json.dumps(params)]
    cli(*args, "--out", out)


def find_window(psd, info, section, scratch):
    """The border's cut-out: the fully transparent area inside its opaque pixels, in canvas pixels."""
    probe = scratch / f"border_{section.abbr}.png"
    render(psd, visibility_commands(info, [section.border]), probe)
    alpha = Image.open(probe).getchannel("A")
    painted = alpha.point(lambda v: 255 if v else 0).getbbox()
    if not painted:
        return None
    hole = alpha.crop(painted).point(lambda v: 0 if v else 255).getbbox()
    if not hole:
        return None
    return (painted[0] + hole[0], painted[1] + hole[1], hole[2] - hole[0], hole[3] - hole[1])


# --- export ----------------------------------------------------------------

def export(psd):
    if is_photocraft_running():
        saved = datetime.fromtimestamp(psd.stat().st_mtime).strftime("%H:%M:%S")
        print(f"PhotoCraft is open: exporting {psd.name} as last saved at {saved}. Save first if that's not your latest.")

    info = document_info(psd)
    prefix = psd.stem.split("_")[0]
    out_dir = psd.parent / EXPORT_DIR
    out_dir.mkdir(exist_ok=True)
    sections = find_sections(info)
    if not sections:
        sys.exit(f"{psd.name} has no sections - groups named like 'HeaderCapsule (920x430) 1'")

    problems = 0
    written = []
    with tempfile.TemporaryDirectory() as scratch_name:
        scratch = Path(scratch_name)
        for section in sections:
            label = section.group["name"]
            if not section.border:
                print(f"error: {label} has no '<ABBR>{BORDER_SUFFIX}' layer to show its window")
                problems += 1
                continue
            window = find_window(psd, info, section, scratch)
            if not window:
                print(f"error: {section.border['name']} has no cut-out window")
                problems += 1
                continue

            x, y, w, h = window
            target_w, target_h = section.size
            if abs((w / h) / (target_w / target_h) - 1) > 0.01:
                print(f"warning: {section.border['name']} window is {w}x{h}, not the shape of {target_w}x{target_h}"
                      " - the export will be stretched")

            guides = [c for c in section.group.get("children") or [] if c["name"].startswith(f"{section.abbr}_Guide")]
            for k in range(1, section.count + 1):
                image = section.images.get(str(k))
                if not image:
                    print(f"missing: {label} has no group '{k}'")
                    continue
                if not has_pixels(image):
                    print(f"empty:   {label} group '{k}' has nothing in it yet")
                    continue
                crop = {"x": x, "y": y, "width": w, "height": h}
                if (w, h) != section.size:
                    crop.update(targetWidth=target_w, targetHeight=target_h, resample="lanczos")
                commands = visibility_commands(info, [image])
                # The border and guides are siblings of the image group, so already hidden; say so anyway in
                # case someone nests them.
                commands += [("layer.setProps", {"layer": g["id"], "visible": False}) for g in [section.border, *guides]]
                commands.append(("image.crop", crop))

                target = out_dir / f"{prefix}_{section.abbr}_{k}.png"
                partial = scratch / target.name
                render(psd, commands, partial)
                shutil.move(partial, target)
                written.append(target)
                print(f"{target.name}  {target_w}x{target_h}")

    # Anything this document exported before that it no longer has a group for.
    abbrs = {s.abbr for s in sections if s.abbr}
    stale_re = re.compile(rf"^{re.escape(prefix)}_({'|'.join(map(re.escape, abbrs))})_\d+\.png$") if abbrs else None
    for path in sorted(out_dir.glob(f"{prefix}_*.png")):
        if stale_re and stale_re.match(path.name) and path not in written:
            path.unlink()
            print(f"removed stale {path.name}")

    if problems:
        sys.exit(1)


def is_photocraft_running():
    result = subprocess.run(["tasklist", "/FI", "IMAGENAME eq photocraft.exe", "/NH"], capture_output=True, text=True)
    return "photocraft.exe" in result.stdout.lower()


# --- scaffold --------------------------------------------------------------

class Server:
    """photocraft-cli serve: one headless session answering JSON lines on stdio."""

    def __init__(self, root):
        self.process = subprocess.Popen(
            [str(CLI), "serve", "--automation-read-root", str(root), "--automation-write-root", str(root)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
        self.next_id = 0

    def call(self, method, params=None):
        self.next_id += 1
        self.process.stdin.write(json.dumps({"id": self.next_id, "method": method, "params": params or {}}) + "\n")
        self.process.stdin.flush()
        reply = json.loads(self.process.stdout.readline())
        if not reply.get("ok"):
            raise RuntimeError(f"{method} failed: {reply.get('error')}")
        return reply.get("result")

    def run(self, command, **params):
        return self.call("engine.execute", {"command": command, "params": params})

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(15)
        except subprocess.TimeoutExpired:
            self.process.kill()


def new_layer_id(result):
    if isinstance(result, dict):
        for key in ("layer", "id"):
            if isinstance(result.get(key), int):
                return result[key]
    raise RuntimeError(f"expected a new layer id, got {result!r}")


def make_border(server, abbr, width, height, group):
    server.run("layer.select", layer=group)
    layer = new_layer_id(server.run("layer.new.layer", name=f"{abbr}{BORDER_SUFFIX}"))
    server.run("layer.moveTo", layer=layer, target=group, position="into")
    server.run("layer.select", layer=layer)
    server.run("select.all")
    server.run("edit.fill", contents="color", color="#000000")
    server.run("select.rect", x=(CANVAS[0] - width) // 2, y=(CANVAS[1] - height) // 2, width=width, height=height,
               antiAlias=False)
    server.run("edit.clear")
    server.run("select.deselect")
    server.run("layer.setProps", layer=layer, opacity=BORDER_OPACITY)
    return layer


def make_safe_area_guide(server, abbr, group, border):
    server.run("layer.select", layer=border)
    layer = new_layer_id(server.run("layer.new.layer", name=f"{abbr}_Guide_SafeArea", position="below"))
    width, height = HERO_SAFE_AREA
    x, y = (CANVAS[0] - width) // 2, (CANVAS[1] - height) // 2
    line = 4
    server.run("select.rect", x=x, y=y, width=width, height=height, antiAlias=False)
    server.run("edit.fill", contents="color", color="#ff3b30")
    server.run("select.rect", x=x + line, y=y + line, width=width - 2 * line, height=height - 2 * line,
               antiAlias=False)
    server.run("edit.clear")
    server.run("select.deselect")
    return layer


def scaffold(psd):
    if is_photocraft_running():
        sys.exit("PhotoCraft is open. Save and close the PSD there first (a stale window can save over the result).")

    before = document_info(psd)
    if before["width"] > CANVAS[0] or before["height"] > CANVAS[1]:
        sys.exit(f"{psd.name} is {before['width']}x{before['height']}, bigger than {CANVAS[0]}x{CANVAS[1]}")
    original_mtime = psd.stat().st_mtime
    existing = {Section(g).name: Section(g) for g in before["layers"]
                if g["kind"] == "Group" and SECTION_RE.match(g["name"])}

    with tempfile.TemporaryDirectory() as stage_name:
        stage = Path(stage_name)
        staged = stage / "staged.psd"
        shutil.copy2(psd, staged)

        server = Server(stage)
        try:
            server.call("doc.open", {"path": staged.name})
            if (before["width"], before["height"]) != CANVAS:
                server.run("image.canvasSize", width=CANVAS[0], height=CANVAS[1], anchor="center",
                           extensionColor="transparent")

            above = None
            for name, abbr, width, height, count in SECTIONS:
                label = f"{name} ({width}x{height}) {count}"
                section = existing.get(name)
                if section:
                    group = section.group["id"]
                    if section.size != (width, height) or section.abbr != abbr:
                        # Wrong size or no proper border: rename and rebuild the border, keep the images.
                        server.run("layer.setProps", layer=group, name=label)
                        if section.border:
                            server.run("layer.delete", layer=section.border["id"])
                        make_border(server, abbr, width, height, group)
                    print(f"kept     {section.group['name']}" if section.group["name"] == label
                          else f"fixed    {section.group['name']} -> {label}")
                else:
                    server.run("layer.select", layer=above if above else before["layers"][0]["id"])
                    group = new_layer_id(server.run("layer.new.group", name=label))
                    if above:
                        server.run("layer.moveTo", layer=group, target=above, position="below")
                    # Numbered groups first, last to first, so "into" stacks them 1..N under the border.
                    for k in range(count, 0, -1):
                        server.run("layer.select", layer=group)
                        image = new_layer_id(server.run("layer.new.group", name=str(k)))
                        server.run("layer.moveTo", layer=image, target=group, position="into")
                    border = make_border(server, abbr, width, height, group)
                    if abbr == "LH":
                        make_safe_area_guide(server, abbr, group, border)
                    server.run("layer.setProps", layer=group, visible=False)
                    server.run("layer.setExpanded", layer=group, expanded=False)
                    print(f"added    {label}")
                above = group

            server.call("doc.save", {"path": staged.name})
            server.call("doc.close")
        finally:
            server.close()

        check_scaffold(staged, before, stage)

        if psd.stat().st_mtime != original_mtime:
            sys.exit(f"{psd.name} was saved while this ran; nothing copied back.")
        backup_dir = psd.parent / ".backup"
        backup_dir.mkdir(exist_ok=True)
        backup = backup_dir / f"{psd.stem}_{datetime.fromtimestamp(original_mtime):%Y%m%d-%H%M%S}.psd"
        shutil.copy2(psd, backup)
        shutil.copy2(staged, psd)
        print(f"backed up the original to {backup}")
        print(f"scaffolded {psd}")


def check_scaffold(staged, before, scratch):
    after = document_info(staged)
    if (after["width"], after["height"]) != CANVAS:
        sys.exit(f"staged canvas is {after['width']}x{after['height']}, expected {CANVAS[0]}x{CANVAS[1]}")

    # Nothing that was there may disappear, borders aside (rebuilt).
    kept = {(l["name"], l["kind"]) for l in walk(after["layers"])}
    lost = [l["name"] for l in walk(before["layers"])
            if (l["name"], l["kind"]) not in kept and not l["name"].endswith(BORDER_SUFFIX)
            and not SECTION_RE.match(l["name"])]
    if lost:
        sys.exit(f"layers lost in the staged copy: {lost}")

    sections = {s.name: s for s in find_sections(after)}
    for name, abbr, width, height, count in SECTIONS:
        section = sections.get(name)
        if not section or section.abbr != abbr or section.size != (width, height):
            sys.exit(f"staged copy: {name} is missing or misnamed")
        missing = [k for k in range(1, count + 1) if str(k) not in section.images]
        if missing:
            sys.exit(f"staged copy: {name} has no group(s) {missing}")
        window = find_window(staged, after, section, scratch)
        if not window or window[2:] != (width, height):
            sys.exit(f"staged copy: {abbr}{BORDER_SUFFIX} window is {window}, expected {width}x{height}")


def main():
    parser = argparse.ArgumentParser(description="Export (or scaffold) Steam art sections in a PhotoCraft PSD.")
    parser.add_argument("command", choices=["export", "scaffold"])
    parser.add_argument("psd", type=Path)
    args = parser.parse_args()

    if not CLI.exists():
        sys.exit(f"{CLI} not found - is PhotoCraft installed?")
    psd = args.psd.resolve()
    if not psd.exists():
        sys.exit(f"{psd} doesn't exist")

    if args.command == "export":
        export(psd)
    else:
        scaffold(psd)


if __name__ == "__main__":
    main()

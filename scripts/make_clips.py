#!/usr/bin/env python3
"""Encodes raw screen recordings into website clips and Steam store clips.

Drop recordings (mp4/mkv/mov/webm) into recordings/<project>/ and run:

    python scripts/make_clips.py <project>            e.g. aljakun
    python scripts/make_clips.py <project> --force    re-encode everything

Each recording <name>.<ext> becomes:

    Assets/<project>/clips/<name>.mp4   the website copy (trimmed only if clips.json says so)
    steam/<project>/<name>.mp4          the Steam "About This Game" copy, 12 seconds at most

Both are silent H.264, BT.709, always 1920x1080 at 60 fps so every clip on a
page matches (Steam shows a full-screen option on anything over 1600 wide). A
recording that isn't 16:9 is letterboxed; one smaller than 1080p is scaled up
with a warning, since that adds no detail - record at 1080p or higher. Steam's
limit for animated description assets is 12 seconds, so the Steam copy is cut
from steam_start.

Trims live in recordings/<project>/clips.json, keyed by recording name; every
field is optional and a recording with no entry is encoded whole:

    {
      "zc_hero": {
        "start": 2.5,          website copy starts here (seconds), default 0
        "end": 20,             website copy ends here, default the recording's end
        "steam_start": 6,      Steam copy starts here, default start
        "steam_length": 10,    Steam copy length, default and maximum 12
        "website": false,      skip the website copy
        "steam": false         skip the Steam copy
      }
    }

recordings/ and steam/ are kept out of the deployed site (.assetsignore), and
the recordings themselves stay out of git; only clips.json is committed.
A clip is skipped while it's newer than both its recording and clips.json.
"""

import argparse
import json
import shutil
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RECORDING_EXTENSIONS = {".mp4", ".mkv", ".mov", ".webm"}
STEAM_MAX_SECONDS = 12.0
WIDTH = 1920
HEIGHT = 1080
FPS = 60

# CRF: lower is sharper and bigger. Steam clips load on every store visit, so
# they're squeezed a little harder than the website's.
WEBSITE_CRF = 23
STEAM_CRF = 25


def require_tool(name):
    path = shutil.which(name)
    if not path:
        sys.exit(f"{name} not found on PATH - install FFmpeg (winget install Gyan.FFmpeg)")
    return path


def probe(path):
    """Returns (duration seconds, width, height, frame rate) of the recording's video stream."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=True)
    info = json.loads(result.stdout)
    stream = info["streams"][0]
    duration = float(info["format"]["duration"])
    fps = float(Fraction(stream["r_frame_rate"]))
    return duration, stream["width"], stream["height"], fps


def encode(source, target, start, length, crf):
    filters = [
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos:out_color_matrix=bt709",
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2",
        "setsar=1",
        f"fps={FPS}",
    ]
    target.parent.mkdir(parents=True, exist_ok=True)
    # Encode to a temp name so a failed or interrupted run never leaves a half-written clip.
    partial = target.with_name(target.stem + ".partial.mp4")
    command = [
        "ffmpeg", "-y", "-v", "error", "-stats",
        "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{length:.3f}",
        "-vf", ",".join(filters),
        "-an",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-movflags", "+faststart",
        str(partial),
    ]
    subprocess.run(command, check=True)
    partial.replace(target)


def is_current(target, *inputs):
    if not target.exists():
        return False
    built = target.stat().st_mtime
    return all(built > path.stat().st_mtime for path in inputs if path.exists())


def main():
    parser = argparse.ArgumentParser(description="Encode recordings/<project>/ into website and Steam clips.")
    parser.add_argument("project", help="folder name under recordings/, e.g. aljakun")
    parser.add_argument("--force", action="store_true", help="re-encode clips that look up to date")
    args = parser.parse_args()

    require_tool("ffmpeg")
    require_tool("ffprobe")

    recordings = ROOT / "recordings" / args.project
    if not recordings.is_dir():
        sys.exit(f"{recordings.relative_to(ROOT)} doesn't exist - make it and drop recordings in")

    manifest_path = recordings / "clips.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}

    sources = sorted(p for p in recordings.iterdir() if p.suffix.lower() in RECORDING_EXTENSIONS)
    if not sources:
        sys.exit(f"no recordings in {recordings.relative_to(ROOT)}")

    unknown = sorted(set(manifest) - {p.stem for p in sources})
    for name in unknown:
        print(f"warning: clips.json has '{name}' but there's no recording by that name")

    website_dir = ROOT / "Assets" / args.project / "clips"
    steam_dir = ROOT / "steam" / args.project

    for source in sources:
        entry = manifest.get(source.stem, {})
        duration, width, height, fps = probe(source)
        if width < WIDTH or height < HEIGHT or fps < FPS:
            print(f"warning: {source.name} is {width}x{height} at {fps:g} fps - its clips are stretched to "
                  f"{WIDTH}x{HEIGHT} at {FPS} fps but won't gain detail; re-record it at 1080p60")

        start = float(entry.get("start", 0))
        end = min(float(entry.get("end", duration)), duration)
        if start >= end:
            sys.exit(f"{source.name}: start {start}s is at or past its end {end}s")

        if entry.get("website", True):
            target = website_dir / f"{source.stem}.mp4"
            if args.force or not is_current(target, source, manifest_path):
                print(f"website  {source.name}  {start:g}s-{end:g}s")
                encode(source, target, start, end - start, WEBSITE_CRF)

        if entry.get("steam", True):
            steam_start = float(entry.get("steam_start", start))
            steam_length = min(float(entry.get("steam_length", STEAM_MAX_SECONDS)), STEAM_MAX_SECONDS,
                               duration - steam_start)
            if steam_length <= 0:
                sys.exit(f"{source.name}: steam_start {steam_start}s is past the recording's end")
            target = steam_dir / f"{source.stem}.mp4"
            if args.force or not is_current(target, source, manifest_path):
                print(f"steam    {source.name}  {steam_start:g}s-{steam_start + steam_length:g}s")
                encode(source, target, steam_start, steam_length, STEAM_CRF)

    for folder in (website_dir, steam_dir):
        if folder.is_dir():
            for clip in sorted(folder.glob("*.mp4")):
                print(f"{clip.relative_to(ROOT)}  {clip.stat().st_size / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()

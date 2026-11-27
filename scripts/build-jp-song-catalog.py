#!/usr/bin/env python3
"""Build the compact JP song catalogue from every data/playlists/wsilt*.json file.

Run from the repository root:
    python scripts/build-jp-song-catalog.py

Source playlist JSON files are never modified. Duplicate YouTube video IDs keep
their first occurrence in natural filename order. Entries without a title are
kept as UNKNOWN SONG so they remain searchable by channel/uploader and playable.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
PLAYLIST_DIR = ROOT / "data" / "playlists"
OUTPUT = PLAYLIST_DIR / "jp-song-catalog.json"


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"(\d+)", path.name)]


def video_id(entry: dict) -> str:
    value = str(entry.get("id") or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", value):
        return value
    url = str(entry.get("url") or "").strip()
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if host == "youtu.be":
            return parsed.path.strip("/").split("/")[0]
        if host.endswith("youtube.com"):
            if parsed.path == "/watch":
                return parse_qs(parsed.query).get("v", [""])[0]
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) > 1 and parts[0] in {"embed", "shorts", "live"}:
                return parts[1]
    except Exception:
        pass
    return ""


def best_thumbnail(entry: dict) -> str:
    thumbnails = entry.get("thumbnails")
    if not isinstance(thumbnails, list):
        return ""
    valid = [item for item in thumbnails
             if isinstance(item, dict) and isinstance(item.get("url"), str)]
    if not valid:
        return ""
    best = max(valid, key=lambda item: int(item.get("width") or 0))
    return best["url"]


def main():
    source_files = sorted(PLAYLIST_DIR.glob("wsilt*.json"), key=natural_key)
    if not source_files:
        raise SystemExit("No wsilt*.json source files found in data/playlists/")

    seen = set()
    songs = []
    source_counts = []

    for path in source_files:
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = data.get("entries", []) if isinstance(data, dict) else []
        if not isinstance(entries, list):
            print(f"Skipping {path.name}: no entries array")
            continue

        kept = duplicates = 0
        for item in entries:
            if not isinstance(item, dict):
                continue
            identifier = video_id(item)
            if not identifier or identifier in seen:
                if identifier:
                    duplicates += 1
                continue
            seen.add(identifier)
            kept += 1
            channel = str(item.get("channel") or "").strip()
            uploader = str(item.get("uploader") or "").strip()
            title = str(item.get("title") or "").strip() or "UNKNOWN SONG"
            songs.append({
                "videoId": identifier,
                "title": title,
                "artist": channel or uploader,
                "channel": channel,
                "uploader": uploader,
                "image": best_thumbnail(item),
            })

        source_counts.append({
            "file": path.name,
            "entries": len(entries),
            "kept": kept,
            "duplicateVideoIds": duplicates,
        })

    catalogue = {
        "version": 1,
        "uniqueSongCount": len(songs),
        "sources": [item["file"] for item in source_counts],
        "songs": songs,
    }
    OUTPUT.write_text(
        json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Created {OUTPUT.relative_to(ROOT)}")
    print(f"Unique songs: {len(songs):,}")
    print(f"Sources: {len(source_counts)}")
    print(f"Duplicate video IDs skipped: {sum(x['duplicateVideoIds'] for x in source_counts):,}")
    print(f"Songs labelled UNKNOWN SONG: {sum(x['title'] == 'UNKNOWN SONG' for x in songs):,}")


if __name__ == "__main__":
    main()

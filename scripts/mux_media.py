#!/usr/bin/env python3
"""Mux a narration track onto a video clip with ffmpeg.

Part of the NBA voiceover pipeline (docs/NBA_PIPELINE_SPEC.md).

Video stream is copied (no re-encode, no quality loss); the narration audio
is encoded to AAC because raw WAV does not belong in an MP4 container.

    ffmpeg -i raw_video.mp4 -i output.wav -c:v copy -c:a aac \
        -map 0:v:0 -map 1:a:0 final_video.mp4

Usage:
    python scripts/mux_media.py game.mp4 output.wav [-o final_video.mp4]

Requires ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys


def require_ffmpeg() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit(
            "ffmpeg not found on PATH. Install it first:\n"
            "  winget install Gyan.FFmpeg   (Windows)\n"
            "  apt install ffmpeg           (Debian/Ubuntu)"
        )
    return ffmpeg


def mux(video: str, audio: str, out: str) -> None:
    ffmpeg = require_ffmpeg()
    cmd = [
        ffmpeg,
        "-y",                 # overwrite output without asking
        "-i", video,
        "-i", audio,
        "-c:v", "copy",       # video stream copied verbatim — never re-encoded
        "-c:a", "aac",        # WAV -> AAC for the MP4 container
        "-map", "0:v:0",      # video from input 0 only
        "-map", "1:a:0",      # audio from input 1 only (drops any source audio)
        "-shortest",          # end when the shorter stream ends
        out,
    ]
    print("running:", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # ffmpeg writes its progress/diagnostics to stderr.
        tail = "\n".join(result.stderr.strip().splitlines()[-15:])
        sys.exit(f"ffmpeg failed (exit {result.returncode}):\n{tail}")
    print(f"wrote {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video", help="Original clip (.mp4)")
    parser.add_argument("audio", help="Narration track (.wav)")
    parser.add_argument(
        "-o", "--out",
        help="Output path (default: <video stem>_final.mp4 next to the video)",
    )
    args = parser.parse_args()

    import os

    for path in (args.video, args.audio):
        if not os.path.exists(path):
            sys.exit(f"No such file: {path}")

    out = args.out or os.path.splitext(args.video)[0] + "_final.mp4"
    mux(args.video, args.audio, out)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Analyze an NBA game clip with Gemini and produce a voiceover script.

Part of the NBA voiceover pipeline (docs/NBA_PIPELINE_SPEC.md).

Uploads a video to the Gemini File API, asks Gemini to watch it and return a
high-energy narration script timed to the action, and prints/saves:

    { "duration_sec": int, "script": str, "timestamps": [ {start, end, text} ] }

Credentials: reads GEMINI_API_KEY from the environment. Never hardcode a key.

Usage:
    python scripts/analyze_clip.py game.mp4 [-o script.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

PROMPT_TEMPLATE = (
    "Analyze this NBA game footage. Identify the key plays, player movements, "
    "and momentum shifts. Generate an engaging, high-energy narrative "
    "voiceover script that matches the timing and action of the clip. Return "
    "JSON with { 'duration_sec': int, 'script': string, 'timestamps': [...] } "
    "where timestamps is a list of { 'start': number, 'end': number, "
    "'text': string } objects covering the whole clip in order. "
    "Return ONLY the JSON object, no markdown fences, no commentary."
)

MODEL = "gemini-2.0-flash"
UPLOAD_POLL_SECONDS = 5
UPLOAD_TIMEOUT_SECONDS = 300


def require_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        sys.exit(
            "GEMINI_API_KEY is not set. Export it first:\n"
            "  export GEMINI_API_KEY=...   (bash)\n"
            "  setx GEMINI_API_KEY ...     (Windows, new shells only)"
        )
    return key


def upload_video(client, path: str):
    """Upload to the File API and wait until the asset is ACTIVE."""
    print(f"uploading {path} ...")
    video_file = client.files.upload(file=path)
    name = video_file.name

    deadline = time.time() + UPLOAD_TIMEOUT_SECONDS
    while time.time() < deadline:
        state = client.files.get(name=name).state.name
        if state == "ACTIVE":
            print("upload processed.")
            return video_file
        if state == "FAILED":
            sys.exit(f"Gemini failed to process {path} (state=FAILED).")
        print(f"  processing ({state}) ...")
        time.sleep(UPLOAD_POLL_SECONDS)
    sys.exit(f"Timed out waiting for {name} to become ACTIVE.")


def extract_json(text: str) -> dict:
    """Parse the model response as JSON, tolerating markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # ```json\n{...}\n```  ->  {...}
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
        cleaned = cleaned.strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        sys.exit(
            f"Gemini returned non-JSON output ({e}). Raw response starts:\n"
            f"{text[:400]}"
        )
    for field in ("duration_sec", "script", "timestamps"):
        if field not in data:
            sys.exit(f"Gemini JSON missing required field '{field}'.")
    return data


def analyze(path: str) -> dict:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=require_key())
    video_file = upload_video(client, path)

    response = client.models.generate_content(
        model=MODEL,
        contents=[
            video_file,
            PROMPT_TEMPLATE,
        ],
        config=types.GenerateContentConfig(
            temperature=0.7,  # narration wants energy; the JSON shape keeps it honest
            response_mime_type="application/json",
        ),
    )

    data = extract_json(response.text)

    # Housekeeping: delete the uploaded file so the File API quota does not fill.
    try:
        client.files.delete(name=video_file.name)
    except Exception as e:  # non-fatal
        print(f"note: could not delete uploaded file {video_file.name}: {e}")

    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video", help="Path to the .mp4 clip")
    parser.add_argument("-o", "--out", help="Write JSON here instead of stdout")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        sys.exit(f"No such file: {args.video}")
    if not args.video.lower().endswith((".mp4", ".mov", ".webm")):
        print("warning: Gemini File API expects mp4/mov/webm — continuing anyway.")

    data = analyze(args.video)
    rendered = json.dumps(data, indent=2, ensure_ascii=False)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(rendered + "\n")
        print(f"wrote {args.out}")
        # Also drop script.txt next to it — the Colab worker's expected input.
        sibling = os.path.join(os.path.dirname(os.path.abspath(args.out)), "script.txt")
        with open(sibling, "w", encoding="utf-8") as f:
            f.write(data["script"])
        print(f"wrote {sibling} (Colab worker input)")
    else:
        print(rendered)


if __name__ == "__main__":
    main()

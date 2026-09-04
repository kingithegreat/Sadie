#!/usr/bin/env python3
"""HTTP wrapper around scripts/analyze_clip.py for the n8n orchestrator.

Part of the NBA voiceover pipeline (docs/NBA_PIPELINE_SPEC.md).

The n8n workflow cannot exec a CLI script mid-execution with a 300 s timeout
and JSON in/out, so this server exposes the analyzer over one endpoint:

    POST /analyze   {"videoPath": "C:/.../game.mp4"}
                    -> 200 {"duration_sec": int, "script": str, "timestamps": [...]}
                    -> 400 {"error": "..."}          bad request body/path
                    -> 404 {"error": "..."}          video file missing
                    -> 500 {"error": "..."}          Gemini/SDK failure
    GET  /health    -> 200 {"ok": true, "model": "gemini-2.0-flash"}

stdlib only — no Flask/FastAPI dependency. The Gemini SDK is imported lazily
inside analyze(), exactly as the CLI does.

Usage:
    python scripts/analyzer_server.py            # port 8000
    NBA_ANALYZER_PORT=9000 python scripts/analyzer_server.py

Credentials: reads GEMINI_API_KEY from the environment at request time.
Never hardcode a key.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The analyzer lives next to this file; import it regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_clip  # noqa: E402

DEFAULT_PORT = 8000
MAX_BODY_BYTES = 1_000_000


def parse_analyze_request(body: bytes) -> tuple[str | None, str | None]:
    """Return (videoPath, error). Exactly one is None."""
    if not body:
        return None, "empty request body"
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        return None, f"body is not valid JSON: {e}"
    if not isinstance(data, dict):
        return None, "body must be a JSON object"
    path = data.get("videoPath")
    if not path or not isinstance(path, str):
        return None, "'videoPath' (string) is required"
    if not os.path.exists(path):
        return None, f"no such file: {path}"
    return path, None


class AnalyzerHandler(BaseHTTPRequestHandler):
    server_version = "NBAAnalyzer/1.0"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        if self.path.rstrip("/") == "/health":
            self._send(200, {"ok": True, "model": analyze_clip.MODEL})
        else:
            self._send(404, {"error": f"unknown route {self.path}"})

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        if self.path.rstrip("/") != "/analyze":
            self._send(404, {"error": f"unknown route {self.path}"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(400, {"error": f"Content-Length must be 1..{MAX_BODY_BYTES}"})
            return
        video_path, error = parse_analyze_request(self.rfile.read(length))
        if error:
            status = 404 if error.startswith("no such file") else 400
            self._send(status, {"error": error})
            return
        try:
            result = analyze_clip.analyze(video_path)
        except SystemExit as e:
            # analyze_clip exits with a message on SDK/quota failures.
            self._send(500, {"error": str(e)})
            return
        except Exception as e:  # unexpected — still answer, never hang the workflow
            self._send(500, {"error": f"{type(e).__name__}: {e}"})
            return
        self._send(200, result)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[analyzer] {self.address_string()} {fmt % args}")


def main() -> None:
    port = int(os.environ.get("NBA_ANALYZER_PORT") or DEFAULT_PORT)
    server = ThreadingHTTPServer(("127.0.0.1", port), AnalyzerHandler)
    print(f"analyzer listening on http://127.0.0.1:{port} (model: {analyze_clip.MODEL})")
    print("GEMINI_API_KEY must be set in this process's environment.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping.")


if __name__ == "__main__":
    main()

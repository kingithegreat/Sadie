"""Quick logic checks for scripts/analyzer_server.py — no network, no SDK.

Run:  python scripts/test_server_logic.py
"""

import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location(
    "analyzer_server", os.path.join(os.path.dirname(__file__), "analyzer_server.py")
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

failures = []


def check(name, fn):
    try:
        fn()
        print(f"  ok  {name}")
    except AssertionError as e:
        failures.append(name)
        print(f"FAIL  {name}: {e}")
    except SystemExit as e:
        failures.append(name)
        print(f"FAIL  {name}: unexpected SystemExit: {e.code}")


HERE = os.path.dirname(os.path.abspath(__file__))
EXISTING = os.path.join(HERE, "mux_media.py")  # any real file


def valid_body_parses():
    path, err = m.parse_analyze_request(
        json.dumps({"videoPath": EXISTING}).encode("utf-8")
    )
    assert err is None, f"unexpected error: {err}"
    assert path == EXISTING


def empty_body_rejected():
    path, err = m.parse_analyze_request(b"")
    assert path is None and err == "empty request body"


def non_json_rejected():
    path, err = m.parse_analyze_request(b"not json at all")
    assert path is None and "not valid JSON" in err


def non_object_rejected():
    path, err = m.parse_analyze_request(b"[1,2,3]")
    assert path is None and "JSON object" in err


def missing_videopath_rejected():
    path, err = m.parse_analyze_request(b"{}")
    assert path is None and "videoPath" in err


def wrong_type_videopath_rejected():
    path, err = m.parse_analyze_request(b'{"videoPath": 42}')
    assert path is None and "videoPath" in err


def missing_file_rejected():
    ghost = os.path.join(HERE, "no_such_clip_xyz.mp4")
    path, err = m.parse_analyze_request(
        json.dumps({"videoPath": ghost}).encode("utf-8")
    )
    assert path is None and "no such file" in err


for name, fn in [
    ("valid body parses", valid_body_parses),
    ("empty body rejected", empty_body_rejected),
    ("non-JSON rejected", non_json_rejected),
    ("non-object JSON rejected", non_object_rejected),
    ("missing videoPath rejected", missing_videopath_rejected),
    ("wrong-type videoPath rejected", wrong_type_videopath_rejected),
    ("missing file rejected", missing_file_rejected),
]:
    check(name, fn)

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("all server logic checks passed")

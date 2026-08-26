"""Quick logic checks for scripts/analyze_clip.py — no network, no SDK needed.

Run:  python scripts/test_analyze_logic.py
"""

import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location(
    "analyze_clip", os.path.join(os.path.dirname(__file__), "analyze_clip.py")
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


VALID = '{"duration_sec": 42, "script": "He banks it home!", "timestamps": [{"start": 0.0, "end": 12.5, "text": "He banks it home!"}]}'


def plain_json_parses():
    data = m.extract_json(VALID)
    assert data["duration_sec"] == 42
    assert "banks" in data["script"]
    assert data["timestamps"][0]["end"] == 12.5


def fenced_json_parses():
    fenced = "```json\n" + VALID + "\n```"
    data = m.extract_json(fenced)
    assert data["duration_sec"] == 42


def missing_field_exits():
    try:
        m.extract_json('{"duration_sec": 1}')
    except SystemExit as e:
        assert "missing required field" in str(e.code), e.code
        return
    raise AssertionError("should have exited")


def garbage_json_exits():
    try:
        m.extract_json("Here is your script! It's great.")
    except SystemExit as e:
        assert "non-JSON" in str(e.code), e.code
        return
    raise AssertionError("should have exited")


def require_key_fails_closed():
    saved = os.environ.pop("GEMINI_API_KEY", None)
    try:
        m.require_key()
    except SystemExit as e:
        assert "GEMINI_API_KEY is not set" in str(e.code), e.code
        return
    finally:
        if saved is not None:
            os.environ["GEMINI_API_KEY"] = saved
    raise AssertionError("should have exited without a key")


check("plain JSON parses", plain_json_parses)
check("markdown-fenced JSON parses", fenced_json_parses)
check("missing field exits with message", missing_field_exits)
check("garbage response exits with message", garbage_json_exits)
check("require_key fails closed", require_key_fails_closed)

if failures:
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1)
print("\nall logic checks pass")

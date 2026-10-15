# Whisper offline startup

The actual packaged application recognized all 21 words in the known genuine
Kokoro recording, sent the transcript through voice conversation and received
a completed response from the installed signed-in Codex CLI. Capture tracks
ended. This uses Chromium file-backed capture, not a human utterance.

On a native restart with Online off, Transformers 4.2's pipeline factory called
model discovery without cache_dir/local_files_only. The positive-controlled
fetch trap caught https://huggingface.co/Xenova/whisper-base.en/resolve/main/config.json.
The fixture's real model cache already contained seven files (293,167,168 bytes).

Load WhisperForConditionalGeneration, AutoTokenizer and AutoProcessor directly
with the same explicit writable cache and consent options, then construct the
real AutomaticSpeechRecognitionPipeline. No global library settings are changed.

Local checks: five affected suites, 44 tests; TypeScript; scoped ESLint; release
build all passed.

The rebuilt package then passed the packaged offline proof on 2026-10-02. The
pre-fix package reproduced the regression: with Online off it issued one
controlled request for
https://huggingface.co/Xenova/whisper-base.en/resolve/main/config.json and
failed. The fixed package returned the exact known transcript with zero
controlled fetches, and WhisperForConditionalGeneration, AutoTokenizer and
AutoProcessor all loaded from the writable profile cache under local_files_only.
Evidence: C:/Users/adenk/.homebot/.kilo/whisper-offline-package-proof-1790915933557/evidence.json
(earlier retained failure: C:/Users/adenk/.homebot/.kilo/whisper-offline-package-proof-1790852479112/evidence.json).
The fixed branch was then merged with main (e057b39e); serial integration
remains pending.

Retained baseline evidence under C:/Users/adenk/.homebot/.kilo:
- packaged-voice-reply-1790846023464/evidence.json: online path succeeded;
  complete run failed during offline transcription.
- offline-whisper-resume-1790846357810/evidence.json: concrete offline request.
- offline-whisper-resume-1790846537213/evidence.json: not valid as zero-network
  proof: importing Transformers before setting global.fetch allowed env.fetch
  to retain the original transport. Future probes must control both transports.

The real human microphone test is independently awaiting the user's utterance.

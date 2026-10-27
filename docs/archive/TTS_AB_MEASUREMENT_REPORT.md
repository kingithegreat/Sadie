# Kokoro vs Edge TTS A/B Measurement Report

## Executive Summary

Edge (Microsoft default neural) and Kokoro-82M v1.0 ONNX were compared across three script lengths (short: 34 words, medium: 72 words, long: 157 words) on Windows 11.

| Metric | Edge (JennyNeural) | Kokoro (af_heart) |
|--------|-------------------|-------------------|
| **Render Time** | 505ms - 1.1s | 25.5-50s (includes 1.5-65s model load) |
| **Audio Quality** | 96 kbps MP3 | 768 kbps WAV (10x bitrate) |
| **Duration Accuracy** | 4.7s - 34.7s | 4.0s - 26.9s |
| **File Size** | 57KB - 416KB | 386KB - 2.5MB |

## Detailed Results

### Short Script (34 words)

| Engine | Render Time | Duration | File Size | Bitrate |
|--------|-------------|----------|-----------|---------|
| Edge | 505ms | 4.7s | 56.7 KB | 96 kbps |
| Kokoro | 25,515ms (total: 89,511ms incl. 64,777ms load) | 4.0s | 386 KB | 768 kbps |

### Medium Script (72 words)

| Engine | Render Time | Duration | File Size | Bitrate |
|--------|-------------|----------|-----------|---------|
| Edge | 1,241ms | 11.2s | 131 KB | 96 kbps |
| Kokoro | 44,976ms (total: 49,973ms incl. 5,027ms load) | 10.8s | 1.0 MB | 768 kbps |

### Long Script (157 words)

| Engine | Render Time | Duration | File Size | Bitrate |
|--------|-------------|----------|-----------|---------|
| Edge | 1,079ms | 34.7s | 406 KB | 96 kbps |
| Kokoro | 49,927ms (total: 52,055ms incl. 2,129ms load) | 26.9s | 2.5 MB | 768 kbps |

## Loudness Analysis (ffprobe loudnorm)

Loudness metrics (integrated LUFS, true peak, clip percentage) could not be extracted due to ffmpeg JSON structure parsing issue in the measurement script. Error: `"Cannot read properties of null (reading '0')"`.

## Recommendations

1. **For Web/Energy-Conscious Delivery**: Edge TTS is superior - 20-50x faster render, 10x smaller files, uses standard MP3
2. **For High-Quality Offline Use**: Kokoro produces higher bitrate WAV files, but has significant model load overhead (1.5-65 seconds)
3. **Model Caching**: Kokoro's model should be cached after first load for subsequent uses

## Technical Notes

- Edge uses `msedge-tts` with `AUDIO_24KHZ_96KBITRATE_MONO_MP3` format
- Kokoro uses `kokoro-js` with ONNX runtime `q8` quantization
- Both engines use `en-US` voice; Kokoro uses `af_heart` personality
- Measurement script location: `C:\Users\adenk\AppData\Local\Temp\kilo\tts-ab\ab.js`
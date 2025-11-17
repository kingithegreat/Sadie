"""Voice module for Sadie AI Assistant - handles speech-to-text using Whisper"""

import whisper
import sounddevice as sd
import soundfile as sf
import numpy as np
from pathlib import Path
from typing import Dict, Any, Optional
from ..core.config import get_config


class VoiceModule:
    """Handles voice input using Whisper for speech recognition"""

    def __init__(self):
        self.config = get_config()
        self.model_name = self.config.get('modules.voice.whisper_model', 'base')
        self.sample_rate = self.config.get('modules.voice.sample_rate', 16000)
        self.model = None

    def _load_model(self):
        """Lazy load Whisper model"""
        if self.model is None:
            try:
                self.model = whisper.load_model(self.model_name)
            except Exception as e:
                raise RuntimeError(f"Failed to load Whisper model: {str(e)}")

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a voice action
        
        Args:
            action: Action type (voice_transcribe, voice_record, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        action_map = {
            'voice_transcribe': self._transcribe_audio,
            'voice_record': self._record_audio,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown voice action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _transcribe_audio(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Transcribe audio file to text using Whisper"""
        audio_path = params.get('path')
        language = params.get('language')  # Optional, Whisper can auto-detect

        if not audio_path:
            return {"success": False, "error": "Audio path is required"}

        path = Path(audio_path)
        if not path.exists():
            return {"success": False, "error": "Audio file not found"}

        try:
            self._load_model()
            
            # Transcribe audio
            result = self.model.transcribe(
                str(path),
                language=language,
                fp16=False  # Use fp32 for better compatibility
            )

            return {
                "success": True,
                "text": result['text'].strip(),
                "language": result.get('language', 'unknown'),
                "segments": len(result.get('segments', []))
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Transcription failed: {str(e)}"
            }

    def _record_audio(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Record audio from microphone"""
        duration = params.get('duration', 5)  # seconds
        output_path = params.get('output_path', '/tmp/recorded_audio.wav')

        try:
            # Record audio
            recording = sd.rec(
                int(duration * self.sample_rate),
                samplerate=self.sample_rate,
                channels=1,
                dtype='float32'
            )
            sd.wait()  # Wait for recording to finish

            # Save to file
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(output_path), recording, self.sample_rate)

            return {
                "success": True,
                "path": str(output_path),
                "duration": duration,
                "sample_rate": self.sample_rate
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Recording failed: {str(e)}"
            }

    def transcribe_live(self, duration: int = 5) -> Dict[str, Any]:
        """Record and transcribe audio in one step"""
        # Record audio
        record_result = self._record_audio({
            'duration': duration,
            'output_path': '/tmp/sadie_voice_input.wav'
        })

        if not record_result.get('success'):
            return record_result

        # Transcribe recorded audio
        transcribe_result = self._transcribe_audio({
            'path': record_result['path']
        })

        return transcribe_result


# Global voice module instance
_module = None


def get_voice_module() -> VoiceModule:
    """Get global voice module instance"""
    global _module
    if _module is None:
        _module = VoiceModule()
    return _module

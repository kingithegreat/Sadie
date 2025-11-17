"""Vision module for Sadie AI Assistant - handles image analysis and OCR"""

import base64
import requests
from pathlib import Path
from typing import Dict, Any, Optional
from PIL import Image
import pytesseract
from ..core.config import get_config


class VisionModule:
    """Handles image analysis using LLaVA and OCR using Tesseract"""

    def __init__(self):
        self.config = get_config()
        self.ollama_url = self.config.get('ollama.url', 'http://localhost:11434')
        self.use_llava = self.config.get('modules.vision.use_llava', True)
        self.use_ocr = self.config.get('modules.vision.use_ocr', True)
        self.ocr_language = self.config.get('modules.vision.ocr_language', 'eng')

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a vision action
        
        Args:
            action: Action type (image_describe, image_ocr, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        action_map = {
            'image_describe': self._describe_image,
            'image_ocr': self._extract_text,
            'image_analyze': self._analyze_image,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown vision action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _describe_image(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Describe an image using LLaVA model"""
        if not self.use_llava:
            return {
                "success": False,
                "error": "LLaVA is not enabled in configuration"
            }

        image_path = params.get('path')
        prompt = params.get('prompt', 'Describe this image in detail.')

        if not image_path:
            return {"success": False, "error": "Image path is required"}

        path = Path(image_path)
        if not path.exists():
            return {"success": False, "error": "Image file not found"}

        # Encode image to base64
        try:
            with open(path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to read image: {str(e)}"
            }

        # Call Ollama with LLaVA model
        url = f"{self.ollama_url}/api/generate"
        payload = {
            "model": "llava",  # LLaVA model for vision
            "prompt": prompt,
            "images": [image_data],
            "stream": False
        }

        try:
            response = requests.post(url, json=payload, timeout=60)
            response.raise_for_status()
            result = response.json()
            
            return {
                "success": True,
                "description": result.get('response', ''),
                "model": "llava"
            }
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": f"Failed to connect to LLaVA: {str(e)}",
                "suggestion": "Make sure Ollama is running and llava model is installed (ollama pull llava)"
            }

    def _extract_text(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Extract text from image using OCR"""
        if not self.use_ocr:
            return {
                "success": False,
                "error": "OCR is not enabled in configuration"
            }

        image_path = params.get('path')
        
        if not image_path:
            return {"success": False, "error": "Image path is required"}

        path = Path(image_path)
        if not path.exists():
            return {"success": False, "error": "Image file not found"}

        try:
            # Open image and perform OCR
            image = Image.open(path)
            text = pytesseract.image_to_string(image, lang=self.ocr_language)
            
            return {
                "success": True,
                "text": text.strip(),
                "language": self.ocr_language,
                "char_count": len(text)
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"OCR failed: {str(e)}",
                "suggestion": "Make sure Tesseract-OCR is installed on your system"
            }

    def _analyze_image(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze image with both description and OCR"""
        image_path = params.get('path')
        
        results = {
            "success": True,
            "image_path": image_path
        }

        # Try description with LLaVA
        if self.use_llava:
            desc_result = self._describe_image(params)
            results['description'] = desc_result

        # Try OCR
        if self.use_ocr:
            ocr_result = self._extract_text(params)
            results['ocr'] = ocr_result

        return results


# Global vision module instance
_module = None


def get_vision_module() -> VisionModule:
    """Get global vision module instance"""
    global _module
    if _module is None:
        _module = VisionModule()
    return _module

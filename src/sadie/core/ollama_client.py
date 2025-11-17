"""Ollama integration for Sadie AI Assistant"""

import json
import requests
from typing import Dict, Any, Optional, List
from .config import get_config


class OllamaClient:
    """Client for interacting with Ollama API"""

    def __init__(self):
        self.config = get_config()
        self.base_url = self.config.get('ollama.url', 'http://localhost:11434')
        self.model = self.config.get('ollama.model', 'llama2')
        self.timeout = self.config.get('ollama.timeout', 30)

    def generate(self, prompt: str, system_prompt: Optional[str] = None, 
                 temperature: float = 0.7) -> Dict[str, Any]:
        """
        Generate a response from Ollama
        
        Args:
            prompt: User prompt
            system_prompt: Optional system prompt for context
            temperature: Sampling temperature (0.0 to 1.0)
            
        Returns:
            Response dictionary with 'response' and metadata
        """
        url = f"{self.base_url}/api/generate"
        
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }

        if system_prompt:
            payload["system"] = system_prompt

        try:
            response = requests.post(url, json=payload, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {
                "error": str(e),
                "response": "I'm sorry, I'm having trouble connecting to my AI model. Please make sure Ollama is running."
            }

    def chat(self, messages: List[Dict[str, str]], temperature: float = 0.7) -> Dict[str, Any]:
        """
        Chat with Ollama using conversation history
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature
            
        Returns:
            Response dictionary
        """
        url = f"{self.base_url}/api/chat"
        
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }

        try:
            response = requests.post(url, json=payload, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {
                "error": str(e),
                "message": {
                    "role": "assistant",
                    "content": "I'm sorry, I'm having trouble connecting to my AI model. Please make sure Ollama is running."
                }
            }

    def extract_tool_calls(self, response_text: str) -> List[Dict[str, Any]]:
        """
        Extract structured tool calls from AI response
        
        Args:
            response_text: The AI response text
            
        Returns:
            List of tool call dictionaries
        """
        tool_calls = []
        
        # Look for JSON blocks in the response
        try:
            # Try to find JSON objects in the response
            start_idx = response_text.find('{')
            while start_idx != -1:
                # Find the matching closing brace
                brace_count = 0
                end_idx = start_idx
                
                for i in range(start_idx, len(response_text)):
                    if response_text[i] == '{':
                        brace_count += 1
                    elif response_text[i] == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            end_idx = i + 1
                            break
                
                if brace_count == 0:
                    try:
                        json_str = response_text[start_idx:end_idx]
                        tool_call = json.loads(json_str)
                        
                        # Validate it's a tool call (has 'action' field)
                        if 'action' in tool_call:
                            tool_calls.append(tool_call)
                    except json.JSONDecodeError:
                        pass
                    
                    start_idx = response_text.find('{', end_idx)
                else:
                    break
        except Exception:
            pass

        return tool_calls

    def check_connection(self) -> bool:
        """
        Check if Ollama is running and accessible
        
        Returns:
            True if connected, False otherwise
        """
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False


# Global Ollama client instance
_client = None


def get_ollama_client() -> OllamaClient:
    """Get global Ollama client instance"""
    global _client
    if _client is None:
        _client = OllamaClient()
    return _client

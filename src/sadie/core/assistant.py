"""Core assistant logic for Sadie AI Assistant"""

from typing import Dict, Any, List, Optional
from .config import get_config
from .ollama_client import get_ollama_client
from .n8n_client import get_n8n_client
from .module_router import get_module_router
from .safety import get_safety_validator
from ..modules.memory import get_memory_module


class SadieAssistant:
    """Main Sadie AI Assistant class"""

    def __init__(self):
        self.config = get_config()
        self.ollama = get_ollama_client()
        self.n8n = get_n8n_client()
        self.router = get_module_router()
        self.validator = get_safety_validator()
        self.memory = get_memory_module()
        
        self.name = self.config.get('assistant.name', 'Sadie')
        self.personality = self.config.get('assistant.personality', 'sweet, helpful, and safe')

    def get_system_prompt(self) -> str:
        """Generate system prompt for the AI"""
        return f"""You are {self.name}, a {self.personality} AI assistant.

You help users with various tasks while prioritizing safety and user well-being.

Available capabilities:
- File operations (read, write, copy, move, delete, list)
- Image analysis (describe, OCR)
- Voice transcription
- Email drafting and sending
- API calls
- Task planning and breakdown
- Memory and context management

When suggesting actions, provide them as JSON tool calls in this format:
{{
    "action": "action_name",
    "params": {{
        "param1": "value1",
        "param2": "value2"
    }}
}}

Safety Guidelines:
- Never suggest destructive operations without user confirmation
- Avoid accessing system directories or sensitive files
- Always validate paths and inputs
- If unsure about safety, ask the user
- Suggest safe alternatives for risky operations

Be conversational, friendly, and helpful. If you cannot perform a task, explain why and suggest alternatives."""

    def process_message(self, message: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Process a user message and generate a response
        
        Args:
            message: User's message
            context: Optional context dictionary
            
        Returns:
            Response dictionary with text and any actions
        """
        # Save user message to memory
        self.memory.execute('memory_save', {
            'role': 'user',
            'content': message
        })

        # Get recent conversation history
        history_result = self.memory.execute('memory_recall', {'limit': 5})
        conversation_history = history_result.get('history', []) if history_result.get('success') else []

        # Build messages for chat
        messages = [
            {"role": "system", "content": self.get_system_prompt()}
        ]

        # Add conversation history
        for entry in conversation_history[:-1]:  # Exclude the message we just added
            messages.append({
                "role": entry['role'],
                "content": entry['content']
            })

        # Add current message
        messages.append({
            "role": "user",
            "content": message
        })

        # Get response from Ollama
        response = self.ollama.chat(messages)

        if 'error' in response:
            return {
                "success": False,
                "error": response['error'],
                "response": response.get('message', {}).get('content', 'Error communicating with AI')
            }

        assistant_message = response.get('message', {}).get('content', '')

        # Save assistant response to memory
        self.memory.execute('memory_save', {
            'role': 'assistant',
            'content': assistant_message
        })

        # Extract any tool calls from the response
        tool_calls = self.ollama.extract_tool_calls(assistant_message)

        # Process tool calls if any
        tool_results = []
        if tool_calls:
            tool_results = self.router.process_tool_calls(tool_calls)

        return {
            "success": True,
            "response": assistant_message,
            "tool_calls": tool_calls,
            "tool_results": tool_results
        }

    def execute_action(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a specific action directly
        
        Args:
            action: Action name
            params: Action parameters
            
        Returns:
            Action result
        """
        return self.router.route(action, params)

    def check_status(self) -> Dict[str, Any]:
        """
        Check the status of all components
        
        Returns:
            Status dictionary
        """
        return {
            "assistant": self.name,
            "personality": self.personality,
            "ollama_connected": self.ollama.check_connection(),
            "n8n_connected": self.n8n.check_connection(),
            "modules_enabled": {
                "file_actions": self.config.is_module_enabled('file_actions'),
                "email": self.config.is_module_enabled('email'),
                "vision": self.config.is_module_enabled('vision'),
                "voice": self.config.is_module_enabled('voice'),
                "api": self.config.is_module_enabled('api'),
                "memory": self.config.is_module_enabled('memory'),
                "planning": self.config.is_module_enabled('planning'),
            }
        }


# Global assistant instance
_assistant = None


def get_assistant() -> SadieAssistant:
    """Get global assistant instance"""
    global _assistant
    if _assistant is None:
        _assistant = SadieAssistant()
    return _assistant

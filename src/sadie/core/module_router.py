"""Module router for Sadie AI Assistant - routes actions to appropriate modules"""

from typing import Dict, Any
from ..modules.file_actions import FileActionsModule
from ..modules.email import EmailModule
from ..modules.vision import VisionModule
from ..modules.voice import VoiceModule
from ..modules.api import APIModule
from ..modules.memory import MemoryModule
from ..modules.planning import PlanningModule


class ModuleRouter:
    """Routes actions to the appropriate module"""

    def __init__(self):
        # Initialize all modules
        self.modules = {
            'file': FileActionsModule(),
            'email': EmailModule(),
            'vision': VisionModule(),
            'voice': VoiceModule(),
            'api': APIModule(),
            'memory': MemoryModule(),
            'planning': PlanningModule(),
        }

        # Action prefix to module mapping
        self.action_map = {
            'file_': 'file',
            'email_': 'email',
            'image_': 'vision',
            'voice_': 'voice',
            'api_': 'api',
            'memory_': 'memory',
            'plan_': 'planning',
        }

    def route(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Route an action to the appropriate module
        
        Args:
            action: Action name (e.g., 'file_read', 'email_send')
            params: Action parameters
            
        Returns:
            Result from the module
        """
        # Find the appropriate module
        module_name = None
        for prefix, mod_name in self.action_map.items():
            if action.startswith(prefix):
                module_name = mod_name
                break

        if not module_name:
            return {
                "success": False,
                "error": f"Unknown action: {action}",
                "suggestion": "Available action types: file_*, email_*, image_*, voice_*, api_*, memory_*, plan_*"
            }

        module = self.modules.get(module_name)
        if not module:
            return {
                "success": False,
                "error": f"Module '{module_name}' not found"
            }

        # Execute action through the module
        try:
            result = module.execute(action, params)
            
            # Add module info to result
            if isinstance(result, dict):
                result['module'] = module_name
                result['action'] = action
            
            return result
        except Exception as e:
            return {
                "success": False,
                "error": f"Module execution failed: {str(e)}",
                "module": module_name,
                "action": action
            }

    def process_tool_calls(self, tool_calls: list) -> list:
        """
        Process a list of tool calls
        
        Args:
            tool_calls: List of tool call dictionaries
            
        Returns:
            List of results
        """
        results = []
        
        for tool_call in tool_calls:
            action = tool_call.get('action')
            params = tool_call.get('params', {})
            
            if not action:
                results.append({
                    "success": False,
                    "error": "Tool call missing 'action' field"
                })
                continue
            
            result = self.route(action, params)
            results.append(result)
        
        return results


# Global router instance
_router = None


def get_module_router() -> ModuleRouter:
    """Get global module router instance"""
    global _router
    if _router is None:
        _router = ModuleRouter()
    return _router

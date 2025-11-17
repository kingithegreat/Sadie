"""Planning module for Sadie AI Assistant - handles multi-step task planning"""

from typing import Dict, Any, List
from ..core.config import get_config
from ..core.ollama_client import get_ollama_client


class PlanningModule:
    """Handles complex task planning and decomposition"""

    def __init__(self):
        self.config = get_config()
        self.max_steps = self.config.get('modules.planning.max_steps', 10)
        self.ollama = get_ollama_client()

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a planning action
        
        Args:
            action: Action type (plan_task, plan_execute, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        action_map = {
            'plan_task': self._plan_task,
            'plan_validate': self._validate_plan,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown planning action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _plan_task(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Break down a complex task into steps"""
        task = params.get('task', '')

        if not task:
            return {"success": False, "error": "Task description is required"}

        # Create a planning prompt
        system_prompt = f"""You are a helpful AI assistant that breaks down complex tasks into clear, executable steps.
When given a task, create a numbered plan with specific, actionable steps.
Limit your plan to a maximum of {self.max_steps} steps.
Each step should be clear and focused on a single action.
Return your plan as a numbered list."""

        prompt = f"Please create a step-by-step plan for this task: {task}"

        # Get plan from AI
        response = self.ollama.generate(prompt, system_prompt=system_prompt)

        if 'error' in response:
            return {
                "success": False,
                "error": response.get('error', 'Unknown error')
            }

        plan_text = response.get('response', '')
        
        # Parse the plan into steps
        steps = self._parse_plan(plan_text)

        return {
            "success": True,
            "task": task,
            "plan_text": plan_text,
            "steps": steps,
            "step_count": len(steps)
        }

    def _parse_plan(self, plan_text: str) -> List[Dict[str, Any]]:
        """Parse plan text into structured steps"""
        steps = []
        lines = plan_text.split('\n')

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Look for numbered steps (e.g., "1.", "1)", "Step 1:", etc.)
            import re
            match = re.match(r'^(?:Step\s+)?(\d+)[\.\):]?\s+(.+)$', line, re.IGNORECASE)
            
            if match:
                step_num = int(match.group(1))
                step_desc = match.group(2).strip()
                
                steps.append({
                    'step_number': step_num,
                    'description': step_desc,
                    'completed': False
                })

        return steps

    def _validate_plan(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Validate if a plan is feasible and safe"""
        steps = params.get('steps', [])

        if not steps:
            return {"success": False, "error": "No steps provided"}

        # Check if plan is within limits
        if len(steps) > self.max_steps:
            return {
                "success": False,
                "error": f"Plan has too many steps ({len(steps)}). Maximum allowed: {self.max_steps}",
                "suggestion": "Please simplify the task or break it into smaller sub-tasks"
            }

        # Analyze each step for safety
        issues = []
        for i, step in enumerate(steps):
            desc = step.get('description', '').lower()
            
            # Check for potentially unsafe operations
            unsafe_keywords = ['delete all', 'format', 'remove system', 'modify registry', 'erase']
            
            for keyword in unsafe_keywords:
                if keyword in desc:
                    issues.append({
                        'step': i + 1,
                        'issue': f"Step contains potentially unsafe operation: '{keyword}'",
                        'severity': 'high'
                    })

        if issues:
            return {
                "success": False,
                "error": "Plan contains potentially unsafe steps",
                "issues": issues,
                "suggestion": "Please review the highlighted steps and ensure they are safe to execute"
            }

        return {
            "success": True,
            "message": "Plan is valid and safe to execute",
            "step_count": len(steps)
        }


# Global planning module instance
_module = None


def get_planning_module() -> PlanningModule:
    """Get global planning module instance"""
    global _module
    if _module is None:
        _module = PlanningModule()
    return _module

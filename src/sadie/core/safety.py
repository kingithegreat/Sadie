"""Safety mechanisms for Sadie AI Assistant"""

import os
import re
from pathlib import Path
from typing import List, Dict, Any, Tuple
from .config import get_config


class SafetyValidator:
    """Validates actions to ensure safe operations"""

    def __init__(self):
        self.config = get_config()

    def validate_action(self, action: str, params: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Validate if an action is safe to perform
        
        Args:
            action: Action type (e.g., 'file_delete', 'email_send')
            params: Action parameters
            
        Returns:
            Tuple of (is_safe: bool, message: str)
        """
        # Check if action is blocked
        if self.config.is_action_blocked(action):
            return False, f"Action '{action}' is blocked for safety reasons"

        # Validate based on action type
        if action.startswith('file_'):
            return self._validate_file_action(action, params)
        elif action.startswith('email_'):
            return self._validate_email_action(action, params)
        elif action == 'system_command':
            return self._validate_system_command(params)
        
        # Default: allow action
        return True, "Action is safe"

    def _validate_file_action(self, action: str, params: Dict[str, Any]) -> Tuple[bool, str]:
        """Validate file-related actions"""
        file_path = params.get('path', '')
        
        if not file_path:
            return False, "File path is required"

        path = Path(file_path).resolve()
        
        # Check forbidden directories
        forbidden_dirs = self.config.get('modules.file_actions.forbidden_directories', [])
        for forbidden in forbidden_dirs:
            forbidden_path = Path(forbidden).resolve()
            try:
                path.relative_to(forbidden_path)
                return False, f"Access to '{forbidden}' directory is forbidden"
            except ValueError:
                # Path is not relative to forbidden directory, continue checking
                pass

        # Check safe directories (if specified)
        safe_dirs = self.config.get('modules.file_actions.safe_directories', [])
        if safe_dirs:
            is_safe = False
            for safe_dir in safe_dirs:
                safe_path = Path(os.path.expanduser(f"~/{safe_dir}")).resolve()
                try:
                    path.relative_to(safe_path)
                    is_safe = True
                    break
                except ValueError:
                    continue
            
            if not is_safe:
                return False, f"File access is only allowed in safe directories: {', '.join(safe_dirs)}"

        # Check file size for read/write operations
        if action in ['file_read', 'file_write'] and path.exists():
            max_size_mb = self.config.get('modules.file_actions.max_file_size_mb', 100)
            size_mb = path.stat().st_size / (1024 * 1024)
            if size_mb > max_size_mb:
                return False, f"File size ({size_mb:.1f}MB) exceeds maximum allowed size ({max_size_mb}MB)"

        return True, "File action is safe"

    def _validate_email_action(self, action: str, params: Dict[str, Any]) -> Tuple[bool, str]:
        """Validate email-related actions"""
        if not self.config.is_module_enabled('email'):
            return False, "Email module is disabled"

        if action == 'email_send':
            if not params.get('recipient'):
                return False, "Recipient email is required"
            if not params.get('subject') and not params.get('body'):
                return False, "Email must have subject or body"

        return True, "Email action is safe"

    def _validate_system_command(self, params: Dict[str, Any]) -> Tuple[bool, str]:
        """Validate system command execution"""
        command = params.get('command', '')
        
        if not command:
            return False, "Command is required"

        # Block dangerous commands
        dangerous_patterns = [
            r'\brm\s+-rf',
            r'\bformat\b',
            r'\bdel\s+/[fqs]',
            r'\brd\s+/s',
            r'>\s*\\?/dev/',
            r'\bregedit\b',
            r'\breg\s+(delete|add)',
        ]

        for pattern in dangerous_patterns:
            if re.search(pattern, command, re.IGNORECASE):
                return False, f"Command contains potentially dangerous operation: {pattern}"

        return True, "System command is safe"

    def get_safe_alternative(self, action: str, reason: str) -> str:
        """
        Suggest a safe alternative for a blocked action
        
        Args:
            action: The blocked action
            reason: Why it was blocked
            
        Returns:
            Suggestion for safe alternative
        """
        suggestions = {
            'file_delete': "Instead of deleting, consider moving the file to a safe location or creating a backup first.",
            'format_drive': "Formatting drives is not supported. Please use Windows Disk Management for such operations.",
            'modify_registry': "Registry modifications are not supported for safety. Please use Registry Editor manually if needed.",
            'system_command': "This command appears unsafe. Please run it manually if you're certain it's safe.",
        }

        return suggestions.get(action, "This action cannot be performed automatically. Please consider doing it manually with appropriate caution.")


# Global safety validator instance
_validator = None


def get_safety_validator() -> SafetyValidator:
    """Get global safety validator instance"""
    global _validator
    if _validator is None:
        _validator = SafetyValidator()
    return _validator

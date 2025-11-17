"""Configuration management for Sadie"""

import os
import yaml
from pathlib import Path
from typing import Dict, Any


class Config:
    """Configuration manager for Sadie AI Assistant"""

    def __init__(self, config_path: str = None):
        """
        Initialize configuration
        
        Args:
            config_path: Path to config file. If None, uses default location.
        """
        if config_path is None:
            # Default to config directory in project root
            project_root = Path(__file__).parent.parent.parent.parent
            config_path = project_root / "config" / "config.yaml"
        
        self.config_path = Path(config_path)
        self.config = self._load_config()

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file"""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")
        
        with open(self.config_path, 'r') as f:
            return yaml.safe_load(f)

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get configuration value by key (supports dot notation)
        
        Args:
            key: Configuration key (e.g., 'ollama.url')
            default: Default value if key not found
            
        Returns:
            Configuration value
        """
        keys = key.split('.')
        value = self.config
        
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
                if value is None:
                    return default
            else:
                return default
        
        return value

    def is_module_enabled(self, module_name: str) -> bool:
        """Check if a module is enabled"""
        return self.get(f'modules.{module_name}.enabled', False)

    def is_action_blocked(self, action: str) -> bool:
        """Check if an action is blocked by safety settings"""
        blocked_actions = self.get('safety.blocked_actions', [])
        return action in blocked_actions

    def requires_confirmation(self, action: str) -> bool:
        """Check if an action requires user confirmation"""
        confirm_actions = self.get('safety.require_confirmation_for', [])
        return action in confirm_actions


# Global config instance
_config = None


def get_config(config_path: str = None) -> Config:
    """Get global configuration instance"""
    global _config
    if _config is None:
        _config = Config(config_path)
    return _config

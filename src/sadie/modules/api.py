"""API module for Sadie AI Assistant - handles external API calls"""

import requests
from typing import Dict, Any, Optional
from ..core.config import get_config


class APIModule:
    """Handles external API calls"""

    def __init__(self):
        self.config = get_config()
        self.timeout = self.config.get('modules.api.timeout', 10)
        self.allowed_domains = self.config.get('modules.api.allowed_domains', [])

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute an API action
        
        Args:
            action: Action type (api_get, api_post, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        action_map = {
            'api_get': self._api_get,
            'api_post': self._api_post,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown API action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _check_domain_allowed(self, url: str) -> bool:
        """Check if domain is allowed"""
        if not self.allowed_domains:
            return True  # No restrictions if list is empty

        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        
        return any(allowed in domain for allowed in self.allowed_domains)

    def _api_get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make a GET request to an API"""
        url = params.get('url')
        headers = params.get('headers', {})
        params_dict = params.get('params', {})

        if not url:
            return {"success": False, "error": "URL is required"}

        if not self._check_domain_allowed(url):
            return {
                "success": False,
                "error": f"Domain not in allowed list. Allowed domains: {', '.join(self.allowed_domains)}"
            }

        try:
            response = requests.get(
                url,
                headers=headers,
                params=params_dict,
                timeout=self.timeout
            )
            response.raise_for_status()

            return {
                "success": True,
                "status_code": response.status_code,
                "data": response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text,
                "headers": dict(response.headers)
            }
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": f"API request failed: {str(e)}"
            }

    def _api_post(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make a POST request to an API"""
        url = params.get('url')
        headers = params.get('headers', {})
        data = params.get('data', {})
        json_data = params.get('json')

        if not url:
            return {"success": False, "error": "URL is required"}

        if not self._check_domain_allowed(url):
            return {
                "success": False,
                "error": f"Domain not in allowed list. Allowed domains: {', '.join(self.allowed_domains)}"
            }

        try:
            if json_data is not None:
                response = requests.post(
                    url,
                    headers=headers,
                    json=json_data,
                    timeout=self.timeout
                )
            else:
                response = requests.post(
                    url,
                    headers=headers,
                    data=data,
                    timeout=self.timeout
                )
            
            response.raise_for_status()

            return {
                "success": True,
                "status_code": response.status_code,
                "data": response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text,
                "headers": dict(response.headers)
            }
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": f"API request failed: {str(e)}"
            }


# Global API module instance
_module = None


def get_api_module() -> APIModule:
    """Get global API module instance"""
    global _module
    if _module is None:
        _module = APIModule()
    return _module

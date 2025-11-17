"""n8n workflow integration for Sadie AI Assistant"""

import json
import requests
from typing import Dict, Any, Optional
from .config import get_config


class N8nClient:
    """Client for interacting with n8n webhooks"""

    def __init__(self):
        self.config = get_config()
        self.base_url = self.config.get('n8n.url', 'http://localhost:5678')
        self.webhook_path = self.config.get('n8n.webhook_path', '/webhook/sadie')

    def send_tool_call(self, tool_call: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a tool call to n8n for processing
        
        Args:
            tool_call: Tool call dictionary with 'action' and 'params'
            
        Returns:
            Response from n8n workflow
        """
        url = f"{self.base_url}{self.webhook_path}"
        
        payload = {
            "type": "tool_call",
            "data": tool_call
        }

        try:
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to execute action through n8n workflow"
            }

    def send_query(self, query: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Send a user query to n8n for processing
        
        Args:
            query: User query text
            context: Optional context information
            
        Returns:
            Response from n8n workflow
        """
        url = f"{self.base_url}{self.webhook_path}"
        
        payload = {
            "type": "query",
            "query": query,
            "context": context or {}
        }

        try:
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": str(e),
                "message": "Failed to process query through n8n workflow"
            }

    def check_connection(self) -> bool:
        """
        Check if n8n is accessible
        
        Returns:
            True if connected, False otherwise
        """
        try:
            response = requests.get(self.base_url, timeout=5)
            return response.status_code in [200, 401]  # 401 means it's running but needs auth
        except requests.exceptions.RequestException:
            return False


# Global n8n client instance
_client = None


def get_n8n_client() -> N8nClient:
    """Get global n8n client instance"""
    global _client
    if _client is None:
        _client = N8nClient()
    return _client

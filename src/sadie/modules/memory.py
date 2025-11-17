"""Memory module for Sadie AI Assistant - handles conversation history and context"""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from ..core.config import get_config


class MemoryModule:
    """Handles conversation history and context memory"""

    def __init__(self):
        self.config = get_config()
        self.storage_file = self.config.get('modules.memory.storage_file', 'sadie_memory.db')
        self.max_history = self.config.get('modules.memory.max_history_items', 1000)
        self.db_path = Path.home() / '.sadie' / self.storage_file
        self._init_database()

    def _init_database(self):
        """Initialize SQLite database for memory storage"""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        # Create conversations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT
            )
        ''')
        
        # Create context table for storing key-value pairs
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS context (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        
        conn.commit()
        conn.close()

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a memory action
        
        Args:
            action: Action type (memory_save, memory_recall, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        action_map = {
            'memory_save': self._save_memory,
            'memory_recall': self._recall_memory,
            'memory_get_context': self._get_context,
            'memory_set_context': self._set_context,
            'memory_clear': self._clear_memory,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown memory action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _save_memory(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Save a conversation turn to memory"""
        role = params.get('role', 'user')
        content = params.get('content', '')
        metadata = params.get('metadata', {})

        if not content:
            return {"success": False, "error": "Content is required"}

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO conversations (timestamp, role, content, metadata)
            VALUES (?, ?, ?, ?)
        ''', (datetime.now().isoformat(), role, content, json.dumps(metadata)))

        conn.commit()
        
        # Clean up old entries if exceeding max_history
        cursor.execute('SELECT COUNT(*) FROM conversations')
        count = cursor.fetchone()[0]
        
        if count > self.max_history:
            cursor.execute('''
                DELETE FROM conversations
                WHERE id IN (
                    SELECT id FROM conversations
                    ORDER BY id ASC
                    LIMIT ?
                )
            ''', (count - self.max_history,))
            conn.commit()

        conn.close()

        return {
            "success": True,
            "message": "Memory saved"
        }

    def _recall_memory(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Recall recent conversation history"""
        limit = params.get('limit', 10)
        role_filter = params.get('role')  # Optional filter by role

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        if role_filter:
            cursor.execute('''
                SELECT timestamp, role, content, metadata
                FROM conversations
                WHERE role = ?
                ORDER BY id DESC
                LIMIT ?
            ''', (role_filter, limit))
        else:
            cursor.execute('''
                SELECT timestamp, role, content, metadata
                FROM conversations
                ORDER BY id DESC
                LIMIT ?
            ''', (limit,))

        rows = cursor.fetchall()
        conn.close()

        history = []
        for row in rows:
            history.append({
                'timestamp': row[0],
                'role': row[1],
                'content': row[2],
                'metadata': json.loads(row[3]) if row[3] else {}
            })

        # Reverse to get chronological order
        history.reverse()

        return {
            "success": True,
            "history": history,
            "count": len(history)
        }

    def _get_context(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Get context value by key"""
        key = params.get('key')

        if not key:
            return {"success": False, "error": "Key is required"}

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute('SELECT value FROM context WHERE key = ?', (key,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return {
                "success": True,
                "key": key,
                "value": json.loads(row[0])
            }
        else:
            return {
                "success": False,
                "error": f"Context key '{key}' not found"
            }

    def _set_context(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Set context value by key"""
        key = params.get('key')
        value = params.get('value')

        if not key:
            return {"success": False, "error": "Key is required"}

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute('''
            INSERT OR REPLACE INTO context (key, value, updated_at)
            VALUES (?, ?, ?)
        ''', (key, json.dumps(value), datetime.now().isoformat()))

        conn.commit()
        conn.close()

        return {
            "success": True,
            "message": f"Context '{key}' saved"
        }

    def _clear_memory(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Clear conversation history"""
        clear_context = params.get('clear_context', False)

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute('DELETE FROM conversations')
        
        if clear_context:
            cursor.execute('DELETE FROM context')

        conn.commit()
        conn.close()

        return {
            "success": True,
            "message": "Memory cleared"
        }


# Global memory module instance
_module = None


def get_memory_module() -> MemoryModule:
    """Get global memory module instance"""
    global _module
    if _module is None:
        _module = MemoryModule()
    return _module

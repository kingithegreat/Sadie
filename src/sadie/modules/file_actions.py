"""File actions module for Sadie AI Assistant"""

import os
import shutil
from pathlib import Path
from typing import Dict, Any, Optional
from ..core.config import get_config
from ..core.safety import get_safety_validator


class FileActionsModule:
    """Handles file operations like read, write, delete, move"""

    def __init__(self):
        self.config = get_config()
        self.validator = get_safety_validator()

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a file action
        
        Args:
            action: Action type (file_read, file_write, file_delete, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        # Validate action
        is_safe, message = self.validator.validate_action(action, params)
        
        if not is_safe:
            return {
                "success": False,
                "error": message,
                "suggestion": self.validator.get_safe_alternative(action, message)
            }

        # Check if confirmation is required
        if self.config.requires_confirmation(action):
            # This will be handled by the UI layer
            return {
                "success": False,
                "requires_confirmation": True,
                "message": f"Please confirm: {action}",
                "params": params
            }

        # Execute action
        action_map = {
            'file_read': self._read_file,
            'file_write': self._write_file,
            'file_delete': self._delete_file,
            'file_move': self._move_file,
            'file_copy': self._copy_file,
            'file_list': self._list_files,
            'file_info': self._file_info,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown file action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _read_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Read file contents"""
        file_path = Path(params['path'])
        
        if not file_path.exists():
            return {"success": False, "error": "File not found"}

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            return {
                "success": True,
                "content": content,
                "path": str(file_path),
                "size": file_path.stat().st_size
            }
        except UnicodeDecodeError:
            return {
                "success": False,
                "error": "File is not a text file or uses unsupported encoding"
            }

    def _write_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Write content to file"""
        file_path = Path(params['path'])
        content = params.get('content', '')
        mode = params.get('mode', 'w')  # 'w' for write, 'a' for append

        # Create parent directories if they don't exist
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, mode, encoding='utf-8') as f:
            f.write(content)

        return {
            "success": True,
            "path": str(file_path),
            "bytes_written": len(content.encode('utf-8'))
        }

    def _delete_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Delete a file"""
        file_path = Path(params['path'])
        
        if not file_path.exists():
            return {"success": False, "error": "File not found"}

        file_path.unlink()
        
        return {
            "success": True,
            "path": str(file_path),
            "message": "File deleted successfully"
        }

    def _move_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Move a file to a new location"""
        src_path = Path(params['path'])
        dst_path = Path(params['destination'])

        if not src_path.exists():
            return {"success": False, "error": "Source file not found"}

        # Create destination directory if needed
        dst_path.parent.mkdir(parents=True, exist_ok=True)

        shutil.move(str(src_path), str(dst_path))

        return {
            "success": True,
            "from": str(src_path),
            "to": str(dst_path),
            "message": "File moved successfully"
        }

    def _copy_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Copy a file to a new location"""
        src_path = Path(params['path'])
        dst_path = Path(params['destination'])

        if not src_path.exists():
            return {"success": False, "error": "Source file not found"}

        # Create destination directory if needed
        dst_path.parent.mkdir(parents=True, exist_ok=True)

        shutil.copy2(str(src_path), str(dst_path))

        return {
            "success": True,
            "from": str(src_path),
            "to": str(dst_path),
            "message": "File copied successfully"
        }

    def _list_files(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """List files in a directory"""
        dir_path = Path(params.get('path', '.'))
        pattern = params.get('pattern', '*')

        if not dir_path.exists():
            return {"success": False, "error": "Directory not found"}

        if not dir_path.is_dir():
            return {"success": False, "error": "Path is not a directory"}

        files = []
        for item in dir_path.glob(pattern):
            files.append({
                "name": item.name,
                "path": str(item),
                "is_dir": item.is_dir(),
                "size": item.stat().st_size if item.is_file() else 0
            })

        return {
            "success": True,
            "directory": str(dir_path),
            "files": files,
            "count": len(files)
        }

    def _file_info(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Get information about a file"""
        file_path = Path(params['path'])

        if not file_path.exists():
            return {"success": False, "error": "File not found"}

        stat = file_path.stat()

        return {
            "success": True,
            "path": str(file_path),
            "name": file_path.name,
            "size": stat.st_size,
            "is_dir": file_path.is_dir(),
            "is_file": file_path.is_file(),
            "modified": stat.st_mtime,
            "created": stat.st_ctime
        }

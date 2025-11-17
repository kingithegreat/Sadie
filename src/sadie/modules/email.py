"""Email module for Sadie AI Assistant"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, List
from ..core.config import get_config
from ..core.safety import get_safety_validator


class EmailModule:
    """Handles email operations"""

    def __init__(self):
        self.config = get_config()
        self.validator = get_safety_validator()

    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute an email action
        
        Args:
            action: Action type (email_send, email_draft, etc.)
            params: Action parameters
            
        Returns:
            Result dictionary
        """
        # Validate action
        is_safe, message = self.validator.validate_action(action, params)
        
        if not is_safe:
            return {
                "success": False,
                "error": message
            }

        # Check if confirmation is required
        if self.config.requires_confirmation(action):
            return {
                "success": False,
                "requires_confirmation": True,
                "message": f"Please confirm: {action}",
                "params": params
            }

        action_map = {
            'email_send': self._send_email,
            'email_draft': self._create_draft,
        }

        handler = action_map.get(action)
        if not handler:
            return {
                "success": False,
                "error": f"Unknown email action: {action}"
            }

        try:
            return handler(params)
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to execute {action}: {str(e)}"
            }

    def _send_email(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send an email"""
        if not self.config.is_module_enabled('email'):
            return {
                "success": False,
                "error": "Email module is disabled. Please enable it in config.yaml"
            }

        # Get SMTP configuration
        smtp_server = self.config.get('modules.email.smtp_server')
        smtp_port = self.config.get('modules.email.smtp_port', 587)
        use_tls = self.config.get('modules.email.use_tls', True)

        if not smtp_server:
            return {
                "success": False,
                "error": "SMTP server not configured. Please configure email settings in config.yaml"
            }

        # Get email parameters
        sender = params.get('sender')
        recipient = params.get('recipient')
        subject = params.get('subject', '')
        body = params.get('body', '')
        
        if not sender or not recipient:
            return {
                "success": False,
                "error": "Sender and recipient email addresses are required"
            }

        # Create message
        msg = MIMEMultipart()
        msg['From'] = sender
        msg['To'] = recipient
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        # Note: In production, you would need authentication credentials
        # This is a simplified version for demonstration
        try:
            server = smtplib.SMTP(smtp_server, smtp_port)
            if use_tls:
                server.starttls()
            # server.login(username, password)  # Would need credentials
            server.send_message(msg)
            server.quit()

            return {
                "success": True,
                "message": f"Email sent to {recipient}"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to send email: {str(e)}",
                "suggestion": "Check SMTP settings and authentication"
            }

    def _create_draft(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Create an email draft (just returns the formatted email)"""
        recipient = params.get('recipient', '')
        subject = params.get('subject', '')
        body = params.get('body', '')

        draft = f"To: {recipient}\nSubject: {subject}\n\n{body}"

        return {
            "success": True,
            "draft": draft,
            "message": "Email draft created. Review before sending."
        }


# Global email module instance
_module = None


def get_email_module() -> EmailModule:
    """Get global email module instance"""
    global _module
    if _module is None:
        _module = EmailModule()
    return _module

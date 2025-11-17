"""Desktop widget UI for Sadie AI Assistant"""

import sys
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                            QTextEdit, QLineEdit, QPushButton, QLabel, QMessageBox)
from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtGui import QFont
from ..core.config import get_config
from ..core.assistant import get_assistant


class AssistantThread(QThread):
    """Thread for processing assistant messages without blocking UI"""
    
    response_ready = pyqtSignal(dict)
    
    def __init__(self, message):
        super().__init__()
        self.message = message
        self.assistant = get_assistant()
    
    def run(self):
        """Process message in background"""
        result = self.assistant.process_message(self.message)
        self.response_ready.emit(result)


class SadieWidget(QMainWindow):
    """Main desktop widget for Sadie"""

    def __init__(self):
        super().__init__()
        self.config = get_config()
        self.assistant = get_assistant()
        self.current_thread = None
        self.init_ui()

    def init_ui(self):
        """Initialize the user interface"""
        # Window settings
        self.setWindowTitle(self.config.get('assistant.name', 'Sadie'))
        self.setGeometry(100, 100, 
                        self.config.get('ui.widget_width', 400),
                        self.config.get('ui.widget_height', 600))
        
        # Make window stay on top if configured
        if self.config.get('ui.always_on_top', True):
            self.setWindowFlags(Qt.WindowStaysOnTopHint)

        # Set window opacity
        opacity = self.config.get('ui.transparency', 0.95)
        self.setWindowOpacity(opacity)

        # Central widget
        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        # Layout
        layout = QVBoxLayout()
        central_widget.setLayout(layout)

        # Title label
        title = QLabel(self.config.get('assistant.name', 'Sadie'))
        title.setFont(QFont('Arial', 16, QFont.Bold))
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)

        # Status label
        self.status_label = QLabel('Ready')
        self.status_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.status_label)

        # Conversation display
        self.conversation = QTextEdit()
        self.conversation.setReadOnly(True)
        self.conversation.setFont(QFont('Arial', 10))
        layout.addWidget(self.conversation)

        # Input field
        self.input_field = QLineEdit()
        self.input_field.setPlaceholderText("Type your message here...")
        self.input_field.returnPressed.connect(self.send_message)
        layout.addWidget(self.input_field)

        # Send button
        send_button = QPushButton('Send')
        send_button.clicked.connect(self.send_message)
        layout.addWidget(send_button)

        # Status check button
        status_button = QPushButton('Check Status')
        status_button.clicked.connect(self.check_status)
        layout.addWidget(status_button)

        # Welcome message
        self.add_to_conversation("Sadie", "Hi! I'm Sadie, your local AI assistant. How can I help you today?")

    def add_to_conversation(self, sender: str, message: str):
        """Add a message to the conversation display"""
        self.conversation.append(f"<b>{sender}:</b> {message}<br>")
        # Scroll to bottom
        scrollbar = self.conversation.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def send_message(self):
        """Send user message to assistant"""
        message = self.input_field.text().strip()
        
        if not message:
            return

        # Clear input field
        self.input_field.clear()
        
        # Add to conversation
        self.add_to_conversation("You", message)
        
        # Update status
        self.status_label.setText("Thinking...")
        self.input_field.setEnabled(False)

        # Process in background thread
        self.current_thread = AssistantThread(message)
        self.current_thread.response_ready.connect(self.handle_response)
        self.current_thread.start()

    def handle_response(self, result: dict):
        """Handle response from assistant"""
        # Re-enable input
        self.input_field.setEnabled(True)
        self.status_label.setText("Ready")

        if not result.get('success'):
            error_msg = result.get('error', 'Unknown error')
            self.add_to_conversation("Sadie", f"Sorry, I encountered an error: {error_msg}")
            return

        # Display response
        response_text = result.get('response', '')
        self.add_to_conversation("Sadie", response_text)

        # Display tool results if any
        tool_results = result.get('tool_results', [])
        if tool_results:
            for i, tool_result in enumerate(tool_results, 1):
                if tool_result.get('success'):
                    self.add_to_conversation("System", f"✓ Action {i} completed successfully")
                else:
                    error = tool_result.get('error', 'Unknown error')
                    self.add_to_conversation("System", f"✗ Action {i} failed: {error}")

                # Check if confirmation is required
                if tool_result.get('requires_confirmation'):
                    self.request_confirmation(tool_result)

    def request_confirmation(self, action_info: dict):
        """Request user confirmation for an action"""
        message = action_info.get('message', 'Confirm this action?')
        reply = QMessageBox.question(self, 'Confirmation Required', 
                                     message, 
                                     QMessageBox.Yes | QMessageBox.No)
        
        if reply == QMessageBox.Yes:
            # Execute the action
            action = action_info.get('params', {}).get('action')
            params = action_info.get('params', {})
            result = self.assistant.execute_action(action, params)
            
            if result.get('success'):
                self.add_to_conversation("System", "✓ Action completed")
            else:
                error = result.get('error', 'Unknown error')
                self.add_to_conversation("System", f"✗ Action failed: {error}")
        else:
            self.add_to_conversation("System", "Action cancelled by user")

    def check_status(self):
        """Check and display system status"""
        status = self.assistant.check_status()
        
        status_text = f"""<b>System Status:</b><br>
        Assistant: {status['assistant']}<br>
        Ollama: {'✓ Connected' if status['ollama_connected'] else '✗ Not connected'}<br>
        n8n: {'✓ Connected' if status['n8n_connected'] else '✗ Not connected'}<br>
        <br><b>Modules:</b><br>"""
        
        for module, enabled in status['modules_enabled'].items():
            status_icon = '✓' if enabled else '✗'
            status_text += f"{status_icon} {module.replace('_', ' ').title()}<br>"
        
        self.conversation.append(status_text + "<br>")


def run_widget():
    """Run the Sadie widget application"""
    app = QApplication(sys.argv)
    widget = SadieWidget()
    widget.show()
    sys.exit(app.exec_())


if __name__ == '__main__':
    run_widget()

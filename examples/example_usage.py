"""
Example usage of Sadie AI Assistant
This script demonstrates various ways to interact with Sadie programmatically
"""

from sadie.core.assistant import get_assistant
from sadie.core.config import get_config
from sadie.modules.file_actions import FileActionsModule
from sadie.modules.memory import get_memory_module
import os


def example_basic_conversation():
    """Example: Basic conversation with Sadie"""
    print("=== Example 1: Basic Conversation ===\n")
    
    assistant = get_assistant()
    
    # Send a message
    result = assistant.process_message("Hello Sadie, what can you help me with?")
    
    if result['success']:
        print(f"Sadie: {result['response']}\n")
    else:
        print(f"Error: {result.get('error')}\n")


def example_file_operations():
    """Example: File operations"""
    print("=== Example 2: File Operations ===\n")
    
    assistant = get_assistant()
    
    # Create a test file
    test_file = os.path.expanduser("~/Documents/sadie_test.txt")
    
    # Write to file
    result = assistant.execute_action('file_write', {
        'path': test_file,
        'content': 'Hello from Sadie!\nThis is a test file.'
    })
    
    if result['success']:
        print(f"✓ Created file: {test_file}")
    else:
        print(f"✗ Error creating file: {result.get('error')}")
    
    # Read the file
    result = assistant.execute_action('file_read', {
        'path': test_file
    })
    
    if result['success']:
        print(f"✓ File contents:\n{result['content']}\n")
    else:
        print(f"✗ Error reading file: {result.get('error')}\n")
    
    # Clean up
    if os.path.exists(test_file):
        os.remove(test_file)
        print(f"✓ Cleaned up test file\n")


def example_list_files():
    """Example: List files in directory"""
    print("=== Example 3: List Files ===\n")
    
    assistant = get_assistant()
    
    # List files in Documents
    documents_path = os.path.expanduser("~/Documents")
    
    result = assistant.execute_action('file_list', {
        'path': documents_path,
        'pattern': '*.txt'
    })
    
    if result['success']:
        print(f"Text files in Documents:")
        for file in result['files'][:5]:  # Show first 5
            print(f"  - {file['name']} ({file['size']} bytes)")
        if result['count'] > 5:
            print(f"  ... and {result['count'] - 5} more\n")
    else:
        print(f"✗ Error listing files: {result.get('error')}\n")


def example_planning():
    """Example: Task planning"""
    print("=== Example 4: Task Planning ===\n")
    
    assistant = get_assistant()
    
    # Ask Sadie to plan a task
    result = assistant.process_message(
        "Create a plan for organizing my Downloads folder"
    )
    
    if result['success']:
        print(f"Sadie: {result['response']}\n")
        
        # If there were tool calls (like plan_task)
        if result.get('tool_results'):
            for tool_result in result['tool_results']:
                if 'steps' in tool_result:
                    print("Plan steps:")
                    for step in tool_result['steps']:
                        print(f"  {step['step_number']}. {step['description']}")
    print()


def example_memory():
    """Example: Using memory system"""
    print("=== Example 5: Memory System ===\n")
    
    memory = get_memory_module()
    
    # Save some context
    memory.execute('memory_set_context', {
        'key': 'user_preference',
        'value': {'theme': 'dark', 'language': 'en'}
    })
    print("✓ Saved user preferences to memory")
    
    # Retrieve context
    result = memory.execute('memory_get_context', {
        'key': 'user_preference'
    })
    
    if result['success']:
        print(f"✓ Retrieved preferences: {result['value']}")
    
    # Save conversation
    memory.execute('memory_save', {
        'role': 'user',
        'content': 'Remember my favorite color is blue'
    })
    
    memory.execute('memory_save', {
        'role': 'assistant',
        'content': 'I\'ll remember that your favorite color is blue!'
    })
    print("✓ Saved conversation to memory")
    
    # Recall conversation
    result = memory.execute('memory_recall', {
        'limit': 2
    })
    
    if result['success']:
        print("\nRecent conversation:")
        for entry in result['history']:
            print(f"  {entry['role']}: {entry['content']}")
    print()


def example_safety_validation():
    """Example: Safety validation"""
    print("=== Example 6: Safety Validation ===\n")
    
    assistant = get_assistant()
    
    # Try to access a forbidden directory (should be blocked)
    result = assistant.execute_action('file_list', {
        'path': 'C:/Windows/System32'
    })
    
    if not result['success']:
        print(f"✓ Safety check working!")
        print(f"  Blocked: {result.get('error')}")
        if 'suggestion' in result:
            print(f"  Suggestion: {result['suggestion']}")
    print()


def example_check_status():
    """Example: Check system status"""
    print("=== Example 7: System Status ===\n")
    
    assistant = get_assistant()
    status = assistant.check_status()
    
    print(f"Assistant: {status['assistant']}")
    print(f"Ollama: {'✓ Connected' if status['ollama_connected'] else '✗ Not connected'}")
    print(f"n8n: {'✓ Connected' if status['n8n_connected'] else '✗ Not connected'}")
    print("\nEnabled Modules:")
    
    for module, enabled in status['modules_enabled'].items():
        icon = '✓' if enabled else '✗'
        print(f"  {icon} {module.replace('_', ' ').title()}")
    print()


def example_with_context():
    """Example: Conversation with context"""
    print("=== Example 8: Contextual Conversation ===\n")
    
    assistant = get_assistant()
    
    # First message
    result1 = assistant.process_message("My name is Alex")
    print(f"You: My name is Alex")
    print(f"Sadie: {result1['response']}\n")
    
    # Follow-up message (Sadie should remember the context)
    result2 = assistant.process_message("What's my name?")
    print(f"You: What's my name?")
    print(f"Sadie: {result2['response']}\n")


def main():
    """Run all examples"""
    print("\n" + "="*60)
    print("SADIE AI ASSISTANT - EXAMPLE USAGE")
    print("="*60 + "\n")
    
    try:
        # Run examples
        example_basic_conversation()
        example_file_operations()
        example_list_files()
        example_planning()
        example_memory()
        example_safety_validation()
        example_check_status()
        example_with_context()
        
        print("="*60)
        print("All examples completed!")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n✗ Error running examples: {str(e)}")
        print("\nMake sure:")
        print("  1. Ollama is running (ollama serve)")
        print("  2. Models are installed (ollama pull llama2)")
        print("  3. Configuration is correct (config/config.yaml)")
        print("\nRun: python -m sadie.main --status")


if __name__ == '__main__':
    main()

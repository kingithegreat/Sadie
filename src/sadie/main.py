"""Main entry point for Sadie AI Assistant"""

import sys
import argparse
from .ui.widget import run_widget
from .core.assistant import get_assistant
from .core.config import get_config


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Sadie - A fully local AI assistant for Windows'
    )
    
    parser.add_argument(
        '--cli',
        action='store_true',
        help='Run in CLI mode instead of GUI'
    )
    
    parser.add_argument(
        '--config',
        type=str,
        help='Path to custom config file'
    )
    
    parser.add_argument(
        '--message',
        type=str,
        help='Send a single message in CLI mode'
    )

    parser.add_argument(
        '--status',
        action='store_true',
        help='Check system status'
    )
    
    args = parser.parse_args()

    # Load configuration
    if args.config:
        from .core.config import Config
        Config(args.config)

    # Check status mode
    if args.status:
        assistant = get_assistant()
        status = assistant.check_status()
        
        print("\n=== Sadie System Status ===")
        print(f"Assistant: {status['assistant']}")
        print(f"Ollama: {'✓ Connected' if status['ollama_connected'] else '✗ Not connected'}")
        print(f"n8n: {'✓ Connected' if status['n8n_connected'] else '✗ Not connected'}")
        print("\nModules:")
        for module, enabled in status['modules_enabled'].items():
            status_icon = '✓' if enabled else '✗'
            print(f"  {status_icon} {module.replace('_', ' ').title()}")
        print()
        return

    # CLI mode
    if args.cli or args.message:
        assistant = get_assistant()
        
        if args.message:
            # Single message mode
            result = assistant.process_message(args.message)
            
            print(f"\nSadie: {result.get('response', 'No response')}")
            
            if result.get('tool_results'):
                print("\nActions taken:")
                for i, tool_result in enumerate(result['tool_results'], 1):
                    status = '✓' if tool_result.get('success') else '✗'
                    print(f"  {status} Action {i}")
                    if not tool_result.get('success'):
                        print(f"     Error: {tool_result.get('error')}")
            print()
        else:
            # Interactive CLI mode
            print("=== Sadie AI Assistant ===")
            print("Type 'exit' or 'quit' to end the conversation\n")
            
            while True:
                try:
                    user_input = input("You: ").strip()
                    
                    if user_input.lower() in ['exit', 'quit']:
                        print("Goodbye!")
                        break
                    
                    if not user_input:
                        continue
                    
                    result = assistant.process_message(user_input)
                    
                    print(f"\nSadie: {result.get('response', 'No response')}\n")
                    
                    if result.get('tool_results'):
                        for tool_result in result['tool_results']:
                            if not tool_result.get('success'):
                                print(f"Note: {tool_result.get('error')}\n")
                
                except KeyboardInterrupt:
                    print("\n\nGoodbye!")
                    break
                except EOFError:
                    print("\n\nGoodbye!")
                    break
    else:
        # GUI mode (default)
        run_widget()


if __name__ == '__main__':
    main()

"""
Quick start script for Sadie AI Assistant
Run this to test if everything is set up correctly
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from sadie.core.assistant import get_assistant
from sadie.core.config import get_config


def check_setup():
    """Check if Sadie is properly set up"""
    print("\n" + "="*60)
    print("SADIE AI ASSISTANT - QUICK START CHECK")
    print("="*60 + "\n")
    
    assistant = get_assistant()
    status = assistant.check_status()
    
    all_good = True
    
    # Check Ollama
    print("1. Checking Ollama connection...")
    if status['ollama_connected']:
        print("   ✓ Ollama is running and accessible")
    else:
        print("   ✗ Ollama is not accessible")
        print("   → Run: ollama serve")
        print("   → Make sure models are installed: ollama pull llama2")
        all_good = False
    
    # Check n8n (optional)
    print("\n2. Checking n8n connection (optional)...")
    if status['n8n_connected']:
        print("   ✓ n8n is running and accessible")
    else:
        print("   ✗ n8n is not accessible (this is optional)")
        print("   → If you want to use n8n: n8n start")
    
    # Check modules
    print("\n3. Checking enabled modules...")
    enabled_count = sum(1 for enabled in status['modules_enabled'].values() if enabled)
    print(f"   {enabled_count}/{len(status['modules_enabled'])} modules enabled")
    
    for module, enabled in status['modules_enabled'].items():
        icon = '✓' if enabled else '✗'
        print(f"   {icon} {module.replace('_', ' ').title()}")
    
    print("\n" + "="*60)
    
    if all_good:
        print("✓ Setup complete! Sadie is ready to use.")
        print("\nTry running:")
        print("  python -m sadie.main              # Start GUI")
        print("  python -m sadie.main --cli        # Start CLI")
        print("  python -m sadie.main --message 'Hello'  # Quick test")
        return True
    else:
        print("✗ Setup incomplete. Please fix the issues above.")
        return False


def quick_test():
    """Run a quick test conversation"""
    print("\n" + "="*60)
    print("QUICK TEST")
    print("="*60 + "\n")
    
    assistant = get_assistant()
    
    print("Sending test message to Sadie...\n")
    
    result = assistant.process_message("Hello Sadie! Please tell me what you can help me with.")
    
    if result['success']:
        print(f"Sadie: {result['response']}\n")
        print("✓ Test successful! Sadie is working correctly.")
        return True
    else:
        print(f"✗ Test failed: {result.get('error')}\n")
        return False


def main():
    """Main function"""
    try:
        # Check setup
        setup_ok = check_setup()
        
        if not setup_ok:
            print("\nPlease fix the setup issues and try again.")
            sys.exit(1)
        
        # Ask if user wants to run test
        print("\n" + "="*60)
        response = input("Would you like to run a quick test? (y/n): ").strip().lower()
        
        if response in ['y', 'yes']:
            test_ok = quick_test()
            if test_ok:
                print("\n✓ Everything is working! You're ready to use Sadie.")
                print("\nNext steps:")
                print("  1. Run 'python -m sadie.main' to start the desktop widget")
                print("  2. Try asking Sadie questions and giving her tasks")
                print("  3. Check docs/USAGE.md for examples and tips")
            else:
                print("\n✗ Test failed. Check the error above.")
        else:
            print("\nYou can run tests later with:")
            print("  python examples/quick_start.py")
        
    except KeyboardInterrupt:
        print("\n\nSetup cancelled.")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Error: {str(e)}")
        print("\nPlease check:")
        print("  1. Python dependencies are installed (pip install -r requirements.txt)")
        print("  2. Ollama is running (ollama serve)")
        print("  3. Configuration file exists (config/config.yaml)")
        sys.exit(1)


if __name__ == '__main__':
    main()

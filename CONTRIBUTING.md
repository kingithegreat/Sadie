# Contributing to Sadie

Thank you for your interest in contributing to Sadie! This document provides guidelines for contributing.

## Ways to Contribute

1. **Report Bugs** - Open an issue describing the bug
2. **Suggest Features** - Open an issue with your feature idea
3. **Improve Documentation** - Fix typos or clarify instructions
4. **Write Code** - Fix bugs or implement features
5. **Share Examples** - Add usage examples

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Sadie.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes
6. Commit: `git commit -m "Description of changes"`
7. Push: `git push origin feature/your-feature-name`
8. Open a Pull Request

## Development Setup

```bash
# Clone repository
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install in development mode
pip install -e .

# Install development dependencies
pip install pytest black flake8
```

## Code Style

- Follow PEP 8 guidelines
- Use descriptive variable and function names
- Add docstrings to classes and functions
- Keep functions focused and single-purpose
- Add type hints where appropriate

Example:
```python
def process_file(file_path: str, encoding: str = 'utf-8') -> Dict[str, Any]:
    """
    Process a file and return its contents
    
    Args:
        file_path: Path to the file
        encoding: File encoding (default: utf-8)
        
    Returns:
        Dictionary with file contents and metadata
    """
    # Implementation here
    pass
```

## Project Structure

```
Sadie/
├── src/sadie/
│   ├── core/          # Core functionality (assistant, config, safety)
│   ├── modules/       # Feature modules (file, vision, voice, etc.)
│   ├── ui/            # User interface (widget)
│   └── main.py        # Entry point
├── config/            # Configuration files
├── docs/              # Documentation
├── examples/          # Example scripts
└── tests/             # Test files (to be added)
```

## Adding a New Module

1. Create module file in `src/sadie/modules/`
2. Implement the module class with `execute()` method
3. Register in `ModuleRouter` (`src/sadie/core/module_router.py`)
4. Add configuration in `config/config.yaml`
5. Add documentation in `docs/API.md`
6. Add examples showing usage

Example module structure:
```python
class MyModule:
    """Description of module"""
    
    def __init__(self):
        self.config = get_config()
    
    def execute(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute an action"""
        action_map = {
            'my_action': self._my_action,
        }
        
        handler = action_map.get(action)
        if not handler:
            return {"success": False, "error": f"Unknown action: {action}"}
        
        try:
            return handler(params)
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _my_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Implement your action"""
        return {"success": True, "data": {}}
```

## Safety Guidelines

When adding features:

1. **Validate all inputs** - Never trust user input
2. **Check permissions** - Verify file access rights
3. **Use safety validator** - Check actions against safety rules
4. **Fail safely** - Handle errors gracefully
5. **Log actions** - Important operations should be logged
6. **Document risks** - Note any security considerations

Example:
```python
# Always validate
is_safe, message = self.validator.validate_action(action, params)
if not is_safe:
    return {"success": False, "error": message}

# Check confirmation
if self.config.requires_confirmation(action):
    return {"success": False, "requires_confirmation": True}
```

## Testing

Add tests for your changes:

```python
# tests/test_my_module.py
import pytest
from sadie.modules.my_module import MyModule

def test_my_action():
    module = MyModule()
    result = module.execute('my_action', {'param': 'value'})
    assert result['success'] == True
```

Run tests:
```bash
pytest tests/
```

## Documentation

Update documentation when adding features:

1. **README.md** - Update if adding major features
2. **docs/API.md** - Document new modules and actions
3. **docs/USAGE.md** - Add usage examples
4. **Docstrings** - Add to all functions and classes
5. **Comments** - Explain complex logic

## Commit Messages

Use clear, descriptive commit messages:

- ✅ "Add voice recording module"
- ✅ "Fix file path validation in safety validator"
- ✅ "Update documentation for vision module"
- ❌ "Fixed stuff"
- ❌ "Updates"

## Pull Request Guidelines

When submitting a PR:

1. **Describe changes** - What and why
2. **Reference issues** - Link related issues
3. **Add tests** - If applicable
4. **Update docs** - If adding/changing features
5. **Check style** - Run linters
6. **Test thoroughly** - Ensure nothing breaks

PR Template:
```markdown
## Description
Brief description of changes

## Changes Made
- Change 1
- Change 2

## Testing
How you tested the changes

## Related Issues
Fixes #123
```

## Code Review

All PRs will be reviewed for:

- Code quality and style
- Security implications
- Documentation completeness
- Test coverage
- User experience impact

## Questions?

- Open an issue for questions
- Check existing documentation
- Review code examples

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to Sadie! 🌸

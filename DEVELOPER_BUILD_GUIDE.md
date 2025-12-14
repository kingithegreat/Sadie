# SADIE Developer Build Guide

This guide helps new developers set up SADIE for local development, testing, and contribution.

## Prerequisites

### System Requirements
- **Node.js**: 18.0 or higher (LTS recommended)
- **Git**: Latest version
- **Ollama**: For local AI model hosting
- **Operating System**: Windows 10+, macOS 10.15+, or Linux

### Hardware Requirements
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 2GB free space
- **Network**: Internet connection for dependencies

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie
```

### 2. Install Dependencies

```bash
# Install all dependencies
npm install

# Verify installation
npm --version
node --version
```

### 3. Install and Configure Ollama

#### Download Ollama
- **Windows/macOS**: Download from [ollama.ai](https://ollama.ai/download)
- **Linux**: Follow installation instructions for your distribution

#### Start Ollama Service
```bash
# Start Ollama (runs in background)
ollama serve
```

#### Download Required Models
```bash
# Pull the default model used by SADIE
ollama pull llama2:7b

# Verify models are available
ollama list
```

**Note:** SADIE defaults to `llama2:7b` but can work with any Ollama-compatible model.

## Development Workflow

### Project Structure

```
Sadie/
├── widget/                 # Main Electron application
│   ├── src/
│   │   ├── main/          # Main process code
│   │   ├── renderer/      # UI code
│   │   └── preload/       # Context bridge
│   ├── dist/              # Built output
│   └── package.json
├── orchestrator/          # Backend services (future)
├── scripts/               # Build and utility scripts
└── docs/                  # Documentation
```

### Development Commands

#### Start Development Server
```bash
cd widget

# Start with hot reload
npm run dev

# Or build and run manually
npm run build
npm start
```

#### Development Builds
```bash
# Build main process only
npm run build:main

# Build renderer only
npm run build:renderer

# Full build
npm run build
```

#### Watch Mode for Development
```bash
# Watch for changes and rebuild
npm run dev:watch
```

## Testing

### Unit Tests
```bash
# Run all unit tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### E2E Tests
```bash
# Ensure Ollama is running first
ollama serve

# Run E2E tests
npm run e2e

# Debug E2E tests
npx playwright test --ui
```

### Test Prerequisites
- Ollama must be running for E2E tests
- Set `SADIE_E2E=true` for test mode
- Clean userData directory for isolation

## Code Changes and Rebuilding

### Main Process Changes
When modifying `src/main/` files:

```bash
# Rebuild main process
npm run build:main

# Restart the application
npm start
```

### Renderer Changes
When modifying `src/renderer/` files:

```bash
# Rebuild renderer (usually auto with dev server)
npm run build:renderer
```

### Preload Script Changes
When modifying `src/preload/` files:

```bash
# Rebuild preload
npm run build:preload

# Restart application (preload requires restart)
npm start
```

## Working Safely (Avoid Breaking Release Mode)

### Environment Awareness

SADIE has three modes - always know which you're in:

| Mode | When to Use | Environment |
|------|-------------|-------------|
| Development | Local coding | `NODE_ENV=development` |
| Test | Running tests | `SADIE_E2E=true` |
| Production | User releases | `NODE_ENV=production` |

### Safe Development Practices

#### 1. Never Commit Test Code to Production
```typescript
// ✅ Safe: Gated with environment check
if (process.env.SADIE_E2E === 'true') {
  // Test-only code here
}

// ❌ Unsafe: Ungated test code
setupTestMocks(); // This will ship in production!
```

#### 2. Gate Diagnostic Logs
```typescript
// ✅ Safe: Release-gated logging
if (!isReleaseBuild) {
  console.log('[DIAG] Debug info');
}

// ❌ Unsafe: Ungated debug logs
console.log('[DIAG] This ships to users!');
```

#### 3. Use Environment Variables Wisely
```typescript
// ✅ Safe: Environment-aware features
const apiUrl = isE2E ? 'http://localhost:3000' : 'https://api.sadie.ai';

// ❌ Unsafe: Hardcoded test values
const apiUrl = 'http://localhost:3000'; // Ships test URL to production
```

#### 4. Test in All Modes
Before committing:
```bash
# Test development mode
npm run dev

# Test production build
NODE_ENV=production npm run build
NODE_ENV=production npm start

# Run full test suite
npm run test:all
```

### Code Review Checklist

- [ ] No ungated test code
- [ ] No hardcoded localhost URLs
- [ ] Diagnostic logs are release-gated
- [ ] Environment variables properly handled
- [ ] Tested in production mode
- [ ] E2E tests still pass

## Debugging

### Common Issues

#### Application Won't Start
```bash
# Check for build errors
npm run build

# Check Node version
node --version

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Ollama Connection Issues
```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# Restart Ollama
ollama serve

# Check model availability
ollama list
```

#### E2E Test Failures
```bash
# Run with debug output
DEBUG=* npm run e2e

# Check traces
npx playwright show-trace test-results/

# Run in headed mode
npx playwright test --headed
```

#### Build Errors
```bash
# Clear cache
npm run clean

# Rebuild from scratch
npm run build

# Check TypeScript errors
npx tsc --noEmit
```

## Advanced Development

### Custom Model Configuration
```bash
# Use different Ollama model
ollama pull codellama:7b
# Then configure in SADIE settings
```

### Development with Custom Ollama
```bash
# Run Ollama on custom port
OLLAMA_HOST=0.0.0.0:8080 ollama serve
```

### Performance Profiling
```bash
# Build with source maps
NODE_ENV=development npm run build

# Profile main process
npm run profile:main
```

## Contributing

### Pull Request Process
1. Fork the repository
2. Create a feature branch
3. Make changes following safe development practices
4. Test in all modes
5. Submit PR with description

### Code Standards
- TypeScript for type safety
- ESLint for code quality
- Prettier for formatting
- Jest for testing

### Documentation Updates
When adding features:
- Update this guide if setup changes
- Add to TESTING_MATRIX.md for new tests
- Update SECURITY_AND_COMPLIANCE.md for security changes

## Getting Help

### Resources
- **Issues**: [GitHub Issues](https://github.com/kingithegreat/Sadie/issues)
- **Discussions**: [GitHub Discussions](https://github.com/kingithegreat/Sadie/discussions)
- **Documentation**: See docs/ folder

### Troubleshooting Checklist
- [ ] Node.js version correct?
- [ ] Dependencies installed?
- [ ] Ollama running?
- [ ] Environment variables set?
- [ ] Ports not conflicting?
- [ ] Firewall allowing connections?

## Next Steps

Once set up:
1. Read SECURITY_AND_COMPLIANCE.md
2. Review TESTING_MATRIX.md
3. Run the full test suite
4. Start contributing!

Welcome to the SADIE development team! 🚀
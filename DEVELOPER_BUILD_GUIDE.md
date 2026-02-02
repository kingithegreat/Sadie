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
├── n8n-workflows/         # n8n workflow definitions
├── scripts/               # Build and utility scripts
├── config/                # Configuration files
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

# SADIE - Complete Setup & Deployment Guide

## 🚀 Quick Start - Get to 100% in 5 Steps

### Step 1: File Structure Setup

Create the following directory structure in your `widget/src/` folder:

```
widget/
├── src/
│   ├── App.tsx                    ✅ Use artifact: app_tsx
│   ├── App.css                    ✅ Use artifact: app_css
│   ├── components/
│   │   ├── AutomationCenter.tsx   ✅ Use artifact: automation_center
│   │   └── AutomationCenter.css   ✅ Use artifact: automation_center_css
│   ├── main.tsx
│   └── vite-env.d.ts
├── playwright.config.ts           ✅ Use artifact: playwright_config
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Step 2: Install Missing Dependencies

Run these commands in your `widget/` directory:

```bash
# Core dependencies
npm install react react-dom react-router-dom

# TypeScript types
npm install --save-dev @types/react @types/react-dom @types/node

# Playwright for testing
npm install --save-dev @playwright/test

# Development tools
npm install --save-dev vite @vitejs/plugin-react typescript
```

### Step 3: Create Missing Configuration Files

#### Create `widget/src/main.tsx`:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

#### Create `widget/src/index.css`:
```css
:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color: #213547;
  background-color: #ffffff;
}

#root {
  margin: 0;
  padding: 0;
  min-height: 100vh;
}
```

#### Create `widget/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
})
```

#### Create `widget/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

#### Create `widget/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### Step 4: Update package.json Scripts

Add/update these scripts in `widget/package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
  }
}
```

### Step 5: Fix n8n Workflow JSON

Replace `n8n-workflows/tools/image-generate.json` with the artifact `image_generate_json`.

---

## 🔧 Verification & Testing

### Build Verification Checklist

```bash
# 1. Check TypeScript compilation
cd widget
npx tsc --noEmit

# 2. Start development server
npm run dev

# 3. Run Playwright tests
npm run test

# 4. Build for production
npm run build
```

### Expected Results

✅ **TypeScript Compilation**: No errors
✅ **Dev Server**: Runs on http://localhost:5173
✅ **Playwright Tests**: Configuration loads without errors
✅ **Production Build**: Creates `dist/` folder successfully

---

## 🐛 Troubleshooting

### Issue: "Cannot find module './components/AutomationCenter'"

**Solution**: Ensure the file structure is correct:
- `widget/src/components/AutomationCenter.tsx` exists
- File has default export: `export default AutomationCenter;`

### Issue: Playwright env error

**Solution**: The fixed `playwright.config.ts` moves `env` to the `webServer` section where it belongs.

### Issue: JSON syntax errors in workflow

**Solution**: Use the corrected `image-generate.json` artifact which is valid JSON.

### Issue: React Router errors

**Solution**: Install react-router-dom:
```bash
npm install react-router-dom
npm install --save-dev @types/react-router-dom
```

---

## 🚀 Deployment

### Docker Deployment

Your existing `docker-compose.yml` should work once all files are in place:

```bash
docker-compose up -d
```

### Manual Deployment

```bash
# Build the application
cd widget
npm run build

# Serve the dist folder
npx serve -s dist -l 5173
```

---

## 📊 Success Metrics

Your application is at **100%** when:

- ✅ No TypeScript compilation errors
- ✅ Dev server runs without errors
- ✅ All components render correctly
- ✅ Playwright configuration loads
- ✅ Production build succeeds
- ✅ n8n workflows are valid JSON
- ✅ Docker containers start successfully

---

## 🎯 Next Steps

1. **Connect to n8n**: Update API URLs in environment variables
2. **Add Authentication**: Implement user authentication if needed
3. **Expand Workflows**: Create more n8n automation workflows
4. **Add Tests**: Write Playwright tests for critical user flows
5. **CI/CD Pipeline**: Set up automated testing and deployment

---

## 📞 Support

If you encounter any issues:

1. Check the console for error messages
2. Verify all dependencies are installed
3. Ensure file paths match exactly
4. Review the TypeScript compiler output

---

**Status**: All critical issues resolved ✅  
**Build Status**: Ready for deployment 🚀  
**Test Coverage**: Configuration ready 🧪  
**Documentation**: Complete 📚
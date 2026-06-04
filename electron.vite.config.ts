import { readFileSync } from 'fs'
import { builtinModules } from 'module'
import { resolve } from 'path'

const repoRoot = process.cwd()
const widgetPackageJson = JSON.parse(
  readFileSync(resolve(repoRoot, 'widget/package.json'), 'utf-8')
)
const packageNames = new Set([
  'electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  ...Object.keys(widgetPackageJson.dependencies || {}),
  ...Object.keys(widgetPackageJson.optionalDependencies || {}),
  ...Object.keys(widgetPackageJson.peerDependencies || {})
])
const external = (id: string): boolean => {
  for (const name of packageNames) {
    if (id === name || id.startsWith(`${name}/`)) return true
  }
  return false
}

export default {
  main: {
    build: {
      rollupOptions: {
        external,
        input: {
          index: resolve(repoRoot, 'widget/src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external,
        input: {
          index: resolve(repoRoot, 'widget/src/preload/index.ts'),
          webview: resolve(repoRoot, 'widget/src/preload/webview.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(repoRoot, 'widget/src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(repoRoot, 'widget/src/shared')
      }
    },
    build: {
      target: 'chrome120',
      rollupOptions: {
        input: {
          index: resolve(repoRoot, 'widget/src/renderer/index.html')
        },
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-hljs': ['highlight.js']
          }
        }
      }
    }
  }
}
